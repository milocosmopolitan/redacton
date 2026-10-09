import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateEvidence } from './qualification-evidence.mjs';

export function ingestWslEvidence(
  input,
  destination,
  sourceSha,
  artifactSha256,
  version,
) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !/^[a-f0-9]{64}$/.test(artifactSha256) ||
    !/^\d+\.\d+\.\d+$/.test(version)
  )
    throw Error('WSL_EVIDENCE_IDENTITY_INVALID');
  if (!existsSync(input)) return 0;
  const root = lstatSync(input);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw Error('WSL_EVIDENCE_PATH_INVALID');
  const records = new Map();
  function scan(directory, nested = false) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw Error('WSL_EVIDENCE_PATH_INVALID');
      if (!nested && name === 'wsl-host' && stat.isDirectory()) {
        scan(path, true);
        continue;
      }
      if (!stat.isFile()) throw Error('WSL_EVIDENCE_PATH_INVALID');
      // This artifact also carries bounded diagnostic state, never gate evidence.
      if (
        name === 'wsl-host-summary.json' ||
        /^wsl-host-diagnostics-(22|24)\.json$/.test(name)
      )
        continue;
      const match = /^wsl-x64-(22|24)\.json$/.exec(name);
      if (!match || records.has(name) || stat.size > 4096)
        throw Error('WSL_EVIDENCE_FILE_INVALID');
      const bytes = readFileSync(path);
      if (bytes.length > 4096) throw Error('WSL_EVIDENCE_FILE_INVALID');
      const value = JSON.parse(bytes);
      validateEvidence(value, sourceSha);
      if (
        value.platform !== 'wsl' ||
        value.environment !== 'wsl2' ||
        value.arch !== 'x64' ||
        value.emulated !== false ||
        value.node !== (match[1] === '22' ? 'v22.16.0' : 'v24.21.0') ||
        value.artifactSha256 !== artifactSha256 ||
        value.version !== version
      )
        throw Error('WSL_EVIDENCE_IDENTITY_INVALID');
      records.set(name, value);
    }
  }
  scan(input);
  // Validate the complete input and every destination before writing any record.
  for (const name of records.keys())
    if (existsSync(join(destination, name)))
      throw Error('WSL_EVIDENCE_OVERWRITE_REJECTED');
  if (records.size) mkdirSync(destination, { recursive: true });
  for (const [name, value] of records)
    writeFileSync(
      join(destination, name),
      `${JSON.stringify(value, null, 2)}\n`,
      { flag: 'wx' },
    );
  return records.size;
}

function main() {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (commit.status !== 0) throw Error('SOURCE_ID_UNAVAILABLE');
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const artifactSha256 = createHash('sha256')
    .update(readFileSync(`artifacts/redacton-${version}.tar.gz`))
    .digest('hex');
  const rows = ingestWslEvidence(
    resolve('qualification/wsl-host-input'),
    resolve('qualification/evidence'),
    commit.stdout.trim(),
    artifactSha256,
    version,
  );
  console.log(JSON.stringify({ code: 'WSL_EVIDENCE_IMPORTED', rows }));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch {
    console.error(JSON.stringify({ code: 'WSL_EVIDENCE_REJECTED' }));
    process.exitCode = 1;
  }
}
