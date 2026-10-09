import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeManualEvidence } from './manual-evidence.mjs';

const repository = 'milocosmopolitan/redacton';
if (
  process.env.GITHUB_REPOSITORY !== repository ||
  process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
  !process.env.GITHUB_TOKEN ||
  !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(process.env.GITHUB_ACTOR ?? '')
)
  throw new Error('MANUAL_REVIEWER_UNAVAILABLE');
const response = await fetch(
  `https://api.github.com/repos/${repository}/collaborators/${process.env.GITHUB_ACTOR}/permission`,
  {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  },
);
if (!response.ok) throw new Error('MANUAL_REVIEWER_UNAUTHORIZED');
const permission = await response.json();
if (permission.permission !== 'admin' && permission.role_name !== 'maintain')
  throw new Error('MANUAL_REVIEWER_UNAUTHORIZED');
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (sha.status !== 0) throw new Error('SOURCE_ID_UNAVAILABLE');
const sourceSha = sha.stdout.trim();
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const artifactSha256 = createHash('sha256')
  .update(await readFile(`artifacts/redacton-${version}.tar.gz`))
  .digest('hex');
let attestation;
try {
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const input = event.inputs?.attestation;
  if (typeof input !== 'string' || Buffer.byteLength(input) > 32768)
    throw new Error();
  attestation = JSON.parse(input);
} catch {
  throw new Error('MANUAL_EVIDENCE_INVALID');
}
const base = [];
for (const file of await readdir('qualification/base-evidence')) {
  if (!file.endsWith('.json')) throw new Error('EVIDENCE_INVALID_FILE');
  const bytes = await readFile(join('qualification/base-evidence', file));
  if (bytes.length > 4096) throw new Error('EVIDENCE_LIMIT');
  try {
    base.push(JSON.parse(bytes));
  } catch {
    throw new Error('EVIDENCE_INVALID');
  }
}
const merged = mergeManualEvidence(
  base,
  attestation,
  sourceSha,
  artifactSha256,
);
const numeric = (value) => /^[1-9][0-9]{0,19}$/.test(value ?? '');
if (
  ![
    process.env.GITHUB_RUN_ID,
    process.env.GITHUB_RUN_ATTEMPT,
    process.env.NODE22_RUN,
    process.env.NODE24_RUN,
  ].every(numeric)
)
  throw new Error('MANUAL_PROVENANCE_INVALID');
if (merged.some((record) => record.version !== version))
  throw new Error('EVIDENCE_VERSION_MISMATCH');
await mkdir('qualification/results/manual-evidence', { recursive: true });
for (const record of merged)
  await writeFile(
    join(
      'qualification/results/manual-evidence',
      `${record.platform}-${record.arch}-${record.node.slice(1, 3)}.json`,
    ),
    `${JSON.stringify(record, null, 2)}\n`,
  );
await mkdir('qualification/results/manual-review-provenance', {
  recursive: true,
});
await writeFile(
  'qualification/results/manual-review-provenance/review.json',
  `${JSON.stringify({ schemaVersion: 1, sourceSha, artifactSha256, reviewer: process.env.GITHUB_ACTOR, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, node22Run: process.env.NODE22_RUN, node24Run: process.env.NODE24_RUN, attestationSha256: createHash('sha256').update(JSON.stringify(attestation)).digest('hex'), overrides: attestation.rows.map((row) => ({ platform: row.platform, arch: row.arch, node: row.node, gates: Object.keys(row.gates).sort() })), externalRows: (attestation.externalRows ?? []).map((row) => ({ platform: row.platform, arch: row.arch, node: row.node })) }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    code: 'MANUAL_EVIDENCE_REVIEWED',
    sourceSha,
    artifactSha256,
    rows: merged.length,
  }),
);
