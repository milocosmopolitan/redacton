import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateEvidence } from './qualification-evidence.mjs';

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (commit.status !== 0) throw new Error('SOURCE_ID_UNAVAILABLE');
const sourceSha = commit.stdout.trim();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const dir = resolve(process.argv[2] ?? 'qualification/evidence');
const rows = new Set();
const artifactDigests = new Set();
for (const file of await readdir(dir)) {
  if (!file.endsWith('.json')) throw new Error('EVIDENCE_INVALID_FILE');
  const bytes = await readFile(join(dir, file));
  if (bytes.length > 4096) throw new Error('EVIDENCE_LIMIT');
  const value = JSON.parse(bytes);
  if (value.version !== pkg.version)
    throw new Error('EVIDENCE_VERSION_MISMATCH');
  if (!validateEvidence(value, sourceSha))
    throw new Error('QUALIFICATION_BLOCKED');
  artifactDigests.add(value.artifactSha256);
  const row = `${value.platform}-${value.arch}-${value.node.slice(1, 3)}`;
  if (rows.has(row)) throw new Error('DUPLICATE_EVIDENCE');
  rows.add(row);
}
if (artifactDigests.size !== 1) throw new Error('ARTIFACT_IDENTITY_MISMATCH');
const archive = await readFile(`artifacts/redacton-${pkg.version}.tar.gz`);
if (!artifactDigests.has(createHash('sha256').update(archive).digest('hex')))
  throw new Error('RELEASE_ARTIFACT_IDENTITY_MISMATCH');
// Derive every advertised native row from the same matrix used by the documentation.
const matrix = JSON.parse(await readFile('docs/platform-matrix.json', 'utf8'));
if (matrix.schemaVersion !== 1 || !Array.isArray(matrix.environments))
  throw new Error('PLATFORM_MATRIX_INVALID');
for (const environment of matrix.environments.filter(
  (row) => row.scope === 'target',
)) {
  const platform = environment.id.startsWith('wsl2-')
    ? 'wsl'
    : environment.platform;
  for (const node of environment.nodeMajors)
    if (!rows.has(`${platform}-${environment.arch}-${node}`))
      throw new Error('QUALIFICATION_ROW_MISSING');
}
console.log(
  JSON.stringify({
    code: 'QUALIFICATION_COMPLETE',
    sourceSha,
    rows: rows.size,
    desktop: 'unqualified',
  }),
);
