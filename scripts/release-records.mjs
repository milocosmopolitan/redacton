import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'milocosmopolitan/redacton';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys;
export function approvedRun(run, sha) {
  return (
    /^[a-f0-9]{40}$/.test(sha) &&
    run?.event === 'workflow_dispatch' &&
    run.path === '.github/workflows/release-gate.yml' &&
    run.head_sha === sha &&
    run.head_repository?.full_name === repository &&
    run.repository?.full_name === repository &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    /^[1-9][0-9]{0,19}$/.test(String(run.id)) &&
    Number.isSafeInteger(run.run_attempt) &&
    run.run_attempt > 0 &&
    /^[A-Za-z0-9-]{1,39}$/.test(run.actor?.login ?? '')
  );
}
export function validateReleaseManifest(value, run, sha, version) {
  if (
    !approvedRun(run, sha) ||
    !exact(
      value,
      'actor,files,runAttempt,runId,schemaVersion,sourceSha,version',
    ) ||
    value.schemaVersion !== 1 ||
    value.sourceSha !== sha ||
    value.version !== version ||
    value.runId !== String(run.id) ||
    value.runAttempt !== run.run_attempt ||
    value.actor !== run.actor.login ||
    !Array.isArray(value.files) ||
    value.files.length < 17 ||
    value.files.length > 18
  )
    throw new Error('RELEASE_RECORD_INVALID');
  const required = new Set([
    `artifacts/redacton-${version}.tar.gz`,
    `artifacts/redacton-${version}.zip`,
    'artifacts/SHA256SUMS',
  ]);
  for (const [platform, arches] of [
    ['darwin', ['x64', 'arm64']],
    ['linux', ['x64', 'arm64']],
    ['win32', ['x64']],
    ['wsl', ['x64', 'arm64']],
  ])
    for (const arch of arches)
      for (const node of [22, 24])
        required.add(`qualification/evidence/${platform}-${arch}-${node}.json`);
  const names = new Set();
  for (const file of value.files) {
    if (
      !exact(file, 'path,sha256') ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      names.has(file.path) ||
      !(
        required.has(file.path) ||
        file.path === 'qualification/manual-review/review.json'
      )
    )
      throw new Error('RELEASE_RECORD_INVALID');
    names.add(file.path);
  }
  if ([...required].some((path) => !names.has(path)))
    throw new Error('RELEASE_RECORD_INVALID');
  return true;
}
async function api(path) {
  if (!process.env.GITHUB_TOKEN || process.env.GITHUB_REPOSITORY !== repository)
    throw new Error('RELEASE_RECORD_AUTH_INVALID');
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/${path}`,
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
  if (!response.ok) throw new Error('RELEASE_RECORD_RUN_UNAVAILABLE');
  return response.json();
}
async function main() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('SOURCE_ID_UNAVAILABLE');
  const sha = result.stdout.trim();
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version))
    throw new Error('RELEASE_RECORD_VERSION_INVALID');
  if (process.argv[2] === 'select') {
    if (process.env.GITHUB_REF !== `refs/tags/v${version}`)
      throw new Error('RELEASE_TAG_VERSION_INVALID');
    const response = await api(
      `workflows/release-gate.yml/runs?event=workflow_dispatch&status=success&head_sha=${sha}&per_page=20`,
    );
    const run = response.workflow_runs?.find((value) =>
      approvedRun(value, sha),
    );
    if (!run) throw new Error('APPROVED_RELEASE_RECORD_UNAVAILABLE');
    await writeFile(process.env.GITHUB_OUTPUT, `run_id=${run.id}\n`, {
      flag: 'a',
    });
  } else if (process.argv[2] === 'prepare') {
    // The preceding strict gate is mandatory, including for direct local invocation.
    const gate = spawnSync(
      process.execPath,
      ['scripts/qualification-gate.mjs'],
      { stdio: 'ignore' },
    );
    if (gate.status !== 0) throw new Error('QUALIFICATION_BLOCKED');
    const files = [
      `artifacts/redacton-${version}.tar.gz`,
      `artifacts/redacton-${version}.zip`,
      'artifacts/SHA256SUMS',
    ];
    for (const name of await readdir('qualification/evidence'))
      files.push(`qualification/evidence/${name}`);
    if (process.env.MANUAL_RUN)
      files.push('qualification/manual-review/review.json');
    const manifest = {
      schemaVersion: 1,
      sourceSha: sha,
      version,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      actor: process.env.GITHUB_ACTOR,
      files: await Promise.all(
        files.map(async (path) => ({
          path,
          sha256: digest(await readFile(path)),
        })),
      ),
    };
    validateReleaseManifest(
      manifest,
      {
        id: manifest.runId,
        run_attempt: manifest.runAttempt,
        actor: { login: manifest.actor },
        event: 'workflow_dispatch',
        path: '.github/workflows/release-gate.yml',
        head_sha: sha,
        repository: { full_name: repository },
        head_repository: { full_name: repository },
        status: 'completed',
        conclusion: 'success',
      },
      sha,
      version,
    );
    for (const file of manifest.files) {
      const destination = join('qualification/release-records', file.path);
      await mkdir(join(destination, '..'), { recursive: true });
      await cp(file.path, destination);
    }
    await writeFile(
      'qualification/release-records/release-record.json',
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } else if (process.argv[2] === 'verify') {
    const run = await api(`runs/${process.env.APPROVED_RUN}`);
    const bytes = await readFile(
      'qualification/release-records/release-record.json',
    );
    if (bytes.length > 16384) throw new Error('RELEASE_RECORD_LIMIT');
    const manifest = JSON.parse(bytes);
    validateReleaseManifest(manifest, run, sha, version);
    for (const file of manifest.files) {
      const from = join('qualification/release-records', file.path);
      if (digest(await readFile(from)) !== file.sha256)
        throw new Error('RELEASE_RECORD_DIGEST_INVALID');
      await mkdir(join(file.path, '..'), { recursive: true });
      await cp(from, file.path);
    }
  } else throw new Error('RELEASE_RECORD_MODE_INVALID');
  console.log(
    JSON.stringify({ code: 'RELEASE_RECORD_VERIFIED', sourceSha: sha }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    console.error(JSON.stringify({ code: 'RELEASE_RECORD_REJECTED' }));
    process.exitCode = 1;
  }
}
