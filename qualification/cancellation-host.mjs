import { mkdir as ensureDirectory } from 'node:fs/promises';

await ensureDirectory('qualification/results', { recursive: true });

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const dir = await mkdtemp(join(tmpdir(), 'redacton-cancel-'));
const plugin = join(dir, 'plugin');
const sourceSha256 = {};
const results = [];
await mkdir(plugin);
for (const path of [
  '.claude-plugin/plugin.json',
  'hooks',
  'mod',
  'helper/dist',
]) {
  await mkdir(join(plugin, path, '..'), { recursive: true });
  await cp(join(root, path), join(plugin, path), { recursive: true });
}
for (const path of [
  'mod/index.tsx',
  'mod/state.ts',
  'mod/protocol.ts',
  'mod/adapters/text.ts',
])
  sourceSha256[path] = createHash('sha256')
    .update(await readFile(join(plugin, path)))
    .digest('hex');
await writeFile(
  join(plugin, 'helper/dist/index.js'),
  `import { writeFileSync } from 'node:fs';
let text=''; for await(const chunk of process.stdin) text+=chunk;
const request=JSON.parse(text);
const response={protocolVersion:1,requestId:request.requestId,status:'ok',engineVersion:'0.1.0-beta.14',policyId:'credentials-alpha1',artifact:'addon',findingCounts:{}};
if(request.operation==='sanitize') response.segments=request.segments.map(segment=>({id:segment.id,text:segment.text}));
if(request.segments?.some(segment=>segment.id==='stdout')) {
 writeFileSync(new URL('./cancel-pid',import.meta.url),String(process.pid));
 await new Promise(resolve=>setTimeout(resolve,5000));
}
process.stdout.write(JSON.stringify(response));
`,
);
const synthetic = 'ghp_SYNTHETICREVOKED00000000000000000000';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') throw new Error('CANCEL_PID_CHECK_FAILED');
    return false;
  }
}
try {
  for (const mode of ['before-tool-helper', 'during-tool-helper']) {
    await rm(join(plugin, 'helper/dist/cancel-pid'), { force: true });
    const captures = [];
    let requests = 0;
    const sockets = new Set();
    const server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      if (req.url.includes('count_tokens')) {
        res.end('{"input_tokens":1}');
        return;
      }
      captures.push(request);
      requests++;
      if (mode === 'before-tool-helper') return;
      const content =
        requests === 1
          ? [
              {
                type: 'tool_use',
                id: 'cancel_tool_1',
                name: 'Bash',
                input: { command: `printf '%s\\n' '${synthetic}'` },
              },
            ]
          : [{ type: 'text', text: 'CANCEL_UNEXPECTED_DELIVERY' }];
      const message = {
        id: 'msg_cancel',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content,
        stop_reason: requests === 1 ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      res.setHeader('content-type', 'text/event-stream');
      const send = (type, data) =>
        res.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
        );
      send('message_start', {
        message: { ...message, content: [], stop_reason: null },
      });
      const block = content[0];
      send('content_block_start', {
        index: 0,
        content_block:
          block.type === 'tool_use'
            ? { ...block, input: {} }
            : { type: 'text', text: '' },
      });
      send('content_block_delta', {
        index: 0,
        delta:
          block.type === 'tool_use'
            ? {
                type: 'input_json_delta',
                partial_json: JSON.stringify(block.input),
              }
            : { type: 'text_delta', text: block.text },
      });
      send('content_block_stop', { index: 0 });
      send('message_delta', {
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      send('message_stop', {});
      res.end();
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CLAUDE_CONFIG_DIR: join(dir, `config-${mode}`),
      ANTHROPIC_API_KEY: 'synthetic-local-only',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    const child = spawn(
      'claude',
      [
        '-p',
        'Run the supplied synthetic tool once.',
        '--plugin-dir',
        plugin,
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
      { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '',
      error = '',
      exitCode = null,
      helperPid = null;
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (error += chunk));
    const finished = new Promise((resolve, reject) => {
      child.once('exit', (code) => {
        exitCode = code;
        resolve();
      });
      child.once('error', reject);
    });
    const bound = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, 20000);
    try {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (mode === 'before-tool-helper' && requests === 1) break;
        if (mode === 'during-tool-helper') {
          const value = await readFile(
            join(plugin, 'helper/dist/cancel-pid'),
            'utf8',
          ).catch(() => '');
          if (value) {
            helperPid = Number(value);
            if (!Number.isSafeInteger(helperPid) || helperPid <= 0)
              throw new Error('CANCEL_INVALID_PID');
            break;
          }
        }
        if (exitCode !== null) break;
        await delay(20);
      }
      const stageReached =
        mode === 'before-tool-helper' ? requests === 1 : helperPid !== null;
      if (!stageReached) throw new Error('CANCEL_STAGE_NOT_REACHED');
      const beforeInterrupt = requests;
      child.kill('SIGINT');
      await Promise.race([finished, delay(4000)]);
      const stoppedAfterSignal = exitCode !== null;
      await delay(2200);
      const helperAliveAfterDeadline =
        helperPid === null ? null : alive(helperPid);
      const toolResults = captures
        .flatMap((request) => request.messages ?? [])
        .flatMap((message) =>
          Array.isArray(message.content)
            ? message.content.filter((block) => block.type === 'tool_result')
            : [],
        );
      const report = {
        mode,
        stageReached,
        requestsBeforeSignal: beforeInterrupt,
        requestsAfterSignal: requests - beforeInterrupt,
        stoppedAfterSignal,
        exitCode,
        helperAliveAfterDeadline,
        toolResultCount: toolResults.length,
        rawInToolResults: JSON.stringify(toolResults).includes(synthetic),
        unexpectedDelivery: output.includes('CANCEL_UNEXPECTED_DELIVERY'),
        stderrPresent: Boolean(error),
      };
      results.push(report);
      console.log(JSON.stringify(report));
      if (
        report.requestsAfterSignal !== 0 ||
        report.rawInToolResults ||
        report.unexpectedDelivery ||
        helperAliveAfterDeadline === true
      )
        process.exitCode = 1;
    } finally {
      clearTimeout(bound);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
      if (helperPid && alive(helperPid))
        try {
          process.kill(helperPid, 'SIGKILL');
        } catch {}
      await Promise.race([finished, delay(1000)]);
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  }
  await writeFile(
    join(root, 'qualification/results/cancellation-host-report.json'),
    `${JSON.stringify({ hostVersion: '2.1.294', node: process.version, platform: process.platform, arch: process.arch, sourceSha256, results }, null, 2)}\n`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
