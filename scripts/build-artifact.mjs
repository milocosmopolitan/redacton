import { cp, mkdir, readdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve('artifacts/redacton-alpha-1');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(dir, prefix = '') {
  const result = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name), relative = prefix ? `${prefix}/${name}` : name;
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
    if (stat.isDirectory()) result.push(...await files(path, relative));
    else if (stat.isFile()) result.push(relative);
    else throw new Error('ARTIFACT_SPECIAL_FILE');
  }
  return result;
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const path of ['.claude-plugin/plugin.json', 'hooks', 'mod', 'helper/dist', 'helper/README.md', 'package.json', 'package-lock.json', 'LICENSE', 'SECURITY.md', 'README.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'THIRD_PARTY_NOTICES.md', 'AGENT.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'docs']) {
  await mkdir(join(root, path, '..'), { recursive: true });
  await cp(resolve(path), join(root, path), { recursive: true, dereference: false });
}
const runtimePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
delete runtimePackage.scripts;
runtimePackage.redactonArtifact = { classification: 'evaluation-only', prebuilt: true, development: 'Use the source repository for build and test commands.' };
await writeFile(join(root, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
await mkdir(join(root, 'qualification'), { recursive: true });
for (const path of ['EXECUTION.md', 'engine-research.md', 'trust-readiness.md', 'host-spike/REPORT.md',
  'layered-spike/REPORT.md', 'INTEGRATION_REPORT.md', 'quality-report.md', 'quality-report.json',
  'budgets.md', 'budgets.json', 'PILOT_PLAN.md', 'node24-report.json', 'failure-host-report.md', 'failure-host-report.json',
  'SESSION_REPORT.md', 'session-host-report.json', 'stream-session-host-report.json', 'cancellation-host-report.json',
  'hot-reload-host-report.json', 'ui-report.md', 'ui-report.json', 'ui-research.md', 'ACCEPTANCE.md', 'RELEASE_NOTES.md',
  'packaged-host-report.md', 'packaged-host-report.json', 'permission-denied-host-report.md', 'permission-denied-host-report.json']) {
  try { await lstat(resolve('qualification', path)); } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  await mkdir(join(root, 'qualification', path, '..'), { recursive: true });
  await cp(resolve('qualification', path), join(root, 'qualification', path));
}
await mkdir(join(root, 'node_modules/@redact-secret'), { recursive: true });
for (const name of (await readdir(resolve('node_modules/@redact-secret'))).sort()) {
  await cp(resolve('node_modules/@redact-secret', name), join(root, 'node_modules/@redact-secret', name), { recursive: true, dereference: false });
}
const list = await files(root);
await writeFile(join(root, 'SHA256SUMS'), (await Promise.all(list.map(async path => `${digest(await readFile(join(root, path)))}  ${path}`))).join('\n') + '\n');
const archive = resolve('artifacts/redacton-alpha-1-evaluation.tar.gz');
// Normalize archive metadata so identical file bytes produce identical archives.
const python = `import gzip,tarfile,pathlib,sys\nroot=pathlib.Path(sys.argv[1]); target=sys.argv[2]\nwith open(target,'wb') as raw:\n with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz:\n  with tarfile.open(fileobj=gz,mode='w',format=tarfile.PAX_FORMAT) as tar:\n   for path in sorted(root.rglob('*')):\n    if not path.is_file(): continue\n    info=tar.gettarinfo(str(path),arcname='redacton-alpha-1/'+path.relative_to(root).as_posix()); info.uid=info.gid=0; info.uname=info.gname=''; info.mtime=0; info.mode=0o644; info.pax_headers={}\n    with path.open('rb') as data: tar.addfile(info,data)\n`;
const result = spawnSync('rtk', ['proxy', 'python3', '-c', python, root, archive], { encoding: 'utf8' });
if (result.status !== 0) throw new Error('ARCHIVE_BUILD_FAILED');
const hash = digest(await readFile(archive));
await writeFile(resolve('artifacts/SHA256SUMS'), `${hash}  redacton-alpha-1-evaluation.tar.gz\n`);
console.log(JSON.stringify({ artifact: 'redacton-alpha-1-evaluation.tar.gz', sha256: hash, files: list.length, classification: 'evaluation-only' }));
