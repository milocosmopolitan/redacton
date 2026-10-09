import http from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const root = resolve('.');
const dir = await mkdtemp(join(tmpdir(), 'redacton-session-'));
const plugin = join(dir, 'plugin');
await mkdir(plugin);
for (const path of ['.claude-plugin/plugin.json', 'hooks', 'mod', 'helper/dist', 'node_modules']) {
  await mkdir(join(plugin, path, '..'), { recursive: true });
  await cp(join(root, path), join(plugin, path), { recursive: true });
}
const synthetic = 'ghp_SYNTHETICREVOKED00000000000000000000';
const sourceSha256 = {};
for (const path of ['mod/index.jsx', 'mod/state.js', 'mod/protocol.js', 'mod/adapters/text.js']) sourceSha256[path] = createHash('sha256').update(await readFile(join(plugin, path))).digest('hex');
const captures = [];
const server = http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const request = JSON.parse(text);
  if (req.url.includes('count_tokens')) { res.end('{"input_tokens":1}'); return; }
  captures.push(request);
  const message = { id: 'msg_session', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'SESSION_DONE' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!request.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(message)); return; }
  res.setHeader('content-type', 'text/event-stream');
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('message_start', { message: { ...message, content: [], stop_reason: null } });
  send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'SESSION_DONE' } });
  send('content_block_stop', { index: 0 });
  send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  send('message_stop', {}); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'synthetic-local-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
try {
  // Direct argv child preserves interactive streaming; rtk's proxy buffers stdout.
  const child = spawn('claude', ['-p', '--plugin-dir', plugin, '--plugin-dir', resolve('qualification/helper-counter'), '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '--model', 'claude-sonnet-4-6', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '', phase = 0, offset = 0, initialCalls = null, finalCalls = null;
  const send = text => { offset = output.length; child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n'); };
  child.stdout.on('data', chunk => {
    output += chunk;
    const fresh = output.slice(offset);
    const count = fresh.match(/HELPER_CALLS_(\d+)/);
    if (phase === 0 && count) { initialCalls = Number(count[1]); phase = 1; send('/redactoff'); }
    else if (phase === 1 && fresh.includes('Warning: Redacton is OFF.')) {
      phase = 1.5;
      void (async () => {
        const source = await readFile(join(plugin, 'mod/index.jsx'), 'utf8');
        await writeFile(join(plugin, 'mod/index.jsx'), source.replace('sequence: 0, pending: 0', 'sequence: 100, pending: 0'));
        await new Promise(resolve => setTimeout(resolve, 1000));
        phase = 2; send(`RELOAD ${synthetic}`);
      })();
    }
    else if (phase === 2 && fresh.includes('SESSION_DONE')) { phase = 3; send('/helpercount'); }
    else if (phase === 3 && count) { finalCalls = Number(count[1]); phase = 4; child.stdin.end(); }
  });
  child.stderr.on('data', chunk => error += chunk);
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  send('/helpercount');
  let exitCode;
  try { exitCode = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }); }
  finally { clearTimeout(timer); }
  const promptContent = captures.flatMap(request => request.messages ?? []).filter(message => message.role === 'user').map(message => message.content);
  const report = { exitCode, phaseCompleted: phase === 4, requests: captures.length, initialHelperCalls: initialCalls, finalHelperCalls: finalCalls, rawInModelUserContent: JSON.stringify(promptContent).includes(synthetic), placeholderInModelUserContent: JSON.stringify(promptContent).includes('<SECRET_1>'), immediateOffWarning: output.includes('Warning: Redacton is OFF.'), reloadNoticeObserved: (output + error).toLowerCase().includes('reloaded'), completed: output.includes('SESSION_DONE'), stderrPresent: Boolean(error) };
  console.log(JSON.stringify(report));
  if (exitCode !== 0 || phase !== 4 || captures.length !== 1 || initialCalls !== 1 || finalCalls < 3 || report.rawInModelUserContent || !report.placeholderInModelUserContent || !report.immediateOffWarning || !report.completed) process.exitCode = 1;
  await writeFile(join(root, 'qualification/hot-reload-host-report.json'), JSON.stringify({ hostVersion: '2.1.294', node: process.version, platform: process.platform, arch: process.arch, sourceSha256, result: report }, null, 2) + '\n');
} finally { server.close(); await rm(dir, { recursive: true, force: true }); }
