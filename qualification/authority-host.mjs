import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withPythonDependencies } from '../scripts/python-probe.mjs';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

const root = resolve(process.env.REDACTON_PLUGIN_ROOT ?? '.');
const dir = await mkdtemp(join(tmpdir(), 'redacton-authority-'));
let modelRequests = 0;
const endpoint = http.createServer((request, response) => {
  if (!request.url.includes('count_tokens')) modelRequests++;
  response.writeHead(503).end();
});
try {
  await new Promise((done) => endpoint.listen(0, '127.0.0.1', done));
  const port = endpoint.address().port;
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
  async function launch(command) {
    const child = spawn(
      claudeBinary,
      [
        '-p',
        command,
        '--plugin-dir',
        resolve('qualification/authority-companion'),
        '--plugin-dir',
        root,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--permission-mode',
        'dontAsk',
      ],
      { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-65536);
    });
    child.stderr.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 20000);
    try {
      const exitCode = await new Promise((done, reject) => {
        child.once('exit', done);
        child.once('error', reject);
      });
      return { exitCode, output };
    } finally {
      clearTimeout(timeout);
    }
  }
  const on = await launch('/redacton');
  const off = await launch('/redactoff');
  const plugin = await launch('/authorityprobe');
  const passed =
    on.exitCode === 0 &&
    on.output.includes('Redacton ON') &&
    off.exitCode === 0 &&
    (off.output.includes('REDACTON_USER_ACTION_REQUIRED') ||
      off.output.includes('REDACTON_PROVENANCE_REWRITE_REJECTED')) &&
    plugin.exitCode === 0 &&
    plugin.output.includes('REDACTON_AUTHORITY_PROBE_PASSED') &&
    modelRequests === 0;
  console.log(
    JSON.stringify({
      hostVersion,
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      sdkRecoveryUsable: on.output.includes('Redacton ON'),
      sdkDisableDenied:
        off.output.includes('REDACTON_USER_ACTION_REQUIRED') ||
        off.output.includes('REDACTON_PROVENANCE_REWRITE_REJECTED'),
      pluginMutationsDenied: plugin.output.includes(
        'REDACTON_AUTHORITY_PROBE_PASSED',
      ),
      nestedCommandAttemptsBlocked: plugin.output.includes(
        'REDACTON_AUTHORITY_PROBE_PASSED',
      ),
      originRewriteRejected: off.output.includes(
        'REDACTON_PROVENANCE_REWRITE_REJECTED',
      ),
      modelRequests,
      passed,
    }),
  );
  if (!passed) process.exitCode = 1;
  await withPythonDependencies(async ({ python, dependencies, temporary }) => {
    for (const columns of [140, 80]) {
      const execution = spawnSync(
        python,
        [
          resolve('qualification/normal-ui.py'),
          '--plugin-root',
          root,
          '--fixture-root',
          resolve('.'),
        ],
        {
          encoding: 'utf8',
          timeout: 180000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            REDACTON_PYTE_PATH: dependencies,
            REDACTON_PROBE_TMP_ROOT: temporary,
            REDACTON_UI_COLUMNS: String(columns),
          },
        },
      );
      let report;
      try {
        report = JSON.parse(execution.stdout.trim());
      } catch {
        report = {};
      }
      const terminalPassed =
        execution.status === 0 &&
        !execution.error &&
        report.completed === true &&
        report.modelRequests === 0 &&
        [
          'offCommandExecuted',
          'immediateWarningObserved',
          'warningBeforeTyping',
          'warningAfterTyping',
          'onCommandExecuted',
          'offWarningClearedOn',
          'repeatedOffWarningRestored',
          'actualBashCompletedWhileOff',
          'warningAfterActualBash',
        ].every((key) => report[key] === true);
      console.log(
        JSON.stringify({
          code: 'REDACTON_TERMINAL_AUTHORITY',
          hostVersion,
          columns,
          localUserOffPassed: terminalPassed,
          modelRequests: report.modelRequests === 0 ? 0 : null,
        }),
      );
      if (!terminalPassed) process.exitCode = 1;
    }
  });
} finally {
  await new Promise((done) => endpoint.close(done));
  await rm(dir, { recursive: true, force: true });
}
