import { mkdir as ensureDirectory } from 'node:fs/promises';

await ensureDirectory('qualification/results', { recursive: true });

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LIMITS, POLICY_ID } from '../helper/dist/core.js';

const token = 'ghp_SYNTHETICREVOKED00000000000000000000';
const request = (text) => ({
  protocolVersion: 1,
  requestId: 'budget_1',
  operation: 'sanitize',
  policyId: POLICY_ID,
  segments: [{ id: 's0', text }],
});
const temp = await mkdtemp(join(tmpdir(), 'redacton-budget-'));
function run(helper, value, expectedArtifact) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [helper], {
    input: JSON.stringify(value),
    encoding: 'utf8',
    timeout: LIMITS.timeoutMs,
  });
  const elapsed = performance.now() - start;
  if (result.status !== 0 || result.stderr !== '')
    throw new Error('BUDGET_PROCESS_FAILURE');
  const response = JSON.parse(result.stdout);
  if (
    response.status !== 'ok' ||
    response.artifact !== expectedArtifact ||
    response.segments[0].text.includes(token)
  )
    throw new Error('BUDGET_SANITIZE_FAILURE');
  return elapsed;
}
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samplesMs: samples,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}
try {
  await import('../scripts/build-helper.mjs');
  await cp(resolve('helper/dist'), join(temp, 'helper'), { recursive: true });
  await mkdir(join(temp, 'node_modules/@redact-secret'), { recursive: true });
  for (const name of ['core', 'wasm'])
    await cp(
      resolve('node_modules/@redact-secret', name),
      join(temp, 'node_modules/@redact-secret', name),
      { recursive: true },
    );
  const input = `Synthetic ordinary data\n${token}\n`;
  const native = [],
    wasm = [];
  for (let i = 0; i < 10; i++)
    native.push(run(resolve('helper/dist/index.js'), request(input), 'addon'));
  for (let i = 0; i < 10; i++)
    wasm.push(run(join(temp, 'helper/index.js'), request(input), 'wasm'));
  const maxInput = `${token}\n${'ordinary '.repeat(Math.ceil(LIMITS.inputBytes / 9))}`;
  const maxText = maxInput.slice(0, LIMITS.inputBytes);
  const maxNative = run(
    resolve('helper/dist/index.js'),
    request(maxText),
    'addon',
  );
  const maxWasm = run(join(temp, 'helper/index.js'), request(maxText), 'wasm');
  const helperSha256 = {};
  for (const name of ['index.js', 'core.js', 'canonical-types.json'])
    helperSha256[name] = createHash('sha256')
      .update(await readFile(resolve('helper/dist', name)))
      .digest('hex');
  const report = {
    schemaVersion: 1,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    engineVersion: '0.1.0-beta.14',
    helperSha256,
    methodology:
      '10 fresh processes per artifact; parent wall-clock through stdout/exit, nearest-rank quantiles; warm filesystem and npm caches; sequential synthetic requests; no live verification',
    inputBytes: Buffer.byteLength(input),
    limits: {
      ...LIMITS,
      pending: 4,
      hostStdoutBytes: 4194304,
      hostStderrBytes: 4194304,
    },
    native: summarize(native),
    wasm: summarize(wasm),
    maxEvent: {
      inputBytes: Buffer.byteLength(maxText),
      nativeMs: maxNative,
      wasmMs: maxWasm,
    },
    scope:
      'Local helper startup+scan only. SDK output caps are inspected type facts, not measured overflow. Queue and output rejection are unit-test evidence; host cancellation and load under concurrency are separate.',
  };
  await writeFile(
    resolve('qualification/results/budgets.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const fmt = (value) => value.toFixed(3);
  await writeFile(
    resolve('qualification/results/budgets.md'),
    `# Helper resource measurements\n\nNode ${process.version}, ${process.platform} ${process.arch}, core 0.1.0-beta.14. Ten fresh helper processes per artifact scanned ${report.inputBytes} UTF-8 bytes of synthetic ordinary text plus one recognized synthetic credential. Timing includes process startup, stdin, initialization, scanning, stdout and exit. Quantiles use nearest rank; raw millisecond samples are in [budgets.json](budgets.json). Filesystem/package caches were warm; these are sequential local samples, not latency guarantees.\n\n| Artifact | p50 ms | p95 ms | Maximum ms |\n| --- | ---: | ---: | ---: |\n| Native | ${fmt(report.native.p50Ms)} | ${fmt(report.native.p95Ms)} | ${fmt(report.native.maxMs)} |\n| Forced WASM | ${fmt(report.wasm.p50Ms)} | ${fmt(report.wasm.p95Ms)} | ${fmt(report.wasm.maxMs)} |\n\nOne maximum-size event of exactly ${report.maxEvent.inputBytes} UTF-8 bytes took ${fmt(maxNative)} ms native and ${fmt(maxWasm)} ms forced WASM. Both succeeded and removed the recognized synthetic token. A single maximum-size sample does not establish a tail-latency distribution.\n\nConfigured bounds remain 262,144 UTF-8 input bytes, 256 segments, 1,000 findings, 2,097,152 response bytes, 4 pending protected helper calls, and 2,000 ms including process startup. The helper timer also bounds waiting for stdin/initialization; the parent process deadline is required because synchronous scanning blocks JavaScript timers. Per-event excess input/findings/output is withheld; no partial response is delivered.\n\nInstalled Claude Code 2.1.294 SDK declares independent 4,194,304-byte stdout/stderr caps, with truncation flags. The 2 MiB helper response budget stays below that stdout cap. These host caps are inspected contracts, not a measured host-overflow test. OFF dispatches no helper. No daemon, stream stitching, network verification, or telemetry was used.\n\nReproduce with \`rtk proxy node scripts/measure-budgets.mjs\`. Temporary forced-WASM package copies are removed in finally. Linux, Windows, concurrent load, cold disk-cache conditions, and host cancellation behavior are not established by this report.\n`,
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      native: {
        p50Ms: report.native.p50Ms,
        p95Ms: report.native.p95Ms,
        maxMs: report.native.maxMs,
      },
      wasm: {
        p50Ms: report.wasm.p50Ms,
        p95Ms: report.wasm.p95Ms,
        maxMs: report.wasm.maxMs,
      },
      maxEvent: report.maxEvent,
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
