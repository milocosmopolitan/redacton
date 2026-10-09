# Pinned engine research for issues #5 and #10

Research only. No helper, corpus, runtime performance, or host interception was implemented or qualified. Downstream work waits for the #2 compatibility decision.

## Immutable source identity

`@redact-secret/core@0.1.0-beta.14`, annotated tag `v0.1.0-beta.14`, resolves to commit `0c62fd38bca75c5b28b042dc79789b708ebf1d17`. Findings below were read through GitHub's source API, without installing packages. Registry tarball identity and clean-install behavior still require verification.

Source links below use that immutable commit:

- [Public entry](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/packages/javascript/src/index.ts)
- [Types](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/packages/javascript/src/types.ts)
- [Runtime contract](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/packages/javascript/src/runtime.ts)
- [Node loader](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/packages/javascript/src/runtime/node.ts)
- [Core manifest](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/packages/javascript/package.json)

## Confirmed API and policy

`initialize(options?: InitializeOptions): Promise<void>` must succeed before synchronous operations. Omit `pii` to keep PII off. Equivalent calls share loading; failed initialization is not cached. Runtime verifies engine version and detector profile.

`scanAndRedact(input: string, options?: ScanAndRedactOptions): ScanResult` returns `{ text: string, findings: readonly SecretFinding[] }`. `scan(input, options)` returns findings; `redact(input, findings, options)` requires findings from that exact input. Prefer `scanAndRedact` to avoid mismatched input/findings.

`ScanOptions` supports `policy`, `actionPolicy`, `limits`, and `ruleset`. A callback policy has `evaluate(finding, context): SecretAction`; actions are `redact | block | warn | allow`. A callback and declarative action policy together are invalid. The engine's redaction replaces both `redact` and `block` findings with placeholders but leaves `warn` and `allow` unchanged. Therefore Redacton must explicitly choose actions for every recognized finding and withhold the entire event if any finding has `block`; an engine `block` action alone does not withhold delivery.

Proposed helper policy: return `block` when `finding.type === "private_key"`, otherwise `redact`. The pinned Rust detector emits type `private_key` and detector ID `private-key`; keep those two identifiers distinct. The private-key detector source recognizes six PEM labels, requires body evidence for a complete block, and ignores a lone incomplete header. “Block private-key content” means recognized findings, not guaranteed detection of every key representation.

`WholeInputLimits` is `{ maxInputBytes, maxFindings }`, with UTF-8 byte accounting. Public finding ranges are UTF-16 `[start,end)` code units; never use these to rewrite text manually. The helper needs aggregate event limits across segments in addition to per-call engine limits. Reject an unpaired UTF-16 surrogate through the engine's fixed failure path. Findings are frozen safe metadata, but responses should still project only required canonical counts, not serialize whole findings or opaque internal handles.

`artifact()` reports `addon | wasm` after initialization. `status()` is input-free and reports public initialization/activation status without loading. The public entry re-exports `VERSION` from `version.ts` through `entry-core.ts`; use that exact export for the response's engine version.

## Lifecycle-script-independent packaging

The core manifest declares ESM, Node `20.x || 22.x || 24.x`, mandatory `@redact-secret/wasm@0.1.0-beta.14`, and eight exact optional native packages for macOS ARM64/x64, Linux ARM64/x64 GNU/musl, and Windows ARM64/x64 MSVC. Its manifest has no lifecycle scripts.

The native loader first requires the platform package and validates exports. Missing, unsupported, or corrupt addon loading falls back to WASM. The fallback imports `@redact-secret/wasm` dynamically, resolves its `package.json`, reads the sibling `redact_secret_wasm_bg.wasm`, and initializes generated glue directly from bytes. A JavaScript-only helper bundle will omit that runtime-resolved binary unless packaging explicitly retains it. Do not assume bundling discovers dynamic imports or native assets.

Recommended artifact design after #2: prebuild helper JavaScript, preserve pinned core and runtime dependency packages inside the plugin root, retain package export maps and WASM glue/binary, and include exact lockfile and notices. Qualify `npm ci --ignore-scripts`, native loading, forced missing-addon WASM fallback, missing/corrupt WASM, and a clean plugin copy with no repository dependencies available. No source compilation should run on installation. This is a design recommendation, not an installation result.

Both [engine LICENSE](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/LICENSE) and [WASM manifest](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/bindings/wasm/npm/package.json) declare MIT; preserve copyright and license text. Redacton's own license and transitive notices remain release gates.

## External assessment provenance

The engine pins benchmark commit `573e128863e0543133e5ccbd513216d19513b7da`. The benchmark repository declares MIT, but individual imported sources retain their own notices/licenses.

[External-input pack README](https://github.com/redact-secret/redact-secret-benchmarks/blob/573e128863e0543133e5ccbd513216d19513b7da/adversarial/packs/beta9-external-inputs/README.md) records 80 fixtures: 38 must-redact and 42 must-not-flag. Its [sources manifest](https://github.com/redact-secret/redact-secret-benchmarks/blob/573e128863e0543133e5ccbd513216d19513b7da/adversarial/packs/beta9-external-inputs/sources.json) gives per-fixture provenance, pinned revisions, verbatim/composed identity, and licenses. Sources include IETF examples (IETF Trust terms; code components BSD-3-Clause), Yelp detect-secrets and Nosey Parker (Apache-2.0), Big List of Naughty Strings and Trojan Source (MIT), and AWS CLI examples (Apache-2.0).

The project selected inputs and wrote labels after reading engine specs. Upstream explicitly classifies this pack as maintainer regression, not independent external authorship. Reuse can provide external-source assessment cases, but cannot justify an independent benchmark claim. Copy only verified synthetic examples with their exact per-source notice obligations; reproducing shapes with new synthetic values still needs transparent provenance and bias disclosures.

Do not import SecretBench/FPSecretBench (real-repository material and gated access), Leaky Repo (real-derived values), or examples with unclear origin. Keep evaluation cases separate from tuning. Public holdout controls are not protected holdout evidence; [holdout README](https://github.com/redact-secret/redact-secret-benchmarks/blob/573e128863e0543133e5ccbd513216d19513b7da/holdout/README.md) says their public seed/construction cannot establish independent detector performance.

After #5, issue #10 should freeze corpus/engine identity and expected family labels before execution, report TP/FP/FN and denominators per family, distinguish detection from delivery blocking, and disclose unsupported encoding/obfuscation. Engine upstream accuracy numbers cannot be reused as Redacton measurements. No accuracy or startup measurement was performed in this research.

## Outstanding blockers

1. #2 must prove supported host replacement/withholding before helper/scaffold implementation proceeds.
2. Installed beta.14 exports/type identifier, registry artifact integrity, and actual native/WASM installations are unverified.
3. The 2,000 ms cold-start target and 2 MiB output ceiling depend on host process limits and require measurement.
4. Representative held-out results, package notices, and Redacton's distribution license remain unimplemented release evidence.
