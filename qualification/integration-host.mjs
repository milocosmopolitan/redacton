import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Synthetic-only loopback endpoint; no payloads are persisted or printed.
const dir = await mkdtemp(join(tmpdir(), 'redacton-spike-'));
const captures = [];
let step = 0;
const mode = process.argv[2] ?? 'bash';
const synthetic = 'ghp_SYNTHETICREVOKED00000000000000000000';
const rootArgument = process.argv.indexOf('--plugin-root');
const root = resolve(rootArgument >= 0 ? process.argv[rootArgument + 1] : '.');
await writeFile(join(dir, 'synthetic.txt'), `앞 ${synthetic} 뒤\n`);
const input = mode === 'read' ? { file_path: join(dir, 'synthetic.txt') } : { command: `${mode === 'denied-bash' ? 'printf x >> execution-counter; ' : ''}printf '%s\\n' '${synthetic}'; printf '%s\\n' '${synthetic}' >&2` };
const tool = mode === 'read' ? 'Read' : 'Bash';
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  let parsed; try { parsed = JSON.parse(body); } catch { parsed = {}; }
  if (req.url.includes('count_tokens')) { res.end(JSON.stringify({ input_tokens: 1 })); return; }
  captures.push(parsed);
  const content = mode === 'prompt' || step++ > 0 ? [{ type: 'text', text: 'SPIKE_DONE' }] : [{ type: 'tool_use', id: 'tool_spike_1', name: tool, input }];
  const message = { id: 'msg_spike', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (!parsed.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(message)); return; }
  res.setHeader('content-type', 'text/event-stream');
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('message_start', { message: { ...message, content: [], stop_reason: null } });
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    send('content_block_start', { index: i, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    send('content_block_delta', { index: i, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    send('content_block_stop', { index: i });
  }
  send('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } });
  send('message_stop', {}); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
async function launch(prompt) {
  const child = spawn('rtk', ['proxy', 'claude', '-p', prompt, '--plugin-dir', process.argv[3] === 'shape-only' ? resolve('qualification/shape-probe') : root, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', ...(mode === 'denied-bash' ? [] : ['--allowedTools', tool]), '--model', 'claude-sonnet-4-6'], {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'synthetic-local-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', error = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => error += c);
  const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  let exitCode;
  try { exitCode = await new Promise((r, reject) => { child.on('exit', r); child.on('error', reject); }); }
  finally { clearTimeout(timer); }
  return { exitCode, output, error };
}
try {
  const preflight = await launch('/redacton');
  const pluginLoaded = preflight.exitCode === 0 && preflight.output.includes('Redacton ON.') && captures.length === 0;
  if (!pluginLoaded) { console.log(JSON.stringify({ mode, pluginLoaded: false, preflightExitCode: preflight.exitCode })); process.exitCode = 1; }
  else {
  const prompt = mode === 'off' ? '/redactoff' : mode === 'on' ? '/redacton' : mode === 'prompt' ? `앞 ${synthetic} 뒤` : 'Run the supplied synthetic qualification tool.';
  const { exitCode, output, error } = await launch(prompt);
  if (process.argv[3] === 'shape') {
    const observation = (output + error).match(/SHAPE_KEYS (\{[^\n]+\})/);
    if (observation) { try { console.log(JSON.stringify({ shapeObservation: JSON.parse(observation[1]) })); } catch {} }
  }
  const messages = captures.flatMap(p => p.messages ?? []);
  const toolResults = messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'tool_result') : []);
  if (process.argv[3] === 'shape-only') {
    for (const result of toolResults) {
      const text = typeof result.content === 'string' ? result.content : result.content?.map(block => block.text ?? '').join('');
      const json = text?.match(/\{.*\}/s)?.[0];
      try { console.log(JSON.stringify({ qualificationOnlyShape: JSON.parse(json) })); } catch {}
    }
  }
  const promptMessages = (captures[0]?.messages ?? []).filter(m => m.role === 'user').flatMap(m => typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter(c => c.type === 'text').map(c => c.text));
  const storage = [];
  async function collect(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.name.endsWith('.jsonl')) storage.push(await readFile(path, 'utf8'));
    }
  }
  await collect(join(dir, 'config', 'projects'));
  const persistedRows = storage.flatMap(text => text.split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }));
  const persistedMessages = persistedRows.flatMap(row => row.message ? [row.message] : []);
  const rawStorageLocations = [];
  function locate(value, schemaPath, rowType) {
    if (typeof value === 'string' && value.includes(synthetic)) rawStorageLocations.push({ rowType, schemaPath });
    else if (value && typeof value === 'object') for (const [key, nested] of Object.entries(value)) locate(nested, `${schemaPath}.${Array.isArray(value) ? '*' : key}`, rowType);
  }
  for (const row of persistedRows) locate(row, 'row', typeof row.type === 'string' ? row.type : 'unknown');
  const persistedBlocks = persistedMessages.flatMap(message => typeof message.content === 'string' ? [{ type: 'text', text: message.content, role: message.role }] : (message.content ?? []).map(block => ({ ...block, role: message.role })));
  const rawStoredPrompt = persistedBlocks.some(block => block.role === 'user' && block.type === 'text' && (block.text ?? '').includes(synthetic));
  const rawStoredToolArguments = persistedBlocks.some(block => block.type === 'tool_use' && JSON.stringify(block.input).includes(synthetic));
  const rawStoredToolResults = persistedBlocks.some(block => block.type === 'tool_result' && JSON.stringify(block.content).includes(synthetic));
  const originalArgumentsIntact = captures.some(request => request.messages?.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_use' && JSON.stringify(block.input) === JSON.stringify(input))));
  const toolExecutions = (await readFile(join(dir, 'execution-counter'), 'utf8').catch(() => '')).length;
  if (process.argv[3] === 'shape') {
    function observe(value) {
      if (typeof value === 'string' && value.includes('SHAPE_KEYS ')) {
        try { console.log(JSON.stringify({ shapeObservation: JSON.parse(value.slice(value.indexOf('SHAPE_KEYS ') + 11)) })); } catch {}
      } else if (value && typeof value === 'object') for (const nested of Object.values(value)) observe(nested);
    }
    for (const text of storage) for (const line of text.split('\n').filter(Boolean)) { try { observe(JSON.parse(line)); } catch {} }
  }
  const report = { mode, pluginLoaded, exitCode, requests: captures.length, rawInPromptMessages: JSON.stringify(promptMessages).includes(synthetic), sanitizedPlaceholderInPrompt: JSON.stringify(promptMessages).includes('<SECRET_1>'), toolResultCount: toolResults.length, rawInToolResults: JSON.stringify(toolResults).includes(synthetic), toolResultIsError: toolResults.some(result => result.is_error === true), fixedWithholdInToolResults: JSON.stringify(toolResults).includes('REDACTON_'), sanitizedPlaceholderInToolResults: JSON.stringify(toolResults).includes('<SECRET_1>'), originalArgumentsIntact, toolExecutions: mode === 'denied-bash' ? toolExecutions : null, completed: output.includes('SPIKE_DONE'), stderrPresent: Boolean(error), offWarning: output.includes('Warning: Redacton is OFF.'), transcriptFiles: storage.length, rawStoredPrompt, rawStoredToolArguments, rawStoredToolResults, rawInTranscript: rawStorageLocations.length > 0, rawStorageLocations: rawStorageLocations.slice(0, 20) };
  console.log(JSON.stringify(report));
  const reportArgument = process.argv.indexOf('--report');
  if (reportArgument >= 0) {
    const sourceSha256 = {};
    for (const path of ['mod/index.jsx', 'mod/state.js', 'mod/protocol.js', 'mod/adapters/text.js', 'helper/dist/index.mjs', 'package-lock.json']) sourceSha256[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
    await writeFile(resolve(process.argv[reportArgument + 1]), JSON.stringify({ hostVersion: '2.1.294', node: process.version, platform: process.platform, arch: process.arch, sourceSha256, result: report }, null, 2) + '\n');
  }
  // An incomplete run is not compatibility evidence, even if no raw marker was observed.
  const local = mode === 'off' || mode === 'on';
  if (exitCode !== 0 || captures.length !== (local ? 0 : mode === 'prompt' ? 1 : 2) || toolResults.length !== (local || mode === 'prompt' ? 0 : 1) || (local ? !output.includes(mode === 'off' ? 'Warning: Redacton is OFF.' : 'Redacton ON.') : !output.includes('SPIKE_DONE'))) process.exitCode = 1;
  // Successful completion alone cannot qualify a raw fallback or blanket denial.
  if (mode === 'prompt' && (report.rawInPromptMessages || !report.sanitizedPlaceholderInPrompt)) process.exitCode = 1;
  if ((mode === 'read' || mode === 'bash') && (report.rawInToolResults || !report.sanitizedPlaceholderInToolResults || report.toolResultIsError || report.fixedWithholdInToolResults || !originalArgumentsIntact)) process.exitCode = 1;
  if (mode === 'denied-bash' && (toolExecutions !== 0 || !originalArgumentsIntact || !report.toolResultIsError || !report.fixedWithholdInToolResults || report.rawInToolResults)) process.exitCode = 1;
  }
} finally { server.close(); await rm(dir, { recursive: true, force: true }); }
