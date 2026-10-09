import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

// Audit only: synthetic content stays in an isolated loopback model and temp tree.
const mode = process.argv[2];
if (!['grep', 'glob', 'write', 'webfetch', 'mcp'].includes(mode))
  throw new Error('ROUTE_MODE_REQUIRED');
const root = resolve(process.env.REDACTON_PLUGIN_ROOT ?? '.');
const dir = await mkdtemp(join(tmpdir(), 'redacton-routes-'));
const marker = 'ghp_SYNTHETICREVOKED00000000000000000000';
const captures = [];
let emitted = false;
let server;
let tool;
let input;
let resourceRequests = 0;
try {
  await writeFile(join(dir, 'synthetic.txt'), `${marker}\n`);
  await writeFile(join(dir, `${marker}.txt`), 'synthetic path only\n');
  const mcp = join(dir, 'synthetic-mcp.mjs');
  await writeFile(
    mcp,
    `import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
for await(const line of lines){let q;try{q=JSON.parse(line)}catch{continue}if(q.id===undefined)continue;
let result=q.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1.0'}}:q.method==='tools/list'?{tools:[{name:'probe',description:'Synthetic audit',inputSchema:{type:'object',properties:{}}}]}:q.method==='tools/call'?{content:[{type:'text',text:${JSON.stringify(marker)}}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');}
`,
  );
  server = http.createServer(async (req, res) => {
    if (req.method === 'GET') {
      resourceRequests++;
      res.setHeader('content-type', 'text/plain');
      res.end(`${marker}\n`);
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let request;
    try {
      request = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.url.includes('count_tokens')) {
      res.end('{"input_tokens":1}');
      return;
    }
    captures.push(request);
    const content = !emitted
      ? [{ type: 'tool_use', id: 'route_probe_1', name: tool, input }]
      : [{ type: 'text', text: 'ROUTE_DONE' }];
    emitted = true;
    const message = {
      id: 'msg_route',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content,
      stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    if (!request.stream) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(message));
      return;
    }
    res.setHeader('content-type', 'text/event-stream');
    const send = (type, value) =>
      res.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`,
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
          ? { type: 'input_json_delta', partial_json: JSON.stringify(input) }
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
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const definitions = {
    grep: [
      'Grep',
      { pattern: 'SYNTHETICREVOKED', path: dir, output_mode: 'content' },
    ],
    glob: ['Glob', { pattern: '*.txt', path: dir }],
    write: [
      'Write',
      { file_path: join(dir, 'written.txt'), content: `${marker}\n` },
    ],
    webfetch: [
      'WebFetch',
      {
        url: `http://127.0.0.1:${port}/synthetic`,
        prompt: 'Return the synthetic text.',
      },
    ],
    mcp: ['mcp__synthetic__probe', {}],
  };
  [tool, input] = definitions[mode];
  const env = {
    ...isolatedPlatformEnvironment(dir),
    PATH: process.env.PATH,
    HOME: dir,
    CLAUDE_CONFIG_DIR: join(dir, 'config'),
    REDACTON_SETTINGS_ROOT: join(dir, 'settings'),
    ANTHROPIC_API_KEY: 'synthetic-local-only',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  async function launch(prompt) {
    const child = spawn(
      claudeBinary,
      [
        '-p',
        prompt,
        '--plugin-dir',
        root,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        JSON.stringify({
          mcpServers:
            mode === 'mcp'
              ? { synthetic: { command: process.execPath, args: [mcp] } }
              : {},
        }),
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        tool,
        '--model',
        'claude-sonnet-4-6',
      ],
      { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (bytes) => {
      output = (output + bytes).slice(-65536);
    });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGTERM'), 45000);
    try {
      const exitCode = await new Promise((done, reject) => {
        child.once('exit', done);
        child.once('error', reject);
      });
      return { exitCode, output };
    } finally {
      clearTimeout(timer);
    }
  }
  const preflight = await launch('/redacton');
  if (
    preflight.exitCode !== 0 ||
    !preflight.output.includes('Protect ready') ||
    captures.length
  )
    throw new Error('ROUTE_PREFLIGHT_UNAVAILABLE');
  const result = await launch('Run the isolated synthetic route audit.');
  const results = captures
    .flatMap((request) => request.messages ?? [])
    .flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    )
    .filter((block) => block.type === 'tool_result');
  let writeContainsMarker = false;
  try {
    writeContainsMarker = (
      await readFile(join(dir, 'written.txt'), 'utf8')
    ).includes(marker);
  } catch {}
  const offered =
    captures[0]?.tools?.some((entry) => entry.name === tool) ?? false;
  console.log(
    JSON.stringify({
      mode,
      hostVersion,
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      pluginLoaded: true,
      exitCode: result.exitCode,
      toolOffered: offered,
      modelRequests: captures.length,
      toolResults: results.length,
      resultContainsMarker: results.some((block) =>
        JSON.stringify(block.content).includes(marker),
      ),
      writeContainsMarker,
      resourceRequests,
      toolError: results.some((block) => block.is_error === true),
    }),
  );
  if (result.exitCode !== 0 || !offered || !results.length)
    process.exitCode = 1;
} finally {
  if (server) await new Promise((done) => server.close(done));
  await rm(dir, { recursive: true, force: true });
}
