import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { claudeBinary, isolatedPlatformEnvironment } from './host-runtime.mjs';

// Synthetic-only loopback endpoint; no payloads are persisted or printed.
const dir = await mkdtemp(join(tmpdir(), 'redacton-spike-'));
const captures = [];
let step = 0;
const scenario = process.argv[2] ?? 'normal';
if (
  !['normal', 'guarded-catch-failure', 'unguarded-catch-failure'].includes(
    scenario,
  )
)
  throw new Error('INVALID_SCENARIO');
const command =
  scenario === 'normal'
    ? 'printf SPIKE_RAW'
    : `printf SPIKE_RAW # spike-catch-throw ${scenario === 'unguarded-catch-failure' ? 'unguarded' : ''}`;
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = {};
  }
  if (req.url.includes('count_tokens')) {
    res.end(JSON.stringify({ input_tokens: 1 }));
    return;
  }
  captures.push(parsed);
  const content =
    step++ === 0
      ? [
          {
            type: 'tool_use',
            id: 'tool_spike_1',
            name: 'Bash',
            input: { command },
          },
        ]
      : [{ type: 'text', text: 'SPIKE_DONE' }];
  const message = {
    id: 'msg_spike',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content,
    stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  if (!parsed.stream) {
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
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    send('content_block_start', {
      index: i,
      content_block:
        block.type === 'tool_use'
          ? { ...block, input: {} }
          : { type: 'text', text: '' },
    });
    send('content_block_delta', {
      index: i,
      delta:
        block.type === 'tool_use'
          ? {
              type: 'input_json_delta',
              partial_json: JSON.stringify(block.input),
            }
          : { type: 'text_delta', text: block.text },
    });
    send('content_block_stop', { index: i });
  }
  send('message_delta', {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  send('message_stop', {});
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
try {
  const child = spawn(
    claudeBinary,
    [
      '-p',
      'SPIKE_RAW',
      '--plugin-dir',
      resolve(
        scenario === 'unguarded-catch-failure'
          ? 'qualification/fixtures/host-boundary-unguarded'
          : 'qualification/fixtures/host-boundary',
      ),
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      'Bash',
      '--no-session-persistence',
      '--model',
      'claude-sonnet-4-6',
    ],
    {
      cwd: dir,
      env: {
        ...isolatedPlatformEnvironment(dir),
        PATH: process.env.PATH,
        HOME: dir,
        CLAUDE_CONFIG_DIR: join(dir, 'config'),
        ANTHROPIC_API_KEY: 'synthetic-local-only',
        REDACTON_SETTINGS_ROOT: join(dir, 'settings'),
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '',
    error = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (error += c));
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  let exitCode;
  try {
    exitCode = await new Promise((r, reject) => {
      child.on('exit', r);
      child.on('error', reject);
    });
  } finally {
    clearTimeout(timer);
  }
  const messages = captures.flatMap((p) => p.messages ?? []);
  const toolResults = messages.flatMap((m) =>
    Array.isArray(m.content)
      ? m.content.filter((c) => c.type === 'tool_result')
      : [],
  );
  const promptMessages = (captures[0]?.messages ?? [])
    .filter((m) => m.role === 'user')
    .flatMap((m) =>
      typeof m.content === 'string'
        ? [m.content]
        : (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text),
    );
  const report = {
    scenario,
    exitCode,
    requests: captures.length,
    promptReplaced: JSON.stringify(promptMessages).includes('SPIKE_SANITIZED'),
    rawInPromptMessages: JSON.stringify(promptMessages).includes('SPIKE_RAW'),
    toolResultCount: toolResults.length,
    rawInToolResults: JSON.stringify(toolResults).includes('SPIKE_RAW'),
    sanitizedInToolResults:
      JSON.stringify(toolResults).includes('SPIKE_SANITIZED'),
    blockedInToolResults: JSON.stringify(toolResults).includes(
      'SPIKE_OUTER_BLOCKED',
    ),
    completed: output.includes('SPIKE_DONE'),
    stderrPresent: Boolean(error),
  };
  console.log(JSON.stringify(report));
  // An incomplete run is not compatibility evidence, even if no raw marker was observed.
  if (
    exitCode !== 0 ||
    captures.length !== 2 ||
    toolResults.length !== 1 ||
    !report.completed ||
    !report.promptReplaced ||
    report.rawInPromptMessages ||
    (scenario === 'normal'
      ? report.rawInToolResults || !report.sanitizedInToolResults
      : scenario === 'guarded-catch-failure'
        ? report.rawInToolResults || !report.blockedInToolResults
        : !report.rawInToolResults)
  )
    process.exitCode = 1;
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
