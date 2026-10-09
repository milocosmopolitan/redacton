import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const json = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));
const matrix = await json('docs/platform-matrix.json');
const lock = await json('package-lock.json');
const core = await json('node_modules/@redact-secret/core/package.json');
const wasm = await json('node_modules/@redact-secret/wasm/package.json');
assert.equal(core.version, matrix.engineVersion);
assert.equal(wasm.version, matrix.engineVersion);
assert.equal(core.dependencies['@redact-secret/wasm'], matrix.engineVersion);
const declarations = matrix.environments.map((row) => {
  const name = `@redact-secret/${row.addon}`;
  const entry = lock.packages[`node_modules/${name}`];
  assert.equal(core.optionalDependencies[name], matrix.engineVersion);
  assert.equal(entry.version, matrix.engineVersion);
  assert.match(entry.integrity, /^sha512-/);
  return {
    id: row.id,
    addon: name,
    os: entry.os,
    cpu: entry.cpu,
    libc: entry.libc ?? null,
    integrity: entry.integrity,
  };
});
const runtime = await readFile(
  new URL('node_modules/@redact-secret/core/dist/runtime/node.js', root),
  'utf8',
);
assert.match(runtime, /return loadWasmFallback\("full", pii\)/);
const binary = await readFile(
  new URL('node_modules/@redact-secret/wasm/redact_secret_wasm_bg.wasm', root),
);
assert.equal(binary.subarray(0, 4).toString('hex'), '0061736d');
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      engineVersion: core.version,
      exports: core.exports,
      wasmExports: wasm.exports,
      normalFallbackDeclared: true,
      declarations,
      qualification: 'package-declarations-only',
    },
    null,
    2,
  ),
);
