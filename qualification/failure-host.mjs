import http from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const synthetic = 'ghp_SYNTHETICREVOKED00000000000000000000';
const dir = await mkdtemp(join(tmpdir(), 'redacton-fault-'));
const plugin = join(dir, 'plugin');
const modes = ['invalid-json', 'mismatch-id', 'duplicate-id', 'missing-id', 'unknown-status', 'missing-helper', 'timeout', 'policy-failure', 'output-truncated', 'prompt-invalid', 'missing-node'];
const reports = [];
const pluginSourceSha256 = {};
await mkdir(plugin);
for (const name of ['.claude-plugin/plugin.json', 'hooks', 'mod', 'helper/dist', 'node_modules']) {
  await mkdir(join(plugin, name, '..'), { recursive: true });
  await cp(resolve(name), join(plugin, name), { recursive: true });
}
for (const name of ['mod/index.jsx', 'mod/protocol.js', 'mod/state.js', 'mod/adapters/text.js']) pluginSourceSha256[name] = createHash('sha256').update(await readFile(join(plugin, name))).digest('hex');
const productionModule = await readFile(join(plugin, 'mod/index.jsx'), 'utf8');
const helper = mode => `import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
let input=''; for await (const chunk of process.stdin) input+=chunk;
const request=JSON.parse(input);
const response={protocolVersion:1,requestId:request.requestId,status:'ok',engineVersion:'0.1.0-beta.14',policyId:'credentials-alpha1',artifact:'addon',findingCounts:{}};
if(request.operation==='sanitize') response.segments=request.segments.map(segment=>({id:segment.id,text:segment.text}));
const tool=request.operation==='sanitize' && request.segments.some(segment=>segment.id==='stdout');
const fault=tool || (${JSON.stringify(mode)}==='prompt-invalid' && request.operation==='sanitize');
if(fault) {
 const mode=${JSON.stringify(mode)};
 if(mode==='timeout') { writeFileSync(new URL('./timeout-pid',import.meta.url),String(process.pid)); await new Promise(resolve=>setTimeout(resolve,5000)); }
 if(mode==='invalid-json' || mode==='prompt-invalid') { process.stdout.write('{'); process.exit(0); }
 if(mode==='output-truncated') { process.stdout.write('x'.repeat(5*1024*1024),()=>process.exit(0)); await new Promise(()=>{}); }
 if(mode==='policy-failure') {
  const engine=await import('@redact-secret/core'); await engine.initialize();
  try { engine.scanAndRedact(request.segments[0].text,{policy:{evaluate(){throw new Error('SYNTHETIC_POLICY_FAILURE')}}}); }
  catch { process.stdout.write(JSON.stringify({protocolVersion:1,requestId:request.requestId,status:'failed',engineVersion:'0.1.0-beta.14',policyId:'credentials-alpha1',errorCode:'POLICY_FAILURE'})); process.exit(0); }
  process.exit(1);
 }
 if(mode==='mismatch-id') response.requestId='unrelated';
 if(mode==='duplicate-id') response.segments=response.segments.map(()=>response.segments[0]);
 if(mode==='missing-id') response.segments=[];
 if(mode==='unknown-status') response.status='partial';
}
// Delete only this test-owned temporary helper after the initial ordinary prompt.
if(${JSON.stringify(mode)}==='missing-helper' && request.operation==='sanitize' && !tool) unlinkSync(new URL(import.meta.url));
process.stdout.write(JSON.stringify(response));
`;

try {
  for (const mode of modes) {
    await writeFile(join(plugin, 'mod/index.jsx'), mode === 'missing-node'
      ? productionModule.replace("['node',", "['redacton-synthetic-missing-node',") : productionModule);
    await writeFile(join(plugin, 'helper/dist/index.mjs'), helper(mode));
    await rm(join(plugin, 'helper/dist/timeout-pid'), { force: true });
    await rm(join(dir, 'counter'), { force: true });
    const captures = [];
    let step = 0;
    const server = http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      let parsed; try { parsed = JSON.parse(body); } catch { parsed = {}; }
      if (req.url.includes('count_tokens')) { res.end(JSON.stringify({ input_tokens: 1 })); return; }
      captures.push(parsed);
      const content = step++ === 0 ? [{ type: 'tool_use', id: 'fault_tool_1', name: 'Bash', input: { command: `printf x >> counter; printf '%s\\n' '${synthetic}'` } }] : [{ type: 'text', text: 'FAULT_DONE' }];
      const message = { id: 'msg_fault', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
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
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    async function launch(prompt) {
      const start = performance.now();
      const child = spawn('rtk', ['proxy', 'claude', '-p', prompt, '--plugin-dir', plugin, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '--allowedTools', 'Bash', '--no-session-persistence', '--model', 'claude-sonnet-4-6'], {
        cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'synthetic-local-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => error += chunk);
      const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
      let exitCode;
      try { exitCode = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); }); }
      finally { clearTimeout(timer); }
      return { exitCode, elapsedMs: performance.now() - start, output, stderrPresent: Boolean(error) };
    }
    try {
      const preflight = await launch('/redacton');
      if (preflight.exitCode !== 0 || !preflight.output.includes('Redacton ON.') || captures.length !== 0) throw new Error('FAULT_PREFLIGHT_FAILED');
      const result = await launch('Run the supplied synthetic tool once.');
      const toolResults = captures.flatMap(value => value.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result') : []);
      const rawInToolResults = JSON.stringify(toolResults).includes(synthetic);
      const executions = (await readFile(join(dir, 'counter'), 'utf8').catch(() => '')).length;
      let timeoutChildAlive = null;
      if (mode === 'timeout') {
        const pid = Number(await readFile(join(plugin, 'helper/dist/timeout-pid'), 'utf8'));
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('INVALID_TIMEOUT_PID');
        try { process.kill(pid, 0); timeoutChildAlive = true; } catch (error) {
          if (error.code !== 'ESRCH') throw new Error('TIMEOUT_PID_CHECK_FAILED');
          timeoutChildAlive = false;
        }
        if (timeoutChildAlive) process.kill(pid, 'SIGKILL');
      }
      const report = { mode, exitCode: result.exitCode, requests: captures.length, toolResultCount: toolResults.length, rawInToolResults,
        toolResultIsError: toolResults.some(block => block.is_error === true), fixedWithholdCode: JSON.stringify(toolResults).includes('REDACTON_WITHHELD'),
        executions, elapsedMs: result.elapsedMs, timeoutChildAlive, completed: result.output.includes('FAULT_DONE'), stderrPresent: result.stderrPresent,
        readinessUnavailable: preflight.output.includes('Protection unavailable') };
      const promptFault = mode === 'prompt-invalid' || mode === 'missing-node';
      if (result.exitCode !== 0 || rawInToolResults || (promptFault ? captures.length !== 0 || executions !== 0 : captures.length !== 2 || toolResults.length !== 1 || executions !== 1 || !report.toolResultIsError || !report.fixedWithholdCode || !report.completed) || mode === 'timeout' && timeoutChildAlive !== false) throw new Error('FAULT_BOUNDARY_FAILED');
      if (mode === 'missing-node' && !report.readinessUnavailable) throw new Error('MISSING_NODE_NOT_UNAVAILABLE');
      reports.push(report);
      console.log(JSON.stringify(report));
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  await writeFile(resolve('qualification/failure-host-report.json'), JSON.stringify({ hostVersion: '2.1.294', node: process.version, platform: process.platform, arch: process.arch, pluginSourceSha256, results: reports }, null, 2) + '\n');
  await writeFile(resolve('qualification/failure-host-report.md'), `# Actual host process-failure qualification\n\nClaude Code 2.1.294, Node ${process.version}, ${process.platform} ${process.arch}. A test-owned temporary copy of the product plugin replaced only its helper with synthetic fault modes. A loopback Anthropic-format endpoint inspected real host request JSON in memory. Existing user settings/transcripts were not loaded; temporary configuration, copied dependencies and counters were removed. No raw payload, stderr, input path or matched value was recorded.\n\nNine tool-result fault modes passed: invalid JSON, mismatched request ID, duplicate segment IDs, missing segments, unknown status, missing helper after successful readiness/prompt, an actual engine policy callback throw, 5 MiB stdout exceeding the inspected 4 MiB host capture cap, and an actual helper sleep exceeding the host's 2,000 ms process timeout. Each run produced exactly two model requests and one errored tool result with REDACTON_WITHHELD, excluded the synthetic credential from tool-result content, and executed Bash exactly once according to its nonsecret counter. The timeout child PID was checked and was no longer alive. Total CLI timings include host startup and are not helper latency measurements. Exact counters and timings are in [failure-host-report.json](failure-host-report.json).\n\nA separate malformed-helper response during prompt submission produced zero model requests and zero tool executions. A missing-Node case changed only the test-owned temporary Mod process argv to a nonexistent executable; actual host process startup failed, readiness reported unavailable, and the protected prompt produced zero model requests or tool executions. This is a tested pre-delivery prompt withholding path. The synthetic credential remained present in the model-issued Bash argument, which is explicitly outside coverage; tool-result checks exclude those arguments.\n\nReproduce with \`rtk proxy node qualification/failure-host.mjs\`. Each CLI launch is bounded to 30 seconds. Protocol input-size boundaries and queue saturation also have unit/SDK evidence, while this probe exercises oversized child stdout and actual engine policy failure. The process truncation flag itself was not captured at the SDK process boundary, so the observed withholding does not distinguish host truncation from the parent response-size guard. Cancellation was not injected because the installed SDK test call interface exposes no supported abort control. These results do not establish immunity to arbitrary simultaneous outer/catch-handler failure or a platform matrix.\n`);
} finally { await rm(dir, { recursive: true, force: true }); }
