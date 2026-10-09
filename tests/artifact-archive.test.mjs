import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  archiveTar,
  archiveZip,
  readTar,
  readZip,
  safeName,
} from '../scripts/artifact-archive.mjs';

const entries = [
  {
    name: 'redacton-0.1.0/.claude-plugin/plugin.json',
    data: Buffer.from('{}'),
  },
  {
    name: `redacton-0.1.0/${'long/'.repeat(20)}asset.wasm`,
    data: Buffer.from([0, 1, 2, 255]),
  },
];
test('tar and zip deterministically roundtrip identical plugin bytes including long paths', () => {
  for (const [build, read] of [
    [archiveTar, readTar],
    [archiveZip, readZip],
  ]) {
    assert.deepEqual(build(entries), build(entries));
    assert.deepEqual(
      [...read(build(entries))],
      entries.map(({ name, data }) => [name, data]),
    );
    assert.throws(
      () => read(build([entries[0], entries[0]])),
      /ARCHIVE_DUPLICATE/,
    );
  }
});
test('archive readers reject Windows case collisions', () => {
  for (const [build, read] of [
    [archiveTar, readTar],
    [archiveZip, readZip],
  ]) {
    assert.throws(
      () =>
        read(
          build([
            { name: 'redacton-0.1.0/Foo', data: Buffer.alloc(0) },
            { name: 'redacton-0.1.0/foo', data: Buffer.alloc(0) },
          ]),
        ),
      /ARCHIVE_DUPLICATE/,
    );
  }
});
test('paths reject traversal, absolute, Windows separators and alternate roots', () => {
  for (const name of [
    '../escape',
    '/redacton-0.1.0/a',
    'redacton-0.1.0/../escape',
    'redacton-0.1.0/a\\b',
    'redacton-0.1.0/a:b',
    'other/a',
    'redacton-0.1.0/CON.txt',
    'redacton-0.1.0/file.',
    'redacton-0.1.0//a',
  ]) {
    assert.throws(() => safeName(name), /ARCHIVE_PATH/);
  }
});
function tarMutation(mutator) {
  const bytes = gunzipSync(archiveTar(entries));
  mutator(bytes);
  bytes.fill(32, 148, 156);
  const sum = bytes.subarray(0, 512).reduce((a, b) => a + b, 0);
  bytes.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return gzipSync(bytes);
}
test('tar rejects links, special entries, traversal, truncation and appended data before extraction', () => {
  for (const type of ['1', '2', '3', '4', '5', '6', 'x', 'g'])
    assert.throws(
      () =>
        readTar(
          tarMutation((bytes) => {
            bytes[156] = type.charCodeAt(0);
          }),
        ),
      /ARCHIVE_ENTRY/,
    );
  assert.throws(
    () =>
      readTar(
        tarMutation((bytes) => {
          bytes.fill(0, 0, 100);
          bytes.write('redacton-0.1.0/../escape');
        }),
      ),
    /ARCHIVE_PATH/,
  );
  assert.throws(
    () => readTar(gzipSync(gunzipSync(archiveTar(entries)).subarray(0, 700))),
    /ARCHIVE_TRUNCATED/,
  );
  assert.throws(
    () =>
      readTar(
        gzipSync(
          Buffer.concat([
            gunzipSync(archiveTar(entries)),
            Buffer.from('extra'),
          ]),
        ),
      ),
    /ARCHIVE_TRAILING/,
  );
});
test('zip rejects changed bytes, symlink modes, truncation and appended data', () => {
  const raw = archiveZip(entries);
  const broken = Buffer.from(raw);
  broken[30 + entries[0].name.length] ^= 1;
  assert.throws(() => readZip(broken), /ARCHIVE_CHECKSUM/);
  const link = Buffer.from(raw),
    end = raw.length - 22,
    central = raw.readUInt32LE(end + 16);
  link.writeUInt32LE((0o120777 * 65536) >>> 0, central + 38);
  assert.throws(() => readZip(link), /ARCHIVE_ENTRY/);
  assert.throws(
    () => readZip(raw.subarray(0, raw.length - 1)),
    /ARCHIVE_ENTRY/,
  );
  assert.throws(
    () => readZip(Buffer.concat([raw, Buffer.from('extra')])),
    /ARCHIVE_ENTRY/,
  );
});
