# Threat model

This describes the intended boundary and current limitations. It does not establish production readiness, host transcript protection, or coverage for every tool. Compatibility evidence and known host bypass behavior take precedence over this design.

## Assets and trust boundaries

Credential-bearing prompt text, supported textual prompt context, and selected Read/Bash results enter the Claude Code host first. The host owns collection, permission checks, invocation, transcript/storage, model-request construction, and UI. A Mod can sanitize only paths the host actually exposes and honors. Original input may already exist in memory or storage before a hook runs.

The registration module owns SDK calls and session state. Pure adapters receive data, validate a narrow supported shape, batch text, and construct new envelopes. Required Read file paths are scanned as text alongside content. Tool arguments and authentication parameters are unchanged. Text/ref aliases are removed; unknown fields and downstream result context withhold the whole selected result. Unsupported prompt attachments and unknown origins/shapes are not represented as inspected.

The separate Node helper loads the pinned engine. It receives input through process stdin, never command arguments, shell text, credential environment variables, or temporary input files. Its stdout is bounded protocol JSON; failure diagnostics are fixed codes. Process startup, protocol parsing, engine/native/WASM dependencies, and packaging are additional trust boundaries.

The model payload, rendered UI, and transcript/storage are separate outputs. A sanitized model request says nothing by itself about UI or earlier persistence. Redacton does not promise secure memory erasure; plaintext temporarily exists in host/helper memory, runtime copies, and process pipes.

## Attacker capabilities and mitigations

Malicious prompt or tool text may mimic protocol syntax, contain credentials, use Unicode/escaping/obfuscation, or exceed budgets. It remains JSON string data; registration uses an argv array and stdin without shell interpolation. Strict request/response identity and whole-batch validation prevent partial sanitized/raw mixing. Detector semantics remain in the pinned engine; adapters do not invent regex detection or manually edit ranges.

Credential recognition is incomplete. The measured corpus includes a base64-encoded credential miss. A zero-finding response means no recognized findings, not safe input. Unsupported families, encodings, binary data, MCP, tool arguments, old history, and live-provider validation are outside the initial promise.

Selected ON operations should withhold content on missing dependencies, malformed/truncated output, timeout, limits, cancellation, and policy failure. Requested ON is separate from readiness. Operations capture policy once; OFF bypasses helper dispatch and visibly warns. A result block after execution cannot undo tool effects, permission decisions, or earlier storage. Original tools must execute at most once.

## Configuration and local UI

Internal credential formats can be sensitive even without actual credential values. The pinned baseline scanner rejects recognizable literal credentials in rule fields before activation/import/export/persistence, but unknown internal values cannot be universally recognized. Users must never paste actual credentials; saved definitions are not guaranteed secret-free. Management commands accept no arguments: the host can persist submitted slash arguments before local rejection. Local form persistence must be measured on the exact surface/version; a fixture with no observed file persistence is not a universal no-storage guarantee.

A repository can supply malicious or stale project configuration. Treat it as declarative untrusted data: bound and reject unknown fields, compile through the pinned core, preserve built-ins/private-key blocking, and require exact-revision project review/trust. Rule IDs, actions, counts and opaque revisions are safe view metadata; rule bodies, raw paths and helper errors are not diagnostics. Local configuration/preview response bodies must never become model messages.

Validation and synthetic preview do not measure detection accuracy. Explicit apply captures a new immutable revision for later operations; stale callbacks, saves and undo cannot overwrite concurrent work. Session reset revokes project trust and pending changes. Saved data excludes OFF, input history and recent outcomes. Atomic compare-and-replace protects against partial writes and cooperating concurrent editors; it does not defend against a compromised host or arbitrary external filesystem writer.

## Host fallback and environment limitations

The measured Claude Code host can fall back to original tool output if the main hook and its catch handler both fail. Additional outer guards mitigate tested inner failures, but failure of every guard can still cross this boundary. The Mod cannot guarantee arbitrary all-guards failure is fail closed on this host. Do not turn successful guarded-path tests into an unconditional protection claim.

The installed process API overlays `env` onto the inherited host environment and exposes no clean-environment option. Omitting credentials from explicit options does not prevent inherited host credentials reaching the helper process. The helper/native dependencies must be trusted; a malicious dependency or compromised host can read input and inherited environment. A clean-environment guarantee requires a different verified host capability, not invented process fields. No AbortSignal is declared; cancellation cannot be assumed to kill a dispatched helper before its bounded timeout.

The pinned engine, native addons, WASM binary/glue, Node executable, and packaged artifact are supply-chain trust dependencies. Exact pins, lockfile integrity, licenses/notices, clean artifact installation without lifecycle scripts, and independent native/WASM tests reduce uncertainty; they do not protect against a malicious host or dependency publisher.

## Diagnostics and release gates

Safe diagnostics contain fixed codes, canonical types, bounded counts, readiness/coverage, engine versions, and opaque identifiers. No credential previews, matched values, raw paths, raw process stderr, arbitrary exceptions, or secret hashes should be emitted. Public corpus/artifact hashes identify synthetic source artifacts only.

No telemetry, credential validation, vault, restore, PII processing, or automatic outreach is added. Host telemetry/persistence remains separately unqualified. Release requires compatibility evidence with exact versions and exclusions, dependency notices and project license, private security reporting, and a documented private conduct route. Reporting-channel configuration is not a response-time or absolute-confidentiality guarantee.
