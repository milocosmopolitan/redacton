# Architecture

Redacton is a Claude Code Mod. TypeScript is the source language for the Mod and Node helper; the host loads the Mod directly, while the helper is prebuilt for distribution. Detection stays in `@redact-secret/core@0.1.0-beta.14`; a Rust helper is not introduced because the existing engine already supplies native and WASM implementations.

## Runtime boundaries

`mod/` registers SDK hooks, commands, and the prompt-area indicator. SDK calls remain in the registration module. State, protocol validation, and adapters are pure helpers that receive data rather than SDK capabilities. The Mod runtime has no Node or WebAssembly and never imports the scanner.

`helper/src/` runs in a separate Node process. It initializes the pinned engine and scans a whole event's text segments in one batch. The registration module launches an argv array and sends the request through stdin. Credentials never enter shell text, argv, explicit environment values, or temporary input files. `helper/dist/` is generated prebuilt output.

`tests/` covers pure code and SDK event chains. `qualification/` holds reusable actual-host regressions using isolated configuration, synthetic credentials, and loopback model responses. Historical release evidence is linked from [compatibility](docs/COMPATIBILITY.md), rather than copied into the current source tree.

## State and delivery

Each session owns requested ON/OFF, loading/ready/unavailable readiness, a policy epoch, and at most 100 safe records. Requested ON does not mean the helper is ready. `/redacton` requests ON and makes one coalesced settings-load/self-check recovery attempt; `/redactoff` bypasses future scans and shows immediate and persistent prompt-area warnings. Disabling protection and opening mutation forms require the host-stamped local composer origin, not caller-supplied text. There is no global saved OFF preference. See [recovery taxonomy](docs/RECOVERY.md) and [authority](docs/HOST-AUTHORITY.md).

A prompt captures policy before awaiting work, extracts supported text/context, validates a helper response, and calls `next` with a fresh sanitized event. Unsupported selected shapes withhold submission. Attachments and other unqualified content are outside coverage.

For Read/Bash, an outer hook captures policy and associates the invocation by agent/tool/tool-use identity. The tool executes once with the host's permissions intact. Inner processing publishes only a fully validated sanitized envelope or fixed denial. The outer ON hook ignores the envelope returned by `next` and delivers only that trusted publication. It never returns cached original content from a catch handler. Captured OFF bypasses helper dispatch, including when the user toggles ON while the tool runs.

Adapters reconstruct an allowlist. Read scans content and the required file path; Bash scans stdout/stderr. Original `text`/`ref` aliases are discarded. Declared Bash `rawOutputPath` and `structuredContent` are accepted only as absent/undefined data properties and are omitted from rebuilt results. Populated values, accessors, symbols, unknown fields, populated unsupported metadata, and nonempty downstream tool context withhold the whole selected result. Tool arguments and authentication parameters are unchanged.

## Configuration UX

Pure `mod/config.ts`, `mod/settings.ts` and `mod/view.ts` own staged edits, explicit layer replacement, immutable revisions, project trust and cached status. A canonical pure schema in `helper/src/config.ts` is shared with the helper and explicitly shipped for native TypeScript imports. Registration owns commands, local form events and SDK calls; imported controllers never receive capabilities.

Configuration uses redact/block recipes compiled and parsed by pinned beta.14. Preserve the baseline callback: a ruleset alone defaults custom matches to warn. Names share one detector identity, so mixed names actions are rejected. Validate → synthetic preview → explicit apply; operation snapshots capture exact configuration with ON/OFF. Saved settings contain definitions only, with exact-document/revision project approval and privileged helper compare-and-replace writes. Scope identity is opaque location metadata, not a rule/input digest; private namespace initialization belongs to settings load/save, never status. Personal defaults restore before first supported work; project data remains pending until approved. See [configuration](docs/CONFIGURATION.md) and [the accepted decision](docs/decisions/validated-layered-configuration.md).

## Protocol and limits

The protected scan protocol uses opaque request/segment IDs and statuses `ok`, `blocked`, or `failed`. Its configuration extension binds an exact immutable configuration and opaque revision; mismatched revision/custom-type replies are invalid. The previous published version used protocol 1 and policy `credentials-alpha1`. Successful replies must contain exactly the requested segment set, pinned engine/policy identity, and canonical finding counts. Duplicate/missing IDs, malformed/trailing JSON, truncation, invalid statuses, limits, and process failures cause withholding. Private-key findings block the whole event; all other recognized credentials redact through the engine's own range handling.

Configured limits: 262,144 UTF-8 input bytes, 256 segments, 1,000 findings, 2,097,152 response bytes, four pending protected helper calls, 2,000 ms including process startup, and 100 recent safe records. These are bounds, not latency guarantees.

Cancellation is checked before dispatch, after response, and before delivery. The installed process API has no AbortSignal option; a dispatched child may continue until its timeout. Its environment overlays the host's inherited environment. All helper launches clear inherited `NODE_OPTIONS` and `NODE_PATH`, but other host values remain inherited, so no clean-child-environment guarantee exists. Settings locks bind a nonce to host/namespace and observed process start; indeterminate ownership remains busy, with an explicit separate-root recovery route. See [storage and environment](docs/STORAGE-ENVIRONMENT.md).

## Assurance and packaging

The [accepted layered-guard decision](docs/decisions/layered-trusted-results.md) explains why a single catch handler is insufficient. The host can skip every failing guard or disable the plugin. Redacton cannot guarantee arbitrary host/all-guards failure is fail closed.

Model payload, UI, and transcript/storage are separate boundaries. Original prompts and tool arguments can persist before interception; blocking output cannot undo execution or prior storage. No secure memory erasure is promised. See [the threat model](docs/THREAT_MODEL.md).

Artifacts contain the prebuilt helper, exact dependency lockfile, native/WASM runtime assets inside the plugin root, and license/notices. Clean installation must work with lifecycle scripts disabled, without external symlinks. A source refactor does not alter or requalify an already published release.

Current portable candidates include only the pinned core and its WASM dependency. Omitting native optional packages selects the core's supported automatic fallback through the same public import; platform detection and installers do not fork the scanner, configuration or Mod. Deterministic Node archive tooling produces equivalent tar/ZIP layouts, rejects unsafe entries, and records checksums/provenance. Native-addon development checks and actual-host qualification remain independent gates; see [platform targets](docs/PLATFORMS.md).

## Sources

Use the declarations generated by the installed Claude Code version. Official [Mod reference](https://code.claude.com/docs/en/plugins/mods/reference), [testing guide](https://code.claude.com/docs/en/plugins/mods/test), and [pinned engine source](https://github.com/redact-secret/redact-secret/tree/v0.1.0-beta.14) describe the relevant APIs; installed behavior takes precedence over public snapshots.
