import { gunzipSync, gzipSync } from 'node:zlib';

const MAX_BYTES = 128 * 1024 * 1024;
export function safeName(name) {
  if (
    !/^[A-Za-z0-9_@./-]+$/.test(name) ||
    name.includes('\\') ||
    name
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.endsWith('.') ||
          /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
      ) ||
    !/^redacton-[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?\//.test(name)
  )
    throw new Error('ARCHIVE_PATH');
  return name;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function octal(header, offset, width, number) {
  const value = number.toString(8).padStart(width - 1, '0');
  if (value.length !== width - 1) throw new Error('ARCHIVE_SIZE');
  header.write(`${value}\0`, offset, width, 'ascii');
}
export function archiveTar(entries) {
  const chunks = [];
  for (const { name, data } of entries) {
    safeName(name);
    const h = Buffer.alloc(512);
    let leaf = name,
      prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/');
      prefix = name.slice(0, split);
      leaf = name.slice(split + 1);
    }
    if (Buffer.byteLength(leaf) > 100 || Buffer.byteLength(prefix) > 155)
      throw new Error('ARCHIVE_PATH_LENGTH');
    h.write(leaf, 0, 100);
    h.write(prefix, 345, 155);
    octal(h, 100, 8, 0o644);
    octal(h, 108, 8, 0);
    octal(h, 116, 8, 0);
    octal(h, 124, 12, data.length);
    octal(h, 136, 12, 0);
    h.fill(32, 148, 156);
    h[156] = 48;
    h.write('ustar\0', 257, 6);
    h.write('00', 263, 2);
    const sum = h.reduce((a, b) => a + b, 0);
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    chunks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}
export function archiveZip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const path = Buffer.from(safeName(name));
    const checksum = crc(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(checksum, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(path.length, 26);
    local.push(h, path, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x0314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(path.length, 28);
    c.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, path);
    offset += h.length + path.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function add(result, name, data) {
  safeName(name);
  if (
    [...result.keys()].some(
      (entry) => entry.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error('ARCHIVE_DUPLICATE');
  result.set(name, data);
}
export function readTar(bytes) {
  const raw = gunzipSync(bytes, { maxOutputLength: MAX_BYTES });
  const result = new Map();
  let offset = 0;
  const string = (h, start, length) =>
    h
      .subarray(start, start + length)
      .toString('ascii')
      .split('\0')[0];
  while (offset + 512 <= raw.length) {
    const h = raw.subarray(offset, offset + 512);
    if (h.every((b) => b === 0)) {
      if (
        raw.length - offset < 1024 ||
        !raw.subarray(offset).every((b) => b === 0)
      )
        throw new Error('ARCHIVE_TRAILING');
      return result;
    }
    const recorded = Number.parseInt(string(h, 148, 8).trim(), 8);
    const actual = h.reduce(
      (sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b),
      0,
    );
    const sizeText = string(h, 124, 12);
    if (
      !/^[0-7]+$/.test(sizeText) ||
      recorded !== actual ||
      h[156] !== 48 ||
      string(h, 157, 100) !== '' ||
      string(h, 257, 6) !== 'ustar'
    )
      throw new Error('ARCHIVE_ENTRY');
    const size = Number.parseInt(sizeText, 8),
      prefix = string(h, 345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${string(h, 0, 100)}`;
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    if (next > raw.length) throw new Error('ARCHIVE_TRUNCATED');
    add(result, name, raw.subarray(offset + 512, offset + 512 + size));
    offset = next;
  }
  throw new Error('ARCHIVE_TRUNCATED');
}
export function readZip(raw) {
  if (raw.length > MAX_BYTES || raw.length < 22)
    throw new Error('ARCHIVE_SIZE');
  const end = raw.length - 22;
  if (
    raw.readUInt32LE(end) !== 0x06054b50 ||
    raw.readUInt16LE(end + 4) ||
    raw.readUInt16LE(end + 6) ||
    raw.readUInt16LE(end + 20)
  )
    throw new Error('ARCHIVE_ENTRY');
  const count = raw.readUInt16LE(end + 10),
    directory = raw.readUInt32LE(end + 16);
  if (
    raw.readUInt16LE(end + 8) !== count ||
    directory + raw.readUInt32LE(end + 12) !== end
  )
    throw new Error('ARCHIVE_ENTRY');
  const result = new Map();
  let cursor = directory,
    offset = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || raw.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('ARCHIVE_ENTRY');
    const pathLength = raw.readUInt16LE(cursor + 28),
      size = raw.readUInt32LE(cursor + 24);
    const name = raw
      .subarray(cursor + 46, cursor + 46 + pathLength)
      .toString('utf8');
    if (
      raw.readUInt16LE(cursor + 8) ||
      raw.readUInt16LE(cursor + 10) ||
      raw.readUInt16LE(cursor + 30) ||
      raw.readUInt16LE(cursor + 32) ||
      raw.readUInt16LE(cursor + 34) ||
      raw.readUInt32LE(cursor + 20) !== size ||
      raw.readUInt32LE(cursor + 42) !== offset ||
      raw.readUInt32LE(cursor + 38) >>> 16 !== 0o100644 ||
      offset + 30 > directory ||
      raw.readUInt32LE(offset) !== 0x04034b50 ||
      raw.readUInt16LE(offset + 6) ||
      raw.readUInt16LE(offset + 8) ||
      raw.readUInt16LE(offset + 26) !== pathLength ||
      raw.readUInt16LE(offset + 28) ||
      raw.readUInt32LE(offset + 18) !== size ||
      raw.readUInt32LE(offset + 22) !== size
    )
      throw new Error('ARCHIVE_ENTRY');
    const start = offset + 30 + pathLength;
    if (
      start + size > directory ||
      raw.subarray(offset + 30, start).toString('utf8') !== name
    )
      throw new Error('ARCHIVE_ENTRY');
    const data = raw.subarray(start, start + size),
      checksum = crc(data);
    if (
      raw.readUInt32LE(cursor + 16) !== checksum ||
      raw.readUInt32LE(offset + 14) !== checksum
    )
      throw new Error('ARCHIVE_CHECKSUM');
    add(result, name, data);
    offset = start + size;
    cursor += 46 + pathLength;
  }
  if (cursor !== end || offset !== directory)
    throw new Error('ARCHIVE_TRAILING');
  return result;
}
