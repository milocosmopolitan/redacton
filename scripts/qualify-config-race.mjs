import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  configRaceDiagnostics,
  validateConfigRaceReport,
} from './config-race-evidence.mjs';
import { withPythonDependencies } from './python-probe.mjs';
import { windowsPtyDiagnostics } from './terminal-ui-evidence.mjs';

try {
  const root = process.env.REDACTON_PLUGIN_ROOT;
  if (!root) throw new Error('PACKAGED_PLUGIN_REQUIRED');
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const candidateSource = await readFile(join(root, 'mod/index.tsx'));
  if (hash(candidateSource) !== hash(await readFile('mod/index.tsx')))
    throw new Error('CANDIDATE_SOURCE_REQUIRED');
  await withPythonDependencies(async ({ python, dependencies, temporary }) => {
    const report = join(temporary, 'config-race.json');
    const result = spawnSync(
      python,
      [
        resolve('qualification/interactive-config-race.py'),
        '--plugin-root',
        resolve(root),
        '--report',
        report,
      ],
      {
        encoding: 'utf8',
        timeout: 90000,
        maxBuffer: 1048576,
        env: {
          ...process.env,
          REDACTON_PYTE_PATH: dependencies,
          REDACTON_PROBE_TMP_ROOT: temporary,
          REDACTON_NODE_BINARY: process.execPath,
        },
      },
    );
    for (const diagnostic of windowsPtyDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(diagnostic));
    for (const diagnostic of configRaceDiagnostics(result.stdout ?? ''))
      if (diagnostic.code === 'CONFIG_HELPER_DIAGNOSTICS')
        console.log(JSON.stringify(diagnostic));
    if (result.error || (await stat(report)).size > 4096)
      throw new Error('CONFIG_RACE_REPORT_INVALID');
    if (
      hash(await readFile(join(root, 'mod/index.tsx'))) !==
      hash(candidateSource)
    )
      throw new Error('CANDIDATE_SOURCE_CHANGED');
    const row = validateConfigRaceReport(
      JSON.parse(await readFile(report, 'utf8')),
      hash(candidateSource),
      result.status,
    );
    console.log(JSON.stringify({ code: 'CONFIG_RACE_ROW', ...row }));
    process.exitCode = row.status === 'passed' ? 0 : 1;
  });
} catch (error) {
  const prerequisite =
    error.message === 'PYTHON_PROBE_PREREQUISITE_UNAVAILABLE';
  console.log(
    JSON.stringify({
      code: prerequisite
        ? 'CONFIG_RACE_PREREQUISITE_UNAVAILABLE'
        : 'CONFIG_RACE_REJECTED',
    }),
  );
  process.exitCode = prerequisite ? 2 : 1;
}
