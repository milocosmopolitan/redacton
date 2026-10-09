import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

const root = resolve(process.env.REDACTON_PLUGIN_ROOT ?? '.');
const modes = process.argv[2]
  ? [process.argv[2]]
  : [
      'settings-busy',
      'settings-timeout',
      'settings-process',
      'finding-limit',
      'oversized',
      'scanner-timeout',
    ];
const knownModes = new Set([
  'settings-busy',
  'settings-timeout',
  'settings-process',
  'finding-limit',
  'oversized',
  'scanner-timeout',
]);
if (modes.some((mode) => !knownModes.has(mode)))
  throw new Error('INVALID_RECOVERY_MODE');
const dir = await mkdtemp(join(tmpdir(), 'redacton-recovery-'));
const plugin = join(dir, 'plugin');
const sourceSha256 = {};
const custom = 'syntheticcred_ABCDEF0123456789';
const document = {
  schemaVersion: 1,
  rules: [
    {
      kind: 'token',
      id: 'synthetic.rule',
      prefix: 'syntheticcred_',
      alphabet: 'alnum',
      run: { kind: 'exact', length: 16 },
      specificity: 'contextual',
      validator: 'none',
      action: 'redact',
    },
  ],
};
const reportPath = resolve('qualification/results/recovery-host-report.json');
await mkdir(resolve('qualification/results'), { recursive: true });
await rm(reportPath, { force: true });
const results = [];
try {
  for (const name of [
    '.claude-plugin/plugin.json',
    'hooks',
    'commands',
    'package.json',
    'helper/src/config.ts',
    'mod',
    'helper/dist',
    'node_modules/@redact-secret',
  ]) {
    await mkdir(join(plugin, name, '..'), { recursive: true });
    await cp(join(root, name), join(plugin, name), { recursive: true });
  }
  for (const name of [
    'mod/index.tsx',
    'mod/recovery.ts',
    'mod/state.ts',
    'mod/protocol.ts',
    'mod/authority.ts',
    'helper/dist/index.js',
    'helper/dist/core.js',
    'helper/dist/storage.js',
  ])
    sourceSha256[name] = createHash('sha256')
      .update(await readFile(join(plugin, name)))
      .digest('hex');
  await cp(
    join(plugin, 'helper/dist/index.js'),
    join(plugin, 'helper/dist/engine-runner.js'),
  );
  for (const mode of modes) {
    const scope = join(dir, mode);
    await mkdir(scope);
    const metadata = join(scope, 'metadata.jsonl');
    const env = {
      ...isolatedPlatformEnvironment(scope),
      PATH: process.env.PATH,
      HOME: scope,
      CLAUDE_CONFIG_DIR: join(scope, 'config'),
      REDACTON_SETTINGS_ROOT: join(scope, 'settings'),
      ANTHROPIC_API_KEY: 'synthetic-local-only',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    const production = (request) => {
      const child = spawnSync(
        process.execPath,
        [join(plugin, 'helper/dist/engine-runner.js')],
        {
          input: JSON.stringify(request),
          env,
          encoding: 'utf8',
          timeout: 5000,
        },
      );
      if (child.status !== 0)
        throw new Error('RECOVERY_SETTINGS_FIXTURE_FAILED');
      return JSON.parse(child.stdout);
    };
    const base = {
      protocolVersion: 2,
      requestId: 'fixture-load',
      policyId: 'credentials-alpha1',
    };
    const loaded = production({
      ...base,
      operation: 'load-config',
      storage: { scope: 'personal', approved: true },
    });
    const saved = production({
      ...base,
      requestId: 'fixture-save',
      operation: 'save-config',
      storage: {
        scope: 'personal',
        approved: true,
        expectedIdentity: loaded.settings.identity,
        expectedRevision: loaded.settings.revision,
        expectedDocument: loaded.settings.document,
        document,
      },
    });
    if (saved.status !== 'ok')
      throw new Error('RECOVERY_SETTINGS_FIXTURE_FAILED');
    await writeFile(
      join(plugin, 'helper/dist/index.js'),
      `import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input), mode=${JSON.stringify(mode)}, log=${JSON.stringify(metadata)};
const rows=existsSync(log)?readFileSync(log,'utf8').trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const ordinal=rows.filter(row=>row.operation===request.operation).length;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const configured=JSON.stringify(canonical(request.config?.rules))===JSON.stringify(canonical(${JSON.stringify(document.rules)}));
appendFileSync(log,JSON.stringify({operation:request.operation,ordinal,revision:request.config?.revision??null,configured})+'\\n');
const fail=code=>{process.stdout.write(JSON.stringify({protocolVersion:request.protocolVersion,requestId:request.requestId,status:'failed',engineVersion:'0.1.0-beta.14',policyId:'credentials-alpha1',...(request.config?{configRevision:request.config.revision}:{}),errorCode:code}));};
if(request.operation==='load-config'&&ordinal===0&&mode.startsWith('settings-')) {
 if(mode==='settings-busy'){fail('SETTINGS_BUSY');process.exit(0);}
 if(mode==='settings-process')process.exit(1);
 writeFileSync(new URL('./timeout-pid',import.meta.url),String(process.pid));await new Promise(resolve=>setTimeout(resolve,10000));process.exit(1);
}
if(request.operation==='sanitize'&&ordinal===0&&mode==='finding-limit'){fail('FINDING_LIMIT');process.exit(0);}
if(request.operation==='sanitize'&&ordinal===0&&mode==='scanner-timeout'){writeFileSync(new URL('./timeout-pid',import.meta.url),String(process.pid));await new Promise(resolve=>setTimeout(resolve,10000));process.exit(1);}
const child=spawn(process.execPath,[fileURLToPath(new URL('./engine-runner.js',import.meta.url))],{stdio:['pipe','inherit','inherit'],env:process.env});child.stdin.end(input);child.on('exit',code=>process.exit(code??1));
`,
    );
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
        id: 'msg_recovery',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'RECOVERY_DONE' }],
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
        res.write(
          'event: ' +
            type +
            '\ndata: ' +
            JSON.stringify({ type, ...data }) +
            '\n\n',
        );
      send('message_start', {
        message: { ...message, content: [], stop_reason: null },
      });
      send('content_block_start', {
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      send('content_block_delta', {
        index: 0,
        delta: { type: 'text_delta', text: 'RECOVERY_DONE' },
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
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    const child = spawn(
      claudeBinary,
      [
        '-p',
        '--plugin-dir',
        plugin,
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
      { cwd: scope, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let buffer = '',
      output = '',
      stderrPresent = false,
      pending = null;
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      output += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let value;
        try {
          value = JSON.parse(line);
        } catch {
          continue;
        }
        if (pending) {
          pending.events.push(value);
          if (value.type === 'result') {
            const active = pending;
            pending = null;
            clearTimeout(active.timer);
            active.resolve(active.events);
          }
        }
      }
    });
    child.stderr.on('data', () => {
      stderrPresent = true;
    });
    const hostTimer = setTimeout(() => child.kill('SIGKILL'), 45000);
    const ended = new Promise((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    const send = (text) =>
      new Promise((resolve, reject) => {
        if (pending) throw new Error('RECOVERY_OVERLAPPING_INPUT');
        pending = {
          resolve,
          reject,
          events: [],
          timer: setTimeout(() => {
            pending = null;
            reject(new Error('RECOVERY_PHASE_TIMEOUT'));
          }, 15000),
        };
        child.stdin.write(
          `${JSON.stringify({
            type: 'user',
            message: { role: 'user', content: text },
            parent_tool_use_id: null,
          })}\n`,
        );
      });
    const textOf = (events) => JSON.stringify(events);
    let row;
    let phase = 'initial';
    try {
      const initial = textOf(await send('/redact:status'));
      const settings = mode.startsWith('settings-');
      const initialCode =
        /Saved settings: ([A-Z_]+)/.exec(initial)?.[1] ?? 'NO_SETTINGS_CODE';
      const initialUnavailable = initial.includes('Protect unavailable');
      const before = captures.length;
      phase = 'fault';
      if (settings) await send('WITHHELD_SYNTHETIC_BEFORE_RECOVERY');
      else if (mode === 'oversized') await send('x'.repeat(270000));
      else await send('REFUSED_SYNTHETIC_FIRST_EVENT');
      const faultWithheld = captures.length === before;
      phase = 'refused-status';
      const refusedStatus = textOf(await send('/redact:status'));
      const refusedReady = refusedStatus.includes('Protect ready');
      const refusedUnavailable = refusedStatus.includes('Protect unavailable');
      phase = 'recovery';
      if (settings || mode === 'scanner-timeout') await send('/redacton');
      phase = 'recovered-status';
      const recoveredStatus = textOf(await send('/redact:status'));
      const managementModelCalls = captures.length;
      phase = 'success';
      const success = textOf(await send(`RECOVERED ${custom}`));
      phase = 'metadata';
      const records = (await readFile(metadata, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const checks = records.filter(
        (value) => value.operation === 'self-check',
      );
      const scans = records.filter((value) => value.operation === 'sanitize');
      const last = scans.at(-1);
      const users = captures
        .flatMap((request) => request.messages ?? [])
        .filter((message) => message.role === 'user');
      row = {
        mode,
        initialUnavailable,
        faultWithheld,
        refusedReady,
        refusedUnavailable,
        recoveredReady: recoveredStatus.includes('Protect ready'),
        customRuleVisible: recoveredStatus.includes('synthetic.rule'),
        managementModelCalls,
        modelRequests: captures.length,
        rawCustomInModel: JSON.stringify(users).includes(custom),
        completed: success.includes('RECOVERY_DONE'),
        loads: records.filter((value) => value.operation === 'load-config')
          .length,
        checks: checks.length,
        scans: scans.length,
        exactApprovedRules: last?.configured === true,
        exactAppliedRevision:
          checks.at(-1)?.revision === last?.revision && Boolean(last?.revision),
        stderrPresent,
        initialCode,
      };
      child.stdin.end();
      row.exitCode = await ended;
      row.passed =
        row.exitCode === 0 &&
        faultWithheld &&
        row.recoveredReady &&
        row.customRuleVisible &&
        managementModelCalls === 0 &&
        captures.length === 1 &&
        !row.rawCustomInModel &&
        row.completed &&
        row.exactApprovedRules &&
        row.exactAppliedRevision &&
        (settings
          ? initialUnavailable && refusedUnavailable && row.loads === 2
          : mode === 'scanner-timeout'
            ? refusedUnavailable
            : refusedReady);
    } catch (error) {
      row = {
        mode,
        phase,
        errorKind: ['TypeError', 'SyntaxError', 'Error'].includes(error?.name)
          ? error.name
          : 'Unknown',
        passed: false,
        code:
          error?.message === 'RECOVERY_PHASE_TIMEOUT'
            ? 'RECOVERY_PHASE_TIMEOUT'
            : 'RECOVERY_PROBE_FAILED',
        modelRequests: captures.length,
        stderrPresent,
        settingsCode:
          /Saved settings: ([A-Z_]+)/.exec(output)?.[1] ?? 'NO_SETTINGS_CODE',
        outputHasResult: output.includes('"type":"result"'),
        outputHasStatus: output.includes('Protect '),
        outputHasUnavailable: output.includes('REDACTON_UNAVAILABLE'),
      };
      child.kill('SIGKILL');
      await ended;
    } finally {
      clearTimeout(hostTimer);
      if (pending) clearTimeout(pending.timer);
      await new Promise((resolve) => server.close(resolve));
      const pid = Number(
        await readFile(join(plugin, 'helper/dist/timeout-pid'), 'utf8').catch(
          () => '',
        ),
      );
      if (mode.includes('timeout')) {
        row.timeoutPidRecorded = Number.isSafeInteger(pid) && pid > 0;
        row.timeoutChildAlive = null;
        if (row.timeoutPidRecorded) {
          try {
            process.kill(pid, 0);
            row.timeoutChildAlive = true;
          } catch (error) {
            if (error.code === 'ESRCH') row.timeoutChildAlive = false;
          }
        }
        // A numeric PID is observation only; never signal a possibly reused PID.
        row.passed &&=
          row.timeoutPidRecorded && row.timeoutChildAlive === false;
      }
      await rm(join(plugin, 'helper/dist/timeout-pid'), { force: true });
    }
    results.push(row);
    console.log(JSON.stringify(row));
    if (!row.passed) process.exitCode = 1;
  }
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        hostVersion,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        engineVersion: '0.1.0-beta.14',
        sourceSha256,
        syntheticFaultWrapper: true,
        results,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
