import { mkdir as ensureDirectory } from 'node:fs/promises';

await ensureDirectory('qualification/results', { recursive: true });

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
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
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CLAUDE_CONFIG_DIR: join(dir, 'config'),
  ANTHROPIC_API_KEY: 'synthetic-local-only',
  REDACTON_SETTINGS_ROOT: join(dir, 'settings'),
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};
const base = [
  'proxy',
  'claude',
  '-p',
  '--plugin-dir',
  root,
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--permission-mode',
  'dontAsk',
  '--model',
  'claude-sonnet-4-6',
  '--output-format',
  'json',
];
async function launch(prompt, extra = []) {
  const before = captures.length;
  const child = spawn('rtk', [...base, ...extra, prompt], {
    cwd: dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    error = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (error += chunk));
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
  } finally {
    clearTimeout(timer);
  }
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    result = {};
  }
  const requests = captures.slice(before);
  const promptContent = requests
    .flatMap((request) => request.messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content);
  return {
    exitCode,
    requests: requests.length,
    result,
    output,
    rawInModelUserContent: JSON.stringify(promptContent).includes(synthetic),
    placeholderInModelUserContent:
      JSON.stringify(promptContent).includes('<SECRET_1>'),
    stderrPresent: Boolean(error),
  };
}
const results = [];
try {
  const preflight = await launch('/redacton');
  if (
    preflight.exitCode !== 0 ||
    preflight.requests !== 0 ||
    !preflight.output.includes('Redacton ON.')
  )
    throw new Error('SESSION_PREFLIGHT_FAILED');
  const id = randomUUID();
  const baseline = await launch(`baseline ${synthetic}`, ['--session-id', id]);
  const off = await launch('/redactoff', ['--resume', id]);
  const resumed = await launch(`resumed ${synthetic}`, ['--resume', id]);
  const branched = await launch(`branched ${synthetic}`, [
    '--resume',
    id,
    '--fork-session',
  ]);
  for (const [mode, value] of [
    ['baseline', baseline],
    ['resume-off-command', off],
    ['resumed-default-on', resumed],
    ['branched-default-on', branched],
  ]) {
    const report = {
      mode,
      exitCode: value.exitCode,
      requests: value.requests,
      rawInModelUserContent: value.rawInModelUserContent,
      placeholderInModelUserContent: value.placeholderInModelUserContent,
      completed: value.output.includes('SESSION_DONE'),
      immediateOffWarning: value.output.includes('Warning: Redacton is OFF.'),
      stderrPresent: value.stderrPresent,
    };
    if (mode === 'branched-default-on')
      report.distinctSessionId =
        typeof value.result.session_id === 'string' &&
        value.result.session_id !== id;
    if (
      value.exitCode !== 0 ||
      (mode === 'resume-off-command'
        ? value.requests !== 0 || !report.immediateOffWarning
        : value.requests !== 1 ||
          value.rawInModelUserContent ||
          !value.placeholderInModelUserContent ||
          !report.completed) ||
      (mode === 'branched-default-on' && !report.distinctSessionId)
    )
      throw new Error('SESSION_BOUNDARY_FAILED');
    results.push(report);
    console.log(JSON.stringify(report));
  }
  await writeFile(
    join(root, 'qualification/results/session-host-report.json'),
    `${JSON.stringify({ hostVersion: '2.1.294', node: process.version, platform: process.platform, arch: process.arch, sourceSha256, results }, null, 2)}\n`,
  );
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
