# Synthetic quality assessment

Pinned engine 0.1.0-beta.14, addon, v22.16.0, darwin/arm64.

Corpus: 29 cases; 18 positives, 11 negatives. Detection: TP 17, FN 1, FP 0, TN 11.

TP/FN count positive cases with all required family labels present/missing. FP/TN count negative cases with any/no finding. A wrong-family positive is an FN; incidental additional labels are exposed per case in JSON. These denominators are case counts, not finding-level recall.

| Family | Positives / negatives | TP / FN | FP / TN | Precision / recall |
| --- | --- | --- | --- | --- |
| github | 3 / 1 | 3 / 0 | 0 / 1 | 1.000 / 1.000 |
| aws | 3 / 1 | 3 / 0 | 0 / 1 | 1.000 / 1.000 |
| bearer | 3 / 1 | 3 / 0 | 0 / 1 | 1.000 / 1.000 |
| connection | 3 / 1 | 3 / 0 | 0 / 1 | 1.000 / 1.000 |
| private_key | 2 / 1 | 2 / 0 | 0 / 1 | 1.000 / 1.000 |
| contextual | 2 / 2 | 2 / 0 | 0 / 2 | 1.000 / 1.000 |
| obfuscation | 2 / 0 | 1 / 1 | 0 / 0 | 1.000 / 0.500 |
| benign | 0 / 4 | 0 / 0 | 0 / 4 | N/A / N/A |

Six supplementary cases are reserved from helper tests and initial assessment; 6/6 passed detection and exact-output expectations. They were authored after observing the initial assessment and are a public maintainer holdout, not independent or permanently blind evaluation. No detector/policy tuning used either split.

## Exact-output and metadata checks

28/29 exact output/block expectations passed. 29/29 metadata checks passed.

- github-base64: expected github_token; observed no findings; status ok; exact output FAIL.

## Limits and interpretation

This is a small maintainer-curated synthetic assessment, not independent benchmark or host delivery evidence. Labels and exact outputs were frozen before execution. Revision 2 corrects an invalid AWS fixture length after the initial run, documented with the original corpus hash and score in [the corpus notes](../benchmarks/README.md). No detector or policy was tuned; no difficult case was removed. External published protocol shapes use new synthetic values with source/license provenance in those notes.

Base64 and zero-width cases deliberately test unsupported/uncertain obfuscation. Their misses are release-relevant limitations, not evidence that the underlying plaintext is safe. A finding does not prove secure storage, UI redaction, or fail-closed host delivery.

In-process initialization measured 1.031 ms; per-case scan/helper times are in JSON. These are warm in-process measurements and do not qualify the 2,000 ms process cold-start budget, end-to-end latency, or platform support.

Corpus SHA-256: f311db4cacf0a0993f1e846ee46693d842949befbdf1fd299ead93347b9b787f. Held-out source SHA-256: 77cbc8ea0fcab6731b19bb5dfd3cf54556f363fe87952ec4b2528ff0eb1c45f8. Lockfile SHA-256: 07ba19be0deab2cd4939a31a61dc8b54ac3ba7040610492d0e61d22f36b5fb53. These identify public artifacts, not input secrets. See [machine-readable evidence](quality-report.json).
