import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withPythonDependencies } from './python-probe.mjs';
import {
  terminalUiChecks,
  terminalUiFrame,
  terminalUiState,
  windowsPtyDiagnostics,
} from './terminal-ui-evidence.mjs';

if (!['darwin', 'linux', 'win32'].includes(process.platform))
  throw new Error('TERMINAL_UI_PLATFORM_UNAVAILABLE');
const pluginRoot = process.env.REDACTON_PLUGIN_ROOT;
if (!pluginRoot) throw new Error('PACKAGED_PLUGIN_REQUIRED');
try {
  await withPythonDependencies(async ({ python, dependencies, temporary }) => {
    function run(args, env = process.env, inspectReport = false) {
      const result = spawnSync(python, args, {
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 1024 * 1024,
        env,
      });
      for (const value of windowsPtyDiagnostics(result.stdout ?? ''))
        console.log(JSON.stringify(value));
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
    let bootstrapFailed = false;
    for (const [phase, file] of [
      ['observer', 'test-terminal-observation.py'],
      ['conpty', 'test-windows-pty.py'],
    ]) {
      const execution = run(
        [resolve(`qualification/${file}`)],
        { ...process.env, REDACTON_PYTE_PATH: dependencies },
        true,
      );
      const passed = execution.status === 0 && !execution.error;
      const stderr = execution.stderr ?? '';
      const exception = passed
        ? 'NONE'
        : /^AssertionError(?::|$)/m.test(stderr)
          ? 'ASSERTION'
          : /^(?:UnicodeDecodeError|UnicodeEncodeError):/m.test(stderr)
            ? 'UNICODE'
            : /^SyntaxError:/m.test(stderr)
              ? 'SYNTAX'
              : /^(?:ImportError|ModuleNotFoundError):/m.test(stderr)
                ? 'IMPORT'
                : execution.error
                  ? 'PROCESS'
                  : 'UNKNOWN';
      console.log(
        JSON.stringify({
          code: 'TERMINAL_UI_BOOTSTRAP',
          phase,
          passed,
          exitCode: execution.status,
          timedOut: execution.error?.code === 'ETIMEDOUT',
          exception,
        }),
      );
      bootstrapFailed ||= !passed;
    }
    if (bootstrapFailed) throw new Error('TERMINAL_UI_BOOTSTRAP_FAILED');
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
          REDACTON_PROBE_TMP_ROOT: temporary,
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
      if (!Array.isArray(result.offFrames) || result.offFrames.length > 8) {
        console.log(JSON.stringify({ code: 'TERMINAL_UI_STATE_INVALID' }));
        failed = true;
      } else {
        for (const [index, state] of result.offFrames.entries()) {
          const frame = terminalUiFrame({
            code: 'TERMINAL_UI_FRAME',
            columns,
            index,
            state,
          });
          if (!frame || Buffer.byteLength(JSON.stringify(frame)) > 4096) {
            console.log(JSON.stringify({ code: 'TERMINAL_UI_STATE_INVALID' }));
            failed = true;
          } else console.log(JSON.stringify(frame));
        }
      }
      const required = terminalUiChecks;
      const missing = required.filter((key) => result?.[key] !== true);
      const state = terminalUiState({
        stage: result.finalStage,
        focusedButton: result.focusedButton,
        receipts: result.offReceiptState,
        actions: result.offActionCounts,
      });
      if (!state) {
        console.log(JSON.stringify({ code: 'TERMINAL_UI_STATE_INVALID' }));
        failed = true;
      }
      console.log(
        JSON.stringify({
          code: 'TERMINAL_UI_ROW',
          columns,
          completed: result?.completed === true,
          missing,
          ...(state ? { state } : {}),
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
  });
} catch (error) {
  const code = [
    'TERMINAL_UI_PREREQUISITE_UNAVAILABLE',
    'PYTHON_PROBE_PREREQUISITE_UNAVAILABLE',
  ].includes(error.message)
    ? 'TERMINAL_UI_PREREQUISITE_UNAVAILABLE'
    : 'TERMINAL_UI_BOOTSTRAP_FAILED';
  console.log(JSON.stringify({ code }));
  process.exitCode = code === 'TERMINAL_UI_PREREQUISITE_UNAVAILABLE' ? 2 : 1;
}
