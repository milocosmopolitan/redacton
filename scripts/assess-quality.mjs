import { mkdir as ensureDirectory } from 'node:fs/promises';

await ensureDirectory('qualification/results', { recursive: true });

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as engine from '@redact-secret/core';
import initialCorpus from '../benchmarks/alpha1-corpus.mjs';
import heldoutCorpus from '../benchmarks/heldout-corpus.mjs';
import {
  ENGINE_VERSION,
  POLICY_ID,
  processRequest,
} from '../helper/dist/core.js';

const root = new URL('../', import.meta.url);
const corpusBytes = await readFile(
  new URL('benchmarks/alpha1-corpus.mjs', root),
);
const heldoutBytes = await readFile(
  new URL('benchmarks/heldout-corpus.mjs', root),
);
const corpus = [...initialCorpus, ...heldoutCorpus];
const lockBytes = await readFile(new URL('package-lock.json', root));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const start = performance.now();
await engine.initialize();
const initializationMs = performance.now() - start;
if (engine.VERSION !== ENGINE_VERSION) throw new Error('ENGINE_VERSION');
const families = {};
const cases = [];
for (const fixture of corpus) {
  const began = performance.now();
  const detection = engine.scan(fixture.text, {
    policy: {
      evaluate: (finding) =>
        finding.type === 'private_key' ? 'block' : 'redact',
    },
  });
  const found = [...new Set(detection.map((finding) => finding.type))].sort();
  const response = await processRequest(
    {
      protocolVersion: 1,
      requestId: fixture.id,
      operation: 'sanitize',
      policyId: POLICY_ID,
      segments: [{ id: 's0', text: fixture.text }],
    },
    engine,
  );
  const elapsedMs = performance.now() - began;
  const positive = fixture.expectedTypes.length > 0;
  const allExpected = fixture.expectedTypes.every((type) =>
    found.includes(type),
  );
  const anyFinding = found.length > 0;
  families[fixture.family] ??= {
    positive: 0,
    negative: 0,
    TP: 0,
    FP: 0,
    FN: 0,
    TN: 0,
  };
  const row = families[fixture.family];
  if (positive) {
    row.positive++;
    row[allExpected ? 'TP' : 'FN']++;
  } else {
    row.negative++;
    row[anyFinding ? 'FP' : 'TN']++;
  }
  const outputMatches =
    fixture.expectedStatus === 'blocked'
      ? response.status === 'blocked' && !Object.hasOwn(response, 'segments')
      : response.status === 'ok' &&
        response.segments[0].text === fixture.expectedText;
  const metadata = { ...response };
  delete metadata.segments;
  const metadataJson = JSON.stringify(metadata);
  const matchedValues = detection
    .map((finding) => fixture.text.slice(finding.start, finding.end))
    .filter((value) => value.length >= 8);
  const noInputInMetadata =
    (fixture.text.length < 8 || !metadataJson.includes(fixture.text)) &&
    matchedValues.every((value) => !metadataJson.includes(value));
  cases.push({
    id: fixture.id,
    family: fixture.family,
    source: fixture.source,
    split: fixture.split,
    expectedTypes: fixture.expectedTypes,
    actualTypes: found,
    status: response.status,
    detectionMatches: allExpected && (positive || !anyFinding),
    exactOutputMatches: outputMatches,
    safeMetadataMatches: noInputInMetadata,
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
  });
}
const summary = Object.values(families).reduce(
  (sum, row) => {
    for (const key of Object.keys(sum)) sum[key] += row[key];
    return sum;
  },
  { positive: 0, negative: 0, TP: 0, FP: 0, FN: 0, TN: 0 },
);
for (const row of [...Object.values(families), summary]) {
  row.precision = row.TP + row.FP ? row.TP / (row.TP + row.FP) : null;
  row.recall = row.positive ? row.TP / row.positive : null;
}
const report = {
  scope:
    'synthetic engine/helper assessment; no host or independent benchmark qualification',
  engineVersion: engine.VERSION,
  artifact: engine.artifact(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  corpusSha256: digest(corpusBytes),
  heldoutSha256: digest(heldoutBytes),
  lockfileSha256: digest(lockBytes),
  initializationMs: Math.round(initializationMs * 1000) / 1000,
  summary,
  families,
  cases,
};
await writeFile(
  new URL('qualification/results/quality-report.json', root),
  `${JSON.stringify(report, null, 2)}\n`,
);
const failures = cases.filter(
  (row) =>
    !row.detectionMatches ||
    !row.exactOutputMatches ||
    !row.safeMetadataMatches,
);
const lines = [
  '# Synthetic quality assessment',
  '',
  `Pinned engine ${report.engineVersion}, ${report.artifact}, ${report.node}, ${report.platform}/${report.arch}.`,
  '',
  `Corpus: ${corpus.length} cases; ${summary.positive} positives, ${summary.negative} negatives. Detection: TP ${summary.TP}, FN ${summary.FN}, FP ${summary.FP}, TN ${summary.TN}.`,
  '',
  'TP/FN count positive cases with all required family labels present/missing. FP/TN count negative cases with any/no finding. A wrong-family positive is an FN; incidental additional labels are exposed per case in JSON. These denominators are case counts, not finding-level recall.',
  '',
  '| Family | Positives / negatives | TP / FN | FP / TN | Precision / recall |',
  '| --- | --- | --- | --- | --- |',
  ...Object.entries(families).map(
    ([family, row]) =>
      `| ${family} | ${row.positive} / ${row.negative} | ${row.TP} / ${row.FN} | ${row.FP} / ${row.TN} | ${row.precision === null ? 'N/A' : row.precision.toFixed(3)} / ${row.recall === null ? 'N/A' : row.recall.toFixed(3)} |`,
  ),
  '',
  `Six supplementary cases are reserved from helper tests and initial assessment; ${cases.filter((row) => row.split === 'heldout' && row.detectionMatches && row.exactOutputMatches).length}/6 passed detection and exact-output expectations. They were authored after observing the initial assessment and are a public maintainer holdout, not independent or permanently blind evaluation. No detector/policy tuning used either split.`,
  '',
  '## Exact-output and metadata checks',
  '',
  `${cases.filter((row) => row.exactOutputMatches).length}/${cases.length} exact output/block expectations passed. ${cases.filter((row) => row.safeMetadataMatches).length}/${cases.length} metadata checks passed.`,
  '',
  ...failures.map(
    (row) =>
      `- ${row.id}: expected ${row.expectedTypes.join(', ') || 'no findings'}; observed ${row.actualTypes.join(', ') || 'no findings'}; status ${row.status}; exact output ${row.exactOutputMatches ? 'pass' : 'FAIL'}.`,
  ),
  '',
  '## Limits and interpretation',
  '',
  'This is a small maintainer-curated synthetic assessment, not independent benchmark or host delivery evidence. Labels and exact outputs were frozen before execution. Revision 2 corrects an invalid AWS fixture length after the initial run, documented with the original corpus hash and score in [the corpus notes](../benchmarks/README.md). No detector or policy was tuned; no difficult case was removed. External published protocol shapes use new synthetic values with source/license provenance in those notes.',
  '',
  'Base64 and zero-width cases deliberately test unsupported/uncertain obfuscation. Their misses are release-relevant limitations, not evidence that the underlying plaintext is safe. A finding does not prove secure storage, UI redaction, or fail-closed host delivery.',
  '',
  `In-process initialization measured ${report.initializationMs} ms; per-case scan/helper times are in JSON. These are warm in-process measurements and do not qualify the 2,000 ms process cold-start budget, end-to-end latency, or platform support.`,
  '',
  `Corpus SHA-256: ${report.corpusSha256}. Held-out source SHA-256: ${report.heldoutSha256}. Lockfile SHA-256: ${report.lockfileSha256}. These identify public artifacts, not input secrets. See [machine-readable evidence](quality-report.json).`,
  '',
];
await writeFile(
  new URL('qualification/results/quality-report.md', root),
  lines.join('\n'),
);
console.log(
  JSON.stringify({
    summary,
    cases: cases.length,
    failedExpectations: failures.length,
    artifact: report.artifact,
  }),
);
