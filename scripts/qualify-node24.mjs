import { mkdtemp, readFile, writeFile, rm, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const dir = await mkdtemp(join(tmpdir(), 'redacton-node24-'));
const sha = 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057';
const url = 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz';
function run(args) {
  const result = spawnSync('rtk', ['proxy', ...args], { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error('NODE24_CHECK_FAILED');
  return result.stdout;
}
try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('NODE24_PLATFORM_NOT_QUALIFIED');
  const archive = join(dir, 'node.tar.gz'), binary = join(dir, 'node');
  run(['curl', '--fail', '--silent', '--show-error', '-o', archive, url]);
  const sums = run(['curl', '--fail', '--silent', '--show-error', 'https://nodejs.org/dist/v24.21.0/SHASUMS256.txt']);
  if (!sums.includes(sha + '  node-v24.21.0-darwin-arm64.tar.gz') || createHash('sha256').update(await readFile(archive)).digest('hex') !== sha) throw new Error('NODE24_DIGEST_FAILED');
  run(['python3', '-c', 'import tarfile,sys; t=tarfile.open(sys.argv[1]); open(sys.argv[2],"wb").write(t.extractfile("node-v24.21.0-darwin-arm64/bin/node").read())', archive, binary]);
  await chmod(binary, 0o755);
  const tests = (await readdir('tests')).filter(name => name.endsWith('.test.js') || name.endsWith('.test.mjs')).map(name => 'tests/' + name);
  const output = run([binary, '--test', '--test-reporter=tap', ...tests]);
  if (!output.includes('# fail 0')) throw new Error('NODE24_TEST_FAILED');
  const identities = {};
  for (const path of [...tests, 'helper/src/core.mjs', 'helper/src/index.mjs', 'helper/src/canonical-types.json', 'mod/protocol.js', 'mod/state.js', 'mod/adapters/text.js', 'package-lock.json']) identities[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  const report = { node: run([binary, '--version']).trim(), platform: 'darwin', arch: 'arm64', distribution: url, distributionSha256: sha,
    officialChecksumVerified: true, suite: 'Node helper, protocol, state and adapters', tests: Number(output.match(/# tests (\d+)/)?.[1]), status: 'passed', sourceSha256: identities,
    hostQualification: 'Claude host matrix not inferred from helper tests' };
  await writeFile('qualification/node24-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ node: report.node, tests: report.tests, status: report.status }));
} finally { await rm(dir, { recursive: true, force: true }); }
