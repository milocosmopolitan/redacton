# Experimental local helper

This helper proves local engine/protocol behavior, not the host's model-context protection boundary. The host qualification gate remains independent.

Run `node helper/build.mjs` to copy prebuilt ESM and the canonical type list into `helper/dist`. Invoke `node helper/dist/index.mjs` using an argv array and pass one UTF-8 JSON request through stdin. Stdout contains one response JSON line; no raw exceptions are logged. Core and its pinned runtime dependencies must remain resolvable inside the distributed plugin. Installation uses `npm ci --ignore-scripts`; no helper compilation runs during installation.

Requests require protocolVersion 1, an opaque requestId (1–64 ASCII letters, digits, underscores or hyphens), policyId `credentials-alpha1`, and operation `self-check` or `sanitize`. Sanitize additionally requires 1–256 unique `{id,text}` segments. Self-check carries no segments. Extra fields are rejected. Limits are 256 KiB total text in UTF-8, 1,000 total findings, 2 MiB response JSON, and a 2,000 ms deadline including stdin/startup. Serialized stdin has a separate 2 MiB bound. The parent must also kill the helper at its deadline because synchronous engine scanning prevents JavaScript timers from firing.

The policy overrides warning/allow defaults: every recognized credential finding is redacted; a recognized private key blocks the complete event without returning partial segments. This does not detect every credential representation. No PII activation, rulesets, live verification, restore store, or telemetry is enabled.

Successful sanitize responses include sanitized segments, canonical finding counts, artifact kind, engine version, policy identity, and request identity. Self-check succeeds with the same safe identity/artifact fields and empty counts, without segments. Failed/blocked responses include a fixed error code and no sanitized/partial/original segments. Invalid requests can return requestId null; callers must withhold rather than accepting mismatched identity. Parent validation must reject extra/missing fields, mismatched IDs, invalid status, truncation, duplicate/missing segments, excessive bytes, and counts outside the limits.

`src/canonical-types.json` contains only the 157 `types[].type` values from the MIT-licensed pinned engine's [inventory](https://github.com/redact-secret/redact-secret/blob/0c62fd38bca75c5b28b042dc79789b708ebf1d17/docs/coverage/detector-inventory.json), copyright 2026 Omiologic. It contains no fixture input. The engine license notice must accompany distribution.

Tests use synthetic examples. Clean-copy qualification exercised macOS ARM64 native loading, removed-addon WASM fallback, missing-WASM failure, and packaged helper files on Node 22.16.0. It is not a complete platform matrix, timeout performance study, host qualification, or independent accuracy benchmark.
