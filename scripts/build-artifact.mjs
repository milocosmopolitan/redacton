import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { archiveTar, archiveZip } from './artifact-archive.mjs';

const packageMetadata = JSON.parse(
  await readFile(resolve('package.json'), 'utf8'),
);
const pluginMetadata = JSON.parse(
  await readFile(resolve('.claude-plugin/plugin.json'), 'utf8'),
);
const version = packageMetadata.version;
if (
  !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version) ||
  pluginMetadata.version !== version
)
  throw new Error('ARTIFACT_VERSION_MISMATCH');
const artifactName = `redacton-${version}`;
const root = resolve('artifacts', artifactName);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function files(dir, prefix = '') {
  const result = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name),
      relative = prefix ? `${prefix}/${name}` : name;
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
    if (stat.isDirectory()) result.push(...(await files(path, relative)));
    else if (stat.isFile()) result.push(relative);
    else throw new Error('ARTIFACT_SPECIAL_FILE');
  }
  return result;
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const path of [
  '.claude-plugin/plugin.json',
  'hooks',
  'commands',
  'helper/src/config.ts',
  'mod',
  'helper/dist',
  'helper/README.md',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'SECURITY.md',
  'README.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'THIRD_PARTY_NOTICES.md',
  'AGENT.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'docs',
]) {
  await mkdir(join(root, path, '..'), { recursive: true });
  await cp(resolve(path), join(root, path), {
    recursive: true,
    dereference: false,
  });
}
const runtimePackage = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
delete runtimePackage.scripts;
delete runtimePackage.devDependencies;
const runtimeLock = JSON.parse(
  await readFile(join(root, 'package-lock.json'), 'utf8'),
);
delete runtimeLock.packages[''].devDependencies;
for (const [name, value] of Object.entries(runtimeLock.packages))
  if (value.dev === true) delete runtimeLock.packages[name];
await writeFile(
  join(root, 'package-lock.json'),
  `${JSON.stringify(runtimeLock, null, 2)}\n`,
);
runtimePackage.redactonArtifact = {
  classification: 'unqualified-portable-wasm',
  prebuilt: true,
  development: 'Use the source repository for build and test commands.',
};
await writeFile(
  join(root, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
);
await mkdir(join(root, 'node_modules/@redact-secret'), { recursive: true });
const dependencies = [];
for (const name of ['core', 'wasm']) {
  const packagePath = resolve('node_modules/@redact-secret', name);
  const metadata = JSON.parse(
    await readFile(join(packagePath, 'package.json'), 'utf8'),
  );
  const locked = runtimeLock.packages[`node_modules/@redact-secret/${name}`];
  if (
    metadata.version !== '0.1.0-beta.14' ||
    locked?.version !== metadata.version ||
    typeof locked.integrity !== 'string' ||
    typeof locked.resolved !== 'string'
  )
    throw new Error('ENGINE_PIN_MISMATCH');
  dependencies.push({
    name: metadata.name,
    version: metadata.version,
    resolved: locked.resolved,
    integrity: locked.integrity,
  });
  await cp(packagePath, join(root, 'node_modules/@redact-secret', name), {
    recursive: true,
    dereference: false,
  });
}
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const dirty = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=normal'],
  { encoding: 'utf8' },
);
await writeFile(
  join(root, 'PROVENANCE.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      artifact: 'portable-wasm',
      engine: '@redact-secret/core@0.1.0-beta.14',
      dependencies,
      source: {
        commit: commit.status === 0 ? commit.stdout.trim() : 'unavailable',
        dirty: dirty.status === 0 ? dirty.stdout.trim() !== '' : 'unavailable',
      },
      dependencyTrust:
        'Installed bytes require clean npm ci --ignore-scripts from the pinned source lock; archive build records npm tarball identities but does not reauthenticate installed package bytes.',
      runtime:
        'public automatic WASM fallback; native optional packages omitted',
      sourceLockSha256: digest(await readFile(resolve('package-lock.json'))),
      builder: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      qualification:
        'Build identity only; actual host/platform qualification is separate.',
    },
    null,
    2,
  )}\n`,
);
const list = await files(root);
await writeFile(
  join(root, 'SHA256SUMS'),
  `${(
    await Promise.all(
      list.map(
        async (path) => `${digest(await readFile(join(root, path)))}  ${path}`,
      ),
    )
  ).join('\n')}\n`,
);
const entries = await Promise.all(
  [...list, 'SHA256SUMS'].sort().map(async (path) => ({
    name: `${artifactName}/${path}`,
    data: await readFile(join(root, path)),
  })),
);
const archives = {
  [`${artifactName}.tar.gz`]: archiveTar(entries),
  [`${artifactName}.zip`]: archiveZip(entries),
};
const sums = [];
for (const [name, bytes] of Object.entries(archives)) {
  await writeFile(resolve('artifacts', name), bytes);
  sums.push(`${digest(bytes)}  ${name}`);
}
await writeFile(resolve('artifacts/SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(
  JSON.stringify({
    artifacts: Object.keys(archives),
    files: list.length,
    classification: 'unqualified-portable-wasm',
  }),
);
