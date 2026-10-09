import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { terminalUiChecks } from './terminal-ui-evidence.mjs';

if (!['darwin', 'linux'].includes(process.platform))
  throw new Error('TERMINAL_UI_PLATFORM_UNAVAILABLE');
const pluginRoot = process.env.REDACTON_PLUGIN_ROOT;
if (!pluginRoot) throw new Error('PACKAGED_PLUGIN_REQUIRED');
const temporary = await mkdtemp(join(tmpdir(), 'redacton-ui-evidence-'));
const python = process.env.REDACTON_PYTHON_BINARY || 'python3';
function run(args, env = process.env, inspectReport = false) {
  const result = spawnSync(python, args, {
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 1024 * 1024,
    env,
  });
  if (!inspectReport && (result.status !== 0 || result.error)) {
    const unavailable =
      result.error?.code === 'ENOENT' ||
      /No module named pip/.test(result.stderr ?? '');
    throw new Error(
      unavailable
        ? 'TERMINAL_UI_PREREQUISITE_UNAVAILABLE'
        : 'TERMINAL_UI_BOOTSTRAP_FAILED',
    );
  }
  return result;
}
try {
  const dependencies = join(temporary, 'dependencies');
  run([
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-cache-dir',
    '--require-hashes',
    '--target',
    dependencies,
    '-r',
    resolve('qualification/ui-requirements.txt'),
  ]);
  let failed = false;
  for (const columns of [140, 80]) {
    const report = join(temporary, `${columns}.json`);
    const execution = run(
      [
        'qualification/normal-ui.py',
        '--ux',
        '--plugin-root',
        pluginRoot,
        '--fixture-root',
        resolve('.'),
        '--report',
        report,
      ],
      {
        ...process.env,
        REDACTON_PYTE_PATH: dependencies,
        REDACTON_UI_COLUMNS: String(columns),
        DISABLE_AUTOUPDATER: '1',
      },
      true,
    );
    let value;
    try {
      const bytes = await readFile(report);
      if (bytes.length > 1024 * 1024) throw new Error('REPORT_LIMIT');
      value = JSON.parse(bytes);
      if (!value || typeof value.result !== 'object' || !value.result)
        throw new Error('REPORT_INVALID');
    } catch {
      console.log(
        JSON.stringify({
          code: 'TERMINAL_UI_ROW',
          columns,
          completed: false,
          missing: terminalUiChecks,
        }),
      );
      console.log(JSON.stringify({ code: 'TERMINAL_UI_REPORT_INVALID' }));
      failed = true;
      continue;
    }
    const result = value.result;
    const required = terminalUiChecks;
    const missing = required.filter((key) => result?.[key] !== true);
    console.log(
      JSON.stringify({
        code: 'TERMINAL_UI_ROW',
        columns,
        completed: result?.completed === true,
        missing,
      }),
    );
    if (
      execution.status !== 0 ||
      execution.error ||
      value.hostVersion !== '2.1.294' ||
      result?.terminalColumns !== columns ||
      result.terminalRows !== 40 ||
      result.modelRequests !== 0 ||
      result.customToolExecutions !== 2 ||
      result.formPatternPersistedFiles !== 0 ||
      !Number.isSafeInteger(result.helperCallsBeforeOff) ||
      result.helperCallsBeforeOff < 0 ||
      result.helperCallsBeforeOff > 1000 ||
      !Number.isSafeInteger(result.helperCallsAfterOff) ||
      result.helperCallsBeforeOff !== result.helperCallsAfterOff ||
      !Array.isArray(result.previewObservedActions) ||
      !result.previewObservedActions.some(
        (pair) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          pair[0] === 'redact' &&
          pair[1] === 'none',
      ) ||
      required.some((key) => result[key] !== true)
    ) {
      console.log(JSON.stringify({ code: 'TERMINAL_UI_CHECK_FAILED' }));
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
  else
    console.log(
      JSON.stringify({
        code: 'TERMINAL_UI_VERIFIED',
        host: '2.1.294',
        sizes: ['140x40', '80x40'],
        modelRequests: 0,
        scope:
          'synthetic-terminal-only; Desktop and independent usability unqualified',
      }),
    );
} catch (error) {
  const code =
    error.message === 'TERMINAL_UI_PREREQUISITE_UNAVAILABLE'
      ? error.message
      : 'TERMINAL_UI_BOOTSTRAP_FAILED';
  console.log(JSON.stringify({ code }));
  process.exitCode = code === 'TERMINAL_UI_PREREQUISITE_UNAVAILABLE' ? 2 : 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
