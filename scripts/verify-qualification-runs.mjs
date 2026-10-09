import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateManualProvenance } from './manual-provenance.mjs';

const repository = 'milocosmopolitan/redacton';
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (sha.status !== 0) throw new Error('SOURCE_ID_UNAVAILABLE');
const sourceSha = sha.stdout.trim();
const ids = [process.env.NODE22_RUN, process.env.NODE24_RUN];
if (
  new Set(ids).size !== 2 ||
  ids.some((id) => !/^[1-9][0-9]{0,19}$/.test(id ?? '')) ||
  !process.env.GITHUB_TOKEN ||
  process.env.GITHUB_REPOSITORY !== repository
)
  throw new Error('QUALIFICATION_RUN_ID_INVALID');
for (const id of ids) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${id}`,
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
  if (!response.ok) throw new Error('QUALIFICATION_RUN_UNAVAILABLE');
  const run = await response.json();
  if (
    run.event !== 'workflow_dispatch' ||
    run.path !== '.github/workflows/qualification.yml' ||
    run.head_sha !== sourceSha ||
    run.head_repository?.full_name !== repository ||
    run.repository?.full_name !== repository ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error('QUALIFICATION_RUN_PROVENANCE_INVALID');
}
if (process.env.MANUAL_RUN) {
  const id = process.env.MANUAL_RUN;
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw new Error('MANUAL_RUN_INVALID');
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${id}`,
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
  if (!response.ok) throw new Error('MANUAL_RUN_UNAVAILABLE');
  const run = await response.json();
  if (
    run.event !== 'workflow_dispatch' ||
    run.path !== '.github/workflows/manual-evidence.yml' ||
    run.head_sha !== sourceSha ||
    run.head_repository?.full_name !== repository ||
    run.repository?.full_name !== repository ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error('MANUAL_RUN_PROVENANCE_INVALID');
  if (process.argv.includes('--manifest')) {
    const bytes = await readFile('qualification/manual-review/review.json');
    if (bytes.length > 16384) throw new Error('MANUAL_PROVENANCE_LIMIT');
    let manifest;
    try {
      manifest = JSON.parse(bytes);
    } catch {
      throw new Error('MANUAL_PROVENANCE_INVALID');
    }
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    const digest = createHash('sha256')
      .update(await readFile(`artifacts/redacton-${version}.tar.gz`))
      .digest('hex');
    validateManualProvenance(manifest, run, sourceSha, digest, ids[0], ids[1]);
  }
}
console.log(JSON.stringify({ code: 'QUALIFICATION_RUNS_VERIFIED', sourceSha }));
