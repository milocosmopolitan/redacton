import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function isolatedPlatformEnvironment(directory) {
  if (process.platform !== 'win32') return { DISABLE_AUTOUPDATER: '1' };
  // Windows process startup needs system directories, never inherited credentials.
  return {
    DISABLE_AUTOUPDATER: '1',
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    COMSPEC: process.env.COMSPEC,
    PATHEXT: process.env.PATHEXT,
    USERPROFILE: directory,
    LOCALAPPDATA: join(directory, 'local'),
    APPDATA: join(directory, 'roaming'),
    TEMP: directory,
    TMP: directory,
  };
}

// Use an explicit pinned binary without changing the user's installed host.
export const claudeBinary =
  process.env.CLAUDE_BINARY || process.env.REDACTON_CLAUDE_BINARY || 'claude';
const result = spawnSync(claudeBinary, ['--version'], {
  encoding: 'utf8',
  timeout: 10000,
  env: { ...process.env, DISABLE_AUTOUPDATER: '1' },
});
const version = /^([0-9]+\.[0-9]+\.[0-9]+)\s/.exec(result.stdout ?? '');
if (result.status !== 0 || !version)
  throw new Error('HOST_VERSION_UNAVAILABLE');
export const hostVersion = version[1];
