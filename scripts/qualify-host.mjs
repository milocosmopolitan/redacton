import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readTar } from './artifact-archive.mjs';
import { cancellationDiagnostics } from './cancellation-evidence.mjs';
import { configRaceDiagnostics } from './config-race-evidence.mjs';
import { faultDiagnostics } from './fault-evidence.mjs';
import { preparePythonDependencies } from './python-probe.mjs';
import { requiredGates } from './qualification-evidence.mjs';
import { raceDiagnostics } from './race-evidence.mjs';
import {
  terminalUiDiagnostics,
  windowsPtyDiagnostics,
} from './terminal-ui-evidence.mjs';

const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (sha.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(sha.stdout))
  throw new Error('SOURCE_ID_UNAVAILABLE');
const dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('SOURCE_DIRTY');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const packageOnly = process.argv.includes('--package-only');
const probeArgument = process.argv.find((argument) =>
  argument.startsWith('--probe='),
);
const onlyProbe = probeArgument?.slice('--probe='.length) ?? 'all';
if (
  !['all', 'terminal-ui', 'guarded-errors', 'config-races'].includes(
    onlyProbe,
  ) ||
  (packageOnly && onlyProbe !== 'all')
)
  throw new Error('PROBE_SELECTION_INVALID');
const gates = Object.fromEntries(requiredGates.map((key) => [key, 'blocked']));
const gateCodes = Object.fromEntries(
  requiredGates.map((key) => [
    key,
    packageOnly || onlyProbe !== 'all' ? 'NOT_RUN' : 'MANUAL_REQUIRED',
  ]),
);
const host = packageOnly
  ? { status: null, stdout: '' }
  : spawnSync(process.env.CLAUDE_BINARY ?? 'claude', ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
    });
if (!packageOnly && (host.status !== 0 || !host.stdout.startsWith('2.1.294 ')))
  throw new Error('PINNED_HOST_UNAVAILABLE');
const archive = await readFile(`artifacts/redacton-${pkg.version}.tar.gz`);
const temp = await mkdtemp(join(tmpdir(), 'redacton-ci-host-'));
const pluginRoot = join(temp, `redacton-${pkg.version}`);
let pythonDependencies;
let pythonBootstrapFailure;
function run(gate, script, ...args) {
  if (onlyProbe !== 'all' && gate !== onlyProbe && gate !== 'package') return;
  const needsPython =
    ['terminal-ui', 'toggle-races', 'config-races', 'off'].includes(gate) ||
    (gate === 'cancellation' && process.platform === 'win32');
  if (needsPython && pythonBootstrapFailure) {
    gates[gate] = pythonBootstrapFailure.status;
    gateCodes[gate] = pythonBootstrapFailure.code;
    console.log(JSON.stringify({ gate, ...pythonBootstrapFailure }));
    return;
  }
  // Harness stdout/stderr is discarded. Only a fixed gate and result leave this wrapper.
  const result = spawnSync(process.execPath, [script, ...args], {
    timeout: gate === 'terminal-ui' ? 450000 : 240000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
    env: {
      ...process.env,
      REDACTON_PLUGIN_ROOT: pluginRoot,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ...(pythonDependencies
        ? { REDACTON_PROBE_PYTHON_DEPS: pythonDependencies }
        : {}),
    },
  });
  if (gate === 'terminal-ui')
    for (const diagnostic of terminalUiDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(diagnostic));
  if (gate === 'toggle-races' || gate === 'config-races') {
    const diagnostics =
      gate === 'config-races' ? configRaceDiagnostics : raceDiagnostics;
    for (const value of diagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(value));
    for (const value of windowsPtyDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(value));
  }
  if (gate === 'cancellation') {
    for (const value of cancellationDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(value));
    for (const value of windowsPtyDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(value));
  }
  if (gate === 'guarded-errors' && script === 'qualification/failure-host.mjs')
    for (const diagnostic of faultDiagnostics(result.stdout ?? ''))
      console.log(JSON.stringify(diagnostic));
  gates[gate] =
    result.status === 0 && !result.error
      ? 'passed'
      : result.status === 2 &&
          !result.error &&
          ['toggle-races', 'config-races', 'terminal-ui'].includes(gate)
        ? 'blocked'
        : 'failed';
  gateCodes[gate] =
    gates[gate] === 'passed'
      ? 'PASS'
      : gates[gate] === 'blocked'
        ? gate === 'toggle-races'
          ? 'RACE_PHASE_UNAVAILABLE'
          : 'PREREQUISITE_UNAVAILABLE'
        : result.error?.code === 'ETIMEDOUT'
          ? 'TIMEOUT'
          : result.error
            ? 'PROCESS_FAILED'
            : 'PROBE_FAILED';
  console.log(
    JSON.stringify({ gate, status: gates[gate], code: gateCodes[gate] }),
  );
}
try {
  for (const [path, bytes] of readTar(archive)) {
    const destination = join(temp, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, bytes);
  }
  const provenance = JSON.parse(
    await readFile(join(pluginRoot, 'PROVENANCE.json'), 'utf8'),
  );
  const runtime = JSON.parse(
    await readFile(join(pluginRoot, 'package.json'), 'utf8'),
  );
  const plugin = JSON.parse(
    await readFile(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'),
  );
  if (
    provenance.source?.commit !== sha.stdout.trim() ||
    provenance.source?.dirty !== false ||
    provenance.engine !== '@redact-secret/core@0.1.0-beta.14' ||
    provenance.sourceLockSha256 !==
      createHash('sha256')
        .update(await readFile('package-lock.json'))
        .digest('hex') ||
    runtime.dependencies?.['@redact-secret/core'] !==
      pkg.dependencies['@redact-secret/core'] ||
    runtime.version !== pkg.version ||
    plugin.version !== pkg.version
  )
    throw new Error('ARTIFACT_SOURCE_IDENTITY_MISMATCH');
  if (!packageOnly) run('sdk', 'scripts/test-mod.mjs', '--validate');
  if (gates.sdk === 'passed') run('sdk', 'scripts/test-mod.mjs');
  run('package', 'scripts/verify-artifact.mjs', '--native');
  if (gates.package === 'passed')
    run(
      'package',
      'scripts/verify-installed-artifact.mjs',
      ...(packageOnly ? ['--fixture-claude'] : []),
    );
  if (!packageOnly) {
    if (['all', 'terminal-ui'].includes(onlyProbe)) {
      try {
        pythonDependencies = await preparePythonDependencies(temp);
      } catch (error) {
        pythonBootstrapFailure =
          error.message === 'PYTHON_PROBE_PREREQUISITE_UNAVAILABLE'
            ? { status: 'blocked', code: 'PREREQUISITE_UNAVAILABLE' }
            : { status: 'failed', code: 'PROCESS_FAILED' };
      }
    }
    for (const [gate, mode] of [
      ['prompt', 'prompt'],
      ['read', 'read'],
      ['bash', 'bash'],
      ['off', 'off'],
      ['permission-denial', 'denied-bash'],
    ])
      run(gate, 'qualification/integration-host.mjs', mode);
    if (gates.off === 'passed')
      run('off', 'qualification/stream-session-host.mjs');
    if (gates.off === 'passed') run('off', 'qualification/authority-host.mjs');
    run(
      'guarded-errors',
      'qualification/host-boundary-host.mjs',
      'guarded-catch-failure',
    );
    if (gates['guarded-errors'] === 'passed')
      run('guarded-errors', 'qualification/failure-host.mjs');
    run('sessions', 'qualification/session-host.mjs');
    run(
      'cancellation',
      process.platform === 'win32'
        ? 'scripts/qualify-cancellation.mjs'
        : 'qualification/cancellation-host.mjs',
    );
    run('toggle-races', 'scripts/qualify-races.mjs');
    run('config-races', 'scripts/qualify-config-race.mjs');
    run('terminal-ui', 'scripts/qualify-ui.mjs');
  }
  const wsl =
    process.platform === 'linux' &&
    /microsoft|wsl/i.test(await readFile('/proc/sys/kernel/osrelease', 'utf8'));
  if (
    wsl &&
    !/wsl2/i.test(await readFile('/proc/sys/kernel/osrelease', 'utf8'))
  )
    throw new Error('WSL2_REQUIRED');
  const value = {
    schemaVersion: 1,
    sourceSha: sha.stdout.trim(),
    artifactSha256: createHash('sha256').update(archive).digest('hex'),
    version: pkg.version,
    node: process.version,
    claude: '2.1.294',
    engine: pkg.dependencies['@redact-secret/core'],
    platform: wsl ? 'wsl' : process.platform,
    arch: process.arch,
    emulated: false,
    environment: wsl ? 'wsl2' : 'native',
    gates,
    gateCodes,
  };
  const destination = resolve(
    process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
      'qualification/results/ci-evidence',
  );
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(
      destination,
      `${value.platform}-${process.arch}-${process.versions.node.split('.')[0]}.json`,
    ),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  if (Object.values(gates).includes('failed')) process.exitCode = 1;
  console.log(
    JSON.stringify({
      code: 'HOST_PROBES_COMPLETE',
      qualification: Object.values(gates).includes('failed')
        ? 'failed'
        : Object.values(gates).includes('blocked')
          ? 'blocked'
          : 'passed',
      missing: requiredGates.filter((key) => gates[key] === 'blocked'),
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
