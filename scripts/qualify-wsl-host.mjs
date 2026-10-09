import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancellationDiagnostics } from './cancellation-evidence.mjs';
import { faultDiagnostics } from './fault-evidence.mjs';
import { validateEvidence } from './qualification-evidence.mjs';
import { raceDiagnostics } from './race-evidence.mjs';
import { terminalUiDiagnostics } from './terminal-ui-evidence.mjs';

const versions = ['22.16.0', '24.21.0'];
const phases = new Set([
  'SOURCE',
  'LOCK',
  'ARTIFACT',
  'NPM',
  'DEPENDENCIES',
  'PROBES',
  'COMPLETE',
]);
const digest = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');

export function validateWslHostExport(value, sourceSha, artifactSha256) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !/^[a-f0-9]{64}$/.test(artifactSha256) ||
    !exact(value, 'schemaVersion,sourceSha,artifactSha256,rows') ||
    value.schemaVersion !== 1 ||
    value.sourceSha !== sourceSha ||
    value.artifactSha256 !== artifactSha256 ||
    !Array.isArray(value.rows) ||
    value.rows.length !== 2
  )
    throw Error('WSL_HOST_EXPORT_INVALID');
  for (const [index, row] of value.rows.entries()) {
    if (
      !exact(row, 'node,status,phase,record,diagnostics') ||
      row.node !== versions[index] ||
      !['passed', 'blocked', 'failed'].includes(row.status) ||
      !phases.has(row.phase) ||
      !Array.isArray(row.diagnostics) ||
      row.diagnostics.length > 40
    )
      throw Error('WSL_HOST_EXPORT_INVALID');
    for (const diagnostic of row.diagnostics) {
      const text = JSON.stringify(diagnostic);
      if (
        Buffer.byteLength(text) > 4096 ||
        ![
          ...terminalUiDiagnostics(text),
          ...faultDiagnostics(text),
          ...raceDiagnostics(text),
          ...cancellationDiagnostics(text),
        ].some((allowed) => JSON.stringify(allowed) === text)
      )
        throw Error('WSL_HOST_EXPORT_INVALID');
    }
    if (row.record === null) {
      if (row.status !== 'failed' || row.phase === 'COMPLETE')
        throw Error('WSL_HOST_EXPORT_INVALID');
      continue;
    }
    validateEvidence(row.record, sourceSha);
    if (
      row.record.platform !== 'wsl' ||
      row.record.environment !== 'wsl2' ||
      row.record.arch !== 'x64' ||
      row.record.emulated !== false ||
      row.record.node !== `v${row.node}` ||
      row.record.artifactSha256 !== artifactSha256 ||
      row.phase !== 'COMPLETE'
    )
      throw Error('WSL_HOST_EXPORT_INVALID');
    const expected = Object.values(row.record.gates).includes('failed')
      ? 'failed'
      : Object.values(row.record.gates).includes('blocked')
        ? 'blocked'
        : 'passed';
    if (row.status !== expected) throw Error('WSL_HOST_EXPORT_INVALID');
  }
  return value;
}

async function main() {
  if (process.argv[2] === '--validate-export') {
    const value = validateWslHostExport(
      JSON.parse(readFileSync(process.argv[3], 'utf8')),
      process.argv[4],
      process.argv[5],
    );
    console.log(JSON.stringify(value));
    return;
  }
  const [sourceSha, lockSha256, artifactSha256, transfer] =
    process.argv.slice(2);
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.getuid() === 0 ||
    !/microsoft.*wsl2/i.test(
      readFileSync('/proc/sys/kernel/osrelease', 'utf8'),
    ) ||
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !/^[a-f0-9]{64}$/.test(lockSha256) ||
    !/^[a-f0-9]{64}$/.test(artifactSha256)
  )
    throw Error('WSL_HOST_PREREQUISITES_INVALID');
  const workspace = join(homedir(), 'host-work');
  const cache = join(homedir(), 'npm-cache');
  const tools = join(homedir(), 'npm-tools');
  const nodeFor = (version) =>
    join(homedir(), `nodes/node-v${version}-linux-x64/bin/node`);
  const npmCli = join(tools, 'node_modules/npm/bin/npm-cli.js');
  const host = join(homedir(), 'host/claude');
  const cleanEnv = { ...process.env };
  for (const name of Object.keys(cleanEnv))
    if (
      /^GIT_CONFIG|^GIT_ASKPASS$|^SSH_ASKPASS$|^ANTHROPIC_|^CLAUDE_CODE_OAUTH_TOKEN$/.test(
        name,
      )
    )
      delete cleanEnv[name];
  Object.assign(cleanEnv, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    CLAUDE_BINARY: host,
    CLAUDE_CONFIG_DIR: join(homedir(), 'host-config'),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  });
  function command(executable, args, cwd, env = cleanEnv, timeout = 180000) {
    const result = spawnSync(executable, args, {
      cwd,
      env,
      timeout,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw Error('WSL_HOST_COMMAND_FAILED');
    return result.stdout.trim();
  }
  const rows = versions.map((node) => ({
    node,
    status: 'failed',
    phase: 'SOURCE',
    record: null,
    diagnostics: [],
  }));
  const bundle = { schemaVersion: 1, sourceSha, artifactSha256, rows };
  let phase = 'SOURCE';
  let version;
  let artifact;
  try {
    if (existsSync(workspace)) throw Error('WSL_HOST_WORKSPACE_EXISTS');
    mkdirSync(workspace);
    command('git', ['init', '--quiet'], workspace);
    command(
      'git',
      [
        '-c',
        'credential.helper=',
        '-c',
        'http.extraHeader=',
        '-c',
        'core.hooksPath=/dev/null',
        'fetch',
        '--no-tags',
        '--depth=1',
        'https://github.com/milocosmopolitan/redacton.git',
        sourceSha,
      ],
      workspace,
    );
    command(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'checkout',
        '--quiet',
        '--detach',
        'FETCH_HEAD',
      ],
      workspace,
    );
    if (
      command('git', ['rev-parse', 'HEAD'], workspace) !== sourceSha ||
      command('git', ['status', '--porcelain'], workspace) !== ''
    )
      throw Error('WSL_HOST_SOURCE_MISMATCH');
    phase = 'LOCK';
    if (digest(join(workspace, 'package-lock.json')) !== lockSha256)
      throw Error('WSL_HOST_LOCK_MISMATCH');
    version = JSON.parse(
      readFileSync(join(workspace, 'package.json'), 'utf8'),
    ).version;
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw Error('WSL_HOST_VERSION_INVALID');
    phase = 'ARTIFACT';
    mkdirSync(join(workspace, 'artifacts'));
    for (const name of [
      `redacton-${version}.tar.gz`,
      `redacton-${version}.zip`,
      'SHA256SUMS',
    ])
      copyFileSync(join(transfer, name), join(workspace, 'artifacts', name));
    artifact = join(workspace, 'artifacts', `redacton-${version}.tar.gz`);
    if (digest(artifact) !== artifactSha256)
      throw Error('WSL_HOST_ARTIFACT_MISMATCH');
    phase = 'NPM';
    const bundledNpm = join(
      homedir(),
      'nodes/node-v22.16.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js',
    );
    command(
      nodeFor('22.16.0'),
      [
        bundledNpm,
        'install',
        '--prefix',
        tools,
        '--cache',
        cache,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        'npm@10.9.2',
      ],
      homedir(),
    );
  } catch {
    for (const row of rows) row.phase = phase;
    console.log(
      JSON.stringify(validateWslHostExport(bundle, sourceSha, artifactSha256)),
    );
    process.exitCode = 1;
    return;
  }
  for (const row of rows) {
    const node = nodeFor(row.node);
    const env = {
      ...cleanEnv,
      PATH: `${join(homedir(), `nodes/node-v${row.node}-linux-x64/bin`)}:${join(homedir(), 'host')}:/usr/bin:/bin`,
      CLAUDE_CONFIG_DIR: join(homedir(), `host-config-${row.node}`),
    };
    row.phase = 'DEPENDENCIES';
    try {
      if (
        command(node, ['-p', 'process.versions.node'], workspace, env) !==
          row.node ||
        command(node, [npmCli, '--version'], workspace, env) !== '10.9.2'
      )
        throw Error('WSL_HOST_RUNTIME_MISMATCH');
      command(
        node,
        [
          npmCli,
          'ci',
          '--cache',
          cache,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        workspace,
        env,
      );
      if (
        command('git', ['status', '--porcelain'], workspace, env) !== '' ||
        digest(join(workspace, 'package-lock.json')) !== lockSha256 ||
        digest(artifact) !== artifactSha256
      )
        throw Error('WSL_HOST_SOURCE_CHANGED');
      row.phase = 'PROBES';
      const destination = join(
        workspace,
        'qualification/results',
        `wsl-host-${row.node}`,
      );
      rmSync(destination, { recursive: true, force: true });
      const result = spawnSync(
        node,
        ['scripts/qualify-host.mjs', destination],
        {
          cwd: workspace,
          env,
          timeout: 900000,
          maxBuffer: 2 * 1024 * 1024,
          encoding: 'utf8',
        },
      );
      row.diagnostics = [
        ...terminalUiDiagnostics(result.stdout ?? ''),
        ...faultDiagnostics(result.stdout ?? ''),
        ...raceDiagnostics(result.stdout ?? ''),
        ...cancellationDiagnostics(result.stdout ?? ''),
      ].slice(0, 40);
      if (result.error) throw Error('WSL_HOST_PROBE_PROCESS_FAILED');
      const record = JSON.parse(
        readFileSync(
          join(destination, `wsl-x64-${row.node.split('.')[0]}.json`),
          'utf8',
        ),
      );
      validateEvidence(record, sourceSha);
      if (
        record.platform !== 'wsl' ||
        record.environment !== 'wsl2' ||
        record.arch !== 'x64' ||
        record.node !== `v${row.node}` ||
        record.artifactSha256 !== artifactSha256 ||
        ![0, 1].includes(result.status)
      )
        throw Error('WSL_HOST_RECORD_MISMATCH');
      if (
        digest(artifact) !== artifactSha256 ||
        digest(join(workspace, 'package-lock.json')) !== lockSha256 ||
        command('git', ['status', '--porcelain'], workspace, env) !== ''
      )
        throw Error('WSL_HOST_SOURCE_CHANGED');
      if (
        result.status !== 0 &&
        !Object.values(record.gates).includes('failed')
      )
        throw Error('WSL_HOST_PROBE_EXIT_MISMATCH');
      row.record = record;
      row.phase = 'COMPLETE';
      row.status = Object.values(record.gates).includes('failed')
        ? 'failed'
        : Object.values(record.gates).includes('blocked')
          ? 'blocked'
          : 'passed';
    } catch {
      row.status = 'failed';
    }
  }
  console.log(
    JSON.stringify(validateWslHostExport(bundle, sourceSha, artifactSha256)),
  );
  if (rows.some((row) => row.status === 'failed')) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
