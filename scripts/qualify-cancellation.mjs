import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cancellationReport } from './cancellation-evidence.mjs';
import { withPythonDependencies } from './python-probe.mjs';
import { windowsPtyDiagnostics } from './terminal-ui-evidence.mjs';

try {
  if (!process.env.REDACTON_PLUGIN_ROOT)
    throw new Error('PACKAGED_PLUGIN_REQUIRED');
  await withPythonDependencies(async ({ python, dependencies, temporary }) => {
    const classifier = spawnSync(
      python,
      ['qualification/test-cancellation-classifier.py'],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 },
    );
    if (classifier.status !== 0 || classifier.error)
      throw new Error('CANCELLATION_CLASSIFIER_FAILED');
    const path = join(temporary, 'cancellation.json');
    const result = spawnSync(
      python,
      [
        'qualification/interactive-cancellation.py',
        '--plugin-root',
        resolve(process.env.REDACTON_PLUGIN_ROOT),
        '--report',
        path,
      ],
      {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 1048576,
        env: {
          ...process.env,
          REDACTON_PYTE_PATH: dependencies,
          REDACTON_PROBE_TMP_ROOT: temporary,
        },
      },
    );
    for (const value of windowsPtyDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(value));
    const bytes = await readFile(path);
    if (bytes.length > 4096) throw new Error('CANCELLATION_REPORT_LIMIT');
    const rows = cancellationReport(JSON.parse(bytes));
    if (!rows) throw new Error('CANCELLATION_REPORT_INVALID');
    for (const value of rows)
      console.log(JSON.stringify({ code: 'CANCELLATION_ROW', ...value }));
    if (
      result.status !== 0 ||
      result.error ||
      rows.some((row) => row.status !== 'passed')
    )
      throw new Error('CANCELLATION_FAILED');
  });
} catch {
  console.log(JSON.stringify({ code: 'CANCELLATION_PROBE_FAILED' }));
  process.exitCode = 1;
}
