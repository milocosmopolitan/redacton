import { mkdir as ensureDirectory } from 'node:fs/promises';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

await ensureDirectory('qualification/results', { recursive: true });

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.env.REDACTON_PLUGIN_ROOT ?? '.');
const dir = await mkdtemp(join(tmpdir(), 'redacton-session-'));
const synthetic = 'ghp_SYNTHETICREVOKED00000000000000000000';
const sourceSha256 = {};
for (const path of [
  'mod/index.tsx',
  'mod/state.ts',
  'mod/protocol.ts',
  'mod/adapters/text.ts',
])
  sourceSha256[path] = createHash('sha256')
    .update(await readFile(join(root, path)))
    .digest('hex');
const captures = [];
const server = http.createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const request = JSON.parse(text);
  if (req.url.includes('count_tokens')) {
    res.end('{"input_tokens":1}');
    return;
  }
  captures.push(request);
  const message = {
    id: 'msg_session',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'SESSION_DONE' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!request.stream) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(message));
    return;
  }
  res.setHeader('content-type', 'text/event-stream');
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('message_start', {
    message: { ...message, content: [], stop_reason: null },
  });
  send('content_block_start', {
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  send('content_block_delta', {
    index: 0,
    delta: { type: 'text_delta', text: 'SESSION_DONE' },
  });
  send('content_block_stop', { index: 0 });
  send('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  send('message_stop', {});
  res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...isolatedPlatformEnvironment(dir),
  PATH: process.env.PATH,
  HOME: dir,
  CLAUDE_CONFIG_DIR: join(dir, 'config'),
  ANTHROPIC_API_KEY: 'synthetic-local-only',
  REDACTON_SETTINGS_ROOT: join(dir, 'settings'),
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};
try {
  // Direct argv preserves streaming and the selected pinned host.
  const child = spawn(
    claudeBinary,
    [
      '-p',
      '--plugin-dir',
      root,
      '--plugin-dir',
      resolve('qualification/helper-counter'),
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--permission-mode',
      'dontAsk',
      '--model',
      'claude-sonnet-4-6',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
    ],
    { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '',
    error = '',
    phase = 0,
    offset = 0,
    initialCalls = null,
    finalCalls = null;
  const send = (text) => {
    offset = output.length;
    child.stdin.write(
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`,
    );
  };
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const fresh = output.slice(offset);
    const count = fresh.match(/HELPER_CALLS_(\d+)/);
    if (phase === 0 && count) {
      initialCalls = Number(count[1]);
      phase = 1;
      send('/redactoff');
    } else if (phase === 1 && fresh.includes('REDACTON_USER_ACTION_REQUIRED')) {
      phase = 2;
      send(`Protection must remain ON ${synthetic}`);
    } else if (phase === 2 && fresh.includes('SESSION_DONE')) {
      phase = 3;
      send('/helpercount');
    } else if (phase === 3 && count) {
      finalCalls = Number(count[1]);
      phase = 4;
      child.stdin.end();
    }
  });
  child.stderr.on('data', (chunk) => (error += chunk));
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  send('/helpercount');
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
  } finally {
    clearTimeout(timer);
  }
  const promptContent = captures
    .flatMap((request) => request.messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content);
  const report = {
    exitCode,
    phaseCompleted: phase === 4,
    requests: captures.length,
    initialHelperCalls: initialCalls,
    finalHelperCalls: finalCalls,
    rawInProtectedModelUserContent:
      JSON.stringify(promptContent).includes(synthetic),
    sanitizedPlaceholderInModelUserContent:
      JSON.stringify(promptContent).includes('<SECRET_1>'),
    automationDisableDenied: output.includes('REDACTON_USER_ACTION_REQUIRED'),
    offWarning: output.includes('Warning: Redacton is OFF.'),
    authorityEvidence: 'sdk-denial-protection-retained',
    completed: output.includes('SESSION_DONE'),
    stderrPresent: Boolean(error),
  };
  console.log(JSON.stringify(report));
  if (
    exitCode !== 0 ||
    phase !== 4 ||
    captures.length !== 1 ||
    initialCalls !== 2 ||
    finalCalls !== initialCalls + 1 ||
    report.rawInProtectedModelUserContent ||
    !report.sanitizedPlaceholderInModelUserContent ||
    !report.automationDisableDenied ||
    report.offWarning ||
    !report.completed
  )
    process.exitCode = 1;
  else
    await writeFile(
      resolve('qualification/results/stream-session-host-report.json'),
      `${JSON.stringify({ hostVersion, node: process.version, platform: process.platform, arch: process.arch, sourceSha256, result: report }, null, 2)}\n`,
    );
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
