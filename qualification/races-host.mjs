import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

const root = resolve(process.env.REDACTON_PLUGIN_ROOT ?? '.');
const synthetic = 'ghp_SYNTHETICREVOKED00000000000000000000';
const results = [];
for (const direction of ['on-to-off', 'off-to-on']) {
  const dir = await mkdtemp(join(tmpdir(), 'redacton-race-'));
  const companion = join(dir, 'companion');
  const control = join(dir, 'control.mjs');
  let child;
  let server;
  try {
    await cp(resolve('qualification/race-companion'), companion, {
      recursive: true,
    });
    await writeFile(
      control,
      `import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
const start=new URL('./started',import.meta.url),release=new URL('./release',import.meta.url),counter=new URL('./executions',import.meta.url);
const wait=async path=>{const deadline=Date.now()+12000;while(!existsSync(path)){if(Date.now()>deadline)process.exit(1);await new Promise(r=>setTimeout(r,10));}};
if(process.argv[2]==='wait')await wait(start);
else if(process.argv[2]==='release')writeFileSync(release,'1');
else {appendFileSync(counter,'x');if(process.argv[2]==='hold'){writeFileSync(start,'1');await wait(release);}process.stdout.write(${JSON.stringify(synthetic)}+'\\n');}
`,
    );
    const captures = [];
    let step = 0;
    server = http.createServer(async (request, response) => {
      let bytes = '';
      for await (const chunk of request) bytes += chunk;
      if (request.url.includes('count_tokens')) {
        response.end('{"input_tokens":1}');
        return;
      }
      const parsed = JSON.parse(bytes);
      captures.push(parsed);
      const index = Math.floor(step / 2);
      const tool = step++ % 2 === 0;
      const command = `node '${control.replaceAll("'", "'\\''")}' ${index === 0 ? 'hold' : 'output'}`;
      const content = tool
        ? [
            {
              type: 'tool_use',
              id: `race_tool_${index}`,
              name: 'Bash',
              input: { command },
            },
          ]
        : [{ type: 'text', text: 'RACE_DONE' }];
      const message = {
        id: 'msg_race',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content,
        stop_reason: tool ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      if (!parsed.stream) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(message));
        return;
      }
      response.setHeader('content-type', 'text/event-stream');
      const send = (type, value) =>
        response.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`,
        );
      send('message_start', {
        message: { ...message, content: [], stop_reason: null },
      });
      send('content_block_start', {
        index: 0,
        content_block: tool
          ? { ...content[0], input: {} }
          : { type: 'text', text: '' },
      });
      send('content_block_delta', {
        index: 0,
        delta: tool
          ? {
              type: 'input_json_delta',
              partial_json: JSON.stringify(content[0].input),
            }
          : { type: 'text_delta', text: 'RACE_DONE' },
      });
      send('content_block_stop', { index: 0 });
      send('message_delta', {
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      send('message_stop', {});
      response.end();
    });
    await new Promise((resolveListen) =>
      server.listen(0, '127.0.0.1', resolveListen),
    );
    child = spawn(
      claudeBinary,
      [
        '-p',
        '--plugin-dir',
        root,
        '--plugin-dir',
        companion,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        'Bash',
        '--model',
        'claude-sonnet-4-6',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-session-persistence',
      ],
      {
        cwd: dir,
        env: {
          ...isolatedPlatformEnvironment(dir),
          PATH: process.env.PATH,
          HOME: dir,
          CLAUDE_CONFIG_DIR: join(dir, 'config'),
          REDACTON_SETTINGS_ROOT: join(dir, 'settings'),
          ANTHROPIC_API_KEY: 'synthetic-local-only',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let phase = 0,
      offset = 0,
      output = '',
      firstScans = -1,
      finalScans = -1,
      phaseVerified = false,
      toggleSent = false,
      toggleObserved = false,
      releaseTimer,
      polling;
    const send = (text, resetOffset = true) => {
      if (resetOffset) offset = output.length;
      child.stdin.write(
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`,
      );
    };
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const fresh = output.slice(offset);
      const report = /RACE_REPORT_(\d+)/.exec(fresh);
      const toggleAck =
        direction === 'on-to-off'
          ? 'Warning: Redacton is OFF.'
          : 'Redacton ON.';
      if (
        phase === 1 &&
        toggleSent &&
        !toggleObserved &&
        fresh.includes(toggleAck)
      ) {
        toggleObserved = true;
        phaseVerified = captures.length === 1;
        clearTimeout(releaseTimer);
        void writeFile(join(dir, 'release'), '1');
      }
      if (
        phase === 0 &&
        fresh.includes(
          direction === 'on-to-off'
            ? 'Redacton ON.'
            : 'Warning: Redacton is OFF.',
        )
      ) {
        phase = 1;
        send('Run the supplied local synthetic tool once.');
      } else if (phase === 1 && fresh.includes('RACE_DONE')) {
        phase = 2;
        send('/race-report');
      } else if (phase === 2 && report) {
        firstScans = Number(report[1]);
        phase = 3;
        send('Run the second supplied local synthetic tool once.');
      } else if (phase === 3 && fresh.includes('RACE_DONE')) {
        phase = 4;
        send('/race-report');
      } else if (phase === 4 && report) {
        finalScans = Number(report[1]);
        phase = 5;
        child.stdin.end();
      }
    });
    child.stderr.on('data', () => {});
    polling = setInterval(async () => {
      if (toggleSent || phase !== 1) return;
      try {
        await access(join(dir, 'started'));
      } catch {
        return;
      }
      if (toggleSent || phase !== 1) return;
      toggleSent = true;
      send(direction === 'on-to-off' ? '/redactoff' : '/redacton', false);
      releaseTimer = setTimeout(() => {
        void writeFile(join(dir, 'release'), '1');
      }, 4000);
    }, 10);
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    send(direction === 'on-to-off' ? '/redacton' : '/redactoff');
    let exitCode;
    try {
      exitCode = await new Promise((resolveExit, reject) => {
        child.once('exit', resolveExit);
        child.once('error', reject);
      });
    } finally {
      clearTimeout(timer);
      clearTimeout(releaseTimer);
      clearInterval(polling);
    }
    const toolResults = captures
      .flatMap((request) => request.messages ?? [])
      .flatMap((message) =>
        Array.isArray(message.content)
          ? message.content.filter((block) => block.type === 'tool_result')
          : [],
      );
    const first = toolResults
      .filter((block) => block.tool_use_id === 'race_tool_0')
      .at(-1);
    const second = toolResults
      .filter((block) => block.tool_use_id === 'race_tool_1')
      .at(-1);
    const firstRaw = JSON.stringify(first ?? null).includes(synthetic),
      secondRaw = JSON.stringify(second ?? null).includes(synthetic);
    const firstRedacted = JSON.stringify(first ?? null).includes('<SECRET_1>'),
      secondRedacted = JSON.stringify(second ?? null).includes('<SECRET_1>');
    const executions = (
      await readFile(join(dir, 'executions'), 'utf8').catch(() => '')
    ).length;
    const passed =
      exitCode === 0 &&
      phase === 5 &&
      phaseVerified &&
      captures.length === 4 &&
      executions === 2 &&
      finalScans === 1 &&
      (direction === 'on-to-off'
        ? firstScans === 1 && !firstRaw && firstRedacted && secondRaw
        : firstScans === 0 && firstRaw && !secondRaw && secondRedacted);
    results.push({
      direction,
      code: passed
        ? 'RACE_PASSED'
        : !phaseVerified
          ? 'RACE_PHASE_UNAVAILABLE'
          : 'RACE_BOUNDARY_FAILED',
      status: passed ? 'passed' : phaseVerified ? 'failed' : 'blocked',
      phaseVerified,
      toggleObserved,
      executions,
      firstScans,
      finalScans,
      modelRequests: captures.length,
    });
  } finally {
    child?.kill('SIGKILL');
    server?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify({
    hostVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    results,
  }),
);
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
else if (results.some((result) => result.status === 'blocked'))
  process.exitCode = 2;
