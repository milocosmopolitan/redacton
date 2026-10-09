import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Reviewed official 2.1.294 release manifest. Never trust a mutable latest URL.
export const HOST_VERSION = '2.1.294';
const pins = {
  'linux-x64': [
    '27122ca7b624f537546fbef35b80c66370d974ff258f3d9b10ac50bb8771f262',
    252755128,
  ],
  'linux-arm64': [
    'e5d2df19f30a6d63bf11188121f7edb2775249b57352a69269509a4b1496e763',
    252108792,
  ],
  'darwin-arm64': [
    'def0d15e64dd7d89621f88d28214f885b1c38b0ddd69762fb8593e34915d6d53',
    236330608,
  ],
  'darwin-x64': [
    'b4f8a4a7a43b53ff1cd639d83bd070e8af8725d9cb51abd257a9c611ce6c7274',
    244819072,
  ],
  'win32-x64': [
    '1f6471eb5a1c21a1f8b54a7827329d64433424dcce51717a54e837adb542163a',
    256155808,
  ],
};
const key = `${process.platform}-${process.arch}`;
const pin = pins[key];
if (!pin || !process.argv[2])
  throw new Error('HOST_PIN_OR_DESTINATION_UNAVAILABLE');
const destination = resolve(process.argv[2]);
await mkdir(destination, { recursive: true });
const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
const path = join(destination, binary);
const partial = `${path}.partial`;
try {
  const response = await fetch(
    `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${HOST_VERSION}/${key}/${binary}`,
    { signal: AbortSignal.timeout(180000), redirect: 'error' },
  );
  if (!response.ok || !response.body) throw new Error('HOST_DOWNLOAD_FAILED');
  const hash = createHash('sha256');
  let bytes = 0;
  await writeFile(partial, '');
  const { open } = await import('node:fs/promises');
  const handle = await open(partial, 'a');
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > pin[1]) throw new Error('HOST_DOWNLOAD_LIMIT');
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  if (bytes !== pin[1] || hash.digest('hex') !== pin[0])
    throw new Error('HOST_INTEGRITY_FAILED');
  await chmod(partial, 0o755);
  await rename(partial, path);
  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 0 || !result.stdout.startsWith(`${HOST_VERSION} `))
    throw new Error('HOST_VERSION_FAILED');
  console.log(
    JSON.stringify({
      code: 'HOST_VERIFIED',
      version: HOST_VERSION,
      platform: process.platform,
      arch: process.arch,
      sha256: pin[0],
    }),
  );
} finally {
  await rm(partial, { force: true });
}
