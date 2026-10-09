import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withPythonDependencies } from './python-probe.mjs';
import { windowsPtyDiagnostics } from './terminal-ui-evidence.mjs';

const integer = (value, min, max) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const stages = [
  'startup',
  'initial',
  'hold',
  'toggle',
  'first',
  'first-report',
  'second',
  'second-report',
  'complete',
];
export function validateRaceReport(report, sourceDigest, exitCode) {
  if (
    !report ||
    typeof report !== 'object' ||
    Object.keys(report).sort().join(',') !==
      'hostVersion,modSourceSha256,results' ||
    report.hostVersion !== '2.1.294' ||
    report.modSourceSha256 !== sourceDigest ||
    !Array.isArray(report.results) ||
    report.results.length !== 2
  )
    throw new Error('RACE_REPORT_INVALID');
  const rows = report.results.map((row, index) => {
    if (
      !row ||
      typeof row !== 'object' ||
      row.direction !== ['on-to-off', 'off-to-on'][index] ||
      !['passed', 'blocked', 'failed'].includes(row.status) ||
      !stages.includes(row.finalStage) ||
      typeof row.phaseVerified !== 'boolean' ||
      typeof row.toggleObserved !== 'boolean' ||
      !integer(row.executions, 0, 8) ||
      !integer(row.modelRequests, 0, 8) ||
      !integer(row.firstScans, -1, 1000) ||
      !integer(row.finalScans, -1, 1000)
    )
      throw new Error('RACE_REPORT_INVALID');
    if (
      row.status === 'passed' &&
      (row.code !== 'RACE_PASSED' ||
        row.finalStage !== 'complete' ||
        !row.phaseVerified ||
        !row.toggleObserved ||
        !['handler', 'prompt-policy'].includes(row.receiptKind) ||
        row.executions !== 2 ||
        row.modelRequests !== 4 ||
        row.finalScans !== 1 ||
        row.firstScans !== (index === 0 ? 1 : 0) ||
        row.toolResultCount !== 2 ||
        row.firstResultPresent !== true ||
        row.firstResultError !== false ||
        row.protectedMarkerAbsentEveryRequest !== true)
    )
      throw new Error('RACE_REPORT_INVALID');
    if (
      row.status === 'blocked' &&
      (row.code !== 'RACE_PHASE_UNAVAILABLE' ||
        row.finalStage !== 'toggle' ||
        row.phaseVerified ||
        row.toggleObserved ||
        row.executions !== 1 ||
        row.modelRequests !== 1)
    )
      throw new Error('RACE_REPORT_INVALID');
    if (row.status === 'failed' && row.code !== 'RACE_BOUNDARY_FAILED')
      throw new Error('RACE_REPORT_INVALID');
    return {
      code: 'INTERACTIVE_RACE_ROW',
      direction: row.direction,
      status: row.status,
      finalStage: row.finalStage,
      gateCode: row.code,
      phaseVerified: row.phaseVerified,
      toggleObserved: row.toggleObserved,
      executions: row.executions,
      firstScans: row.firstScans,
      finalScans: row.finalScans,
      modelRequests: row.modelRequests,
    };
  });
  const expectedExit = rows.some((row) => row.status === 'failed')
    ? 1
    : rows.some((row) => row.status === 'blocked')
      ? 2
      : 0;
  if (exitCode !== expectedExit) throw new Error('RACE_EXIT_INVALID');
  return rows;
}

async function main() {
  const root = process.env.REDACTON_PLUGIN_ROOT;
  if (!root) throw new Error('PACKAGED_PLUGIN_REQUIRED');
  const sourceDigest = createHash('sha256')
    .update(await readFile(join(root, 'mod/index.tsx')))
    .digest('hex');
  await withPythonDependencies(async ({ python, dependencies, temporary }) => {
    const reportPath = join(temporary, 'race-report.json');
    const execution = spawnSync(
      python,
      [
        resolve('qualification/interactive-races.py'),
        '--plugin-root',
        root,
        '--report',
        reportPath,
      ],
      {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          REDACTON_PYTE_PATH: dependencies,
          REDACTON_NODE_BINARY: process.execPath,
          REDACTON_PROBE_TEMP: temporary,
        },
      },
    );
    for (const diagnostic of windowsPtyDiagnostics(execution.stdout ?? ''))
      console.log(JSON.stringify(diagnostic));
    if (execution.error)
      throw new Error(
        execution.error.code === 'ETIMEDOUT'
          ? 'RACE_TIMEOUT'
          : 'RACE_HARNESS_FAILED',
      );
    let bytes;
    try {
      bytes = await readFile(reportPath);
    } catch {
      throw new Error('RACE_HARNESS_FAILED');
    }
    if (bytes.length > 4096) throw new Error('RACE_REPORT_INVALID');
    const report = JSON.parse(bytes);
    for (const row of validateRaceReport(
      report,
      sourceDigest,
      execution.status,
    ))
      console.log(JSON.stringify(row));
    process.exitCode = execution.status;
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    const unavailable =
      error.message === 'PYTHON_PROBE_PREREQUISITE_UNAVAILABLE';
    const gateCode = unavailable
      ? 'PREREQUISITE_UNAVAILABLE'
      : error.message === 'RACE_TIMEOUT'
        ? 'TIMEOUT'
        : error.message === 'RACE_HARNESS_FAILED'
          ? 'HARNESS_FAILED'
          : 'REPORT_INVALID';
    console.log(
      JSON.stringify({
        code: 'INTERACTIVE_RACE_FAILURE',
        gateCode,
      }),
    );
    process.exitCode = unavailable ? 2 : 1;
  }
}
