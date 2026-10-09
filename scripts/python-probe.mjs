import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function pythonBinary() {
  return (
    process.env.REDACTON_PYTHON_BINARY ||
    (process.platform === 'win32' ? 'python' : 'python3')
  );
}

export async function preparePythonDependencies(ownedDirectory) {
  const dependencies = join(ownedDirectory, 'python-dependencies');
  const result = spawnSync(
    pythonBinary(),
    [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '--no-cache-dir',
      '--require-hashes',
      '--target',
      dependencies,
      '-r',
      resolve('qualification/ui-requirements.txt'),
    ],
    {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0 || result.error) {
    const unavailable =
      result.error?.code === 'ENOENT' ||
      /No module named pip/.test(result.stderr ?? '');
    throw new Error(
      unavailable
        ? 'PYTHON_PROBE_PREREQUISITE_UNAVAILABLE'
        : 'PYTHON_PROBE_BOOTSTRAP_FAILED',
    );
  }
  return dependencies;
}

export async function withPythonDependencies(callback) {
  const temporary = await mkdtemp(join(tmpdir(), 'redacton-python-probe-'));
  try {
    const dependencies =
      process.env.REDACTON_PROBE_PYTHON_DEPS ||
      (await preparePythonDependencies(temporary));
    return await callback({ python: pythonBinary(), dependencies, temporary });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
