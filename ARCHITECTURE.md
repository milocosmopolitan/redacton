# Redacton Architecture

Design baseline: October 9, 2026. Everything described as a contract or component below is planned unless explicitly marked as an upstream fact. The repository currently has no implementation.

## 1. Goal and trust boundary

Protect supported textual inputs at Claude Code's model-context boundary using local, deterministic credential redaction.

Upstream fact: the public Mod SDK restricts module imports and provides a host process API rather than Node or WebAssembly in the Mod runtime. Installed generated SDK types are the authority for an implementation. Public documentation and public type snapshots can differ.

Implementation hypothesis: supported hooks can replace or withhold selected prompt and tool-result content before model delivery. This must be proven with host-level tests. Host transcript persistence, rendered UI, and model payload are separate channels; replacing one does not prove the others are sanitized.

## 2. Components

| Component | Responsibility |
| --- | --- |
| Mod entry point | Registers commands/hooks/UI through the host SDK. |
| Session controller | Owns requested ON/OFF state, readiness, policy epoch, and operation snapshots. |
| Pure adapters | Extract supported text and rebuild allowlisted host envelopes; no SDK capabilities passed in. |
| Local Node helper | Validates protocol, initializes Redact Secret, scans/redacts batches, emits bounded JSON. |
| Safe diagnostics | Reports coverage, counts, readiness, and fixed error codes without input content. |
| Qualification harness | Tests helper behavior and actual host delivery independently. |

Planned paths: `.claude-plugin/plugin.json`, `mod/index.ts`, `mod/adapters/`, `helper/src/`, `helper/dist/`, `tests/`, and `qualification/`. Verify the manifest and entry conventions against the installed SDK before freezing these paths.

Keep SDK calls in the registration module. Imported pure functions receive data, not `$` or other host capabilities. No dynamic imports in the Mod and no references outside the plugin root.

## 3. Session state and commands

State includes:

- requestedProtection: ON or OFF;
- readiness: loading, ready, or unavailable;
- policyEpoch: incremented for state/policy changes;
- session identity and bounded safe recent-event records.

Effective UI states are Protect ready, Protect loading/unavailable, and OFF. Coverage is displayed separately. Loading or unavailable must never look like ready.

`/redacton` requests ON immediately for future operations and runs or reuses a readiness check. Until ready, selected protected operations are held or refused safely. `/redactoff` requests OFF for future operations and immediately shows the one-time warning and persistent OFF indicator. Both commands are idempotent and accept no sensitive arguments.

Defaults:

| Event | State behavior |
| --- | --- |
| New/restored/branched session | Requested ON; readiness must be established. |
| Hot reload of the same live session | Preserve state if host support is proven; otherwise reset ON with notice. |
| ON to OFF during a running operation | That operation completes under its captured ON policy. |
| OFF to ON during a running operation | That operation remains bypassed; show that protection is not retroactive. |
| OFF operation | No scanner call or helper dispatch. |

Snapshot state at the earliest supported operation boundary before awaiting work. Store snapshot identifiers locally; never embed credential material in them. If the SDK cannot associate tool invocation and completion reliably, do not claim start-of-operation semantics until an alternative is explicitly designed and tested.

Use session and request identifiers to prevent cross-session or concurrent-result confusion. No global OFF flag. Recent records are bounded to a proposed maximum of 100 and contain only safe metadata.

## 4. Supported interception flow

For each selected operation:

1. Capture session state and policy epoch.
2. Preserve the host's permission checks and invoke the original operation at most once where needed.
3. If captured OFF, return the original supported envelope with the persistent warning already visible.
4. If captured ON, extract all supported textual segments into one bounded batch.
5. Scan through the helper; validate the complete response.
6. Rebuild an allowlisted envelope using sanitized text, or withhold the protected result on error.
7. Emit safe counts and coverage metadata.

For `Read` and `Bash`, scanning follows execution. Blocking the returned content does not undo execution or filesystem changes. Never retry the tool or override a denied permission.

For selected tools, an unknown shape or unsupported content within the promised protected scope must cause whole-result withholding. Unselected tools remain explicitly outside coverage. Unsupported binary content must not be presented as inspected.

## 5. Envelope safety

Host tool results may expose `result`, `text`, `context`, and `ref`. A rewritten result must not retain an alias or reference that lets the host recover the original content.

Do not spread an original envelope and replace a single field. Build a minimal schema-valid envelope from allowlisted fields and sanitized segments. Remove original-content references and verify the host does not follow hidden aliases.

Safe error envelopes must be accepted by the host schema. An invalid replacement can cause the host to skip the hook and use the original, defeating protection.

Catch handlers must return a fixed, tested safe response without scanner calls. After the original tool has run, a catch handler must never call or return a cached `next()` result containing original text. If the host can bypass a failed hook, qualify the exact failure behavior and narrow claims accordingly.

## 6. Helper protocol and packaging

Use `$.process.run` with an argv array and stdin. Do not use shell interpolation. Pin a Node 22/24 evaluation matrix and qualify exact versions before declaring support.

One process per selected event is the initial design. Batch all text segments in that event; measure cold-start cost before considering a long-lived helper.

Request fields:

```json
{
  "protocolVersion": 1,
  "requestId": "opaque-id",
  "operation": "sanitize",
  "policyId": "credentials-alpha1",
  "segments": [{"id": "s0", "text": "synthetic input"}]
}
```

A separate self-check operation carries no user input. Response fields include protocol version, request ID, status (`ok`, `blocked`, or `failed`), sanitized segments for successful requests, canonical finding counts, engine version, and a fixed error code where applicable.

Implementation must freeze schemas and reject duplicate IDs, missing segments, unknown statuses, mismatched request IDs, trailing/invalid JSON, and oversized or truncated output. Partial success must never cause original segments to be mixed into an ON result.

Helper stdout is protocol JSON only. Stderr contains fixed codes only. Do not expose raw exceptions, SDK process errors, environment values, or filesystem paths in UI/logs. Default process-environment inheritance needs review; do not add credentials to the child environment.

Bundle prebuilt helper JavaScript in the distributed plugin. The host may install dependencies with lifecycle scripts disabled; runtime postinstall compilation is not a viable assumption. Use an exact dependency pin, npm lockfile, and a clean-artifact installation test. Native/WASM fallback, platform packaging, and notices must be qualified. No symlinks outside the plugin root.

## 7. Detection and policy

The helper uses `@redact-secret/core@0.1.0-beta.14` through its supported initialization and scan/redact API. Verify precise API signatures from the pinned source before implementation.

Redact Secret owns detection and range handling. Redacton owns coverage selection, policy enforcement, transport validation, limits, and safe display.

Alpha 1 policy must redact all recognized credential findings and block private-key content. Do not silently inherit a warning-only default. Do not add regex detection in adapters, hand-edit ranges, or invent incremental chunk stitching. Each event is scanned as finalized bounded text.

Alpha 1 does not enable PII anonymization, vault/restore, live credential validation, per-plaintext exceptions, or automatic rewriting of authentication/tool arguments.

## 8. Failure and resource policy

These are provisional budgets to measure during qualification, not verified performance claims:

| Limit | Initial target |
| --- | --- |
| Input text per event | 256 KiB in UTF-8 |
| Segments per event | 256 |
| Findings per event | 1,000 |
| Helper output | 2 MiB, further constrained by the host's output limit |
| Helper timeout | 2,000 ms including startup |
| Recent safe records | 100 |

Bound pending work as well as each event. Excess input, queue saturation, startup failures, unavailable dependencies, malformed output, policy errors, and timeouts must withhold selected ON content and emit a safe reason. OFF explicitly bypasses these scanning checks.

Check cancellation before dispatch, after the helper returns, and before delivery. Do not assume the process API supports an AbortSignal: use only installed SDK fields. If cancellation cannot kill the child immediately, acknowledge that it may continue until its timeout.

## 9. Warnings and diagnostics

OFF uses both immediate feedback and a persistent indicator near the prompt. Do not display a modal for every tool result. Verify visibility during typing and after command execution on the target host.

If the host cannot render that surface, Alpha 1 must provide a proven visible fallback at the next prompt and describe the limitation. Do not claim persistent warning support without testing it.

Safe metadata: canonical detector type, counts, fixed error code, engine version, opaque operation ID, and an explicit coverage state. No matched plaintext, raw path, raw tool argument, snippet, diff, or secret hash. A zero-finding result is described as no recognized findings, not safe content.

## 10. Qualification and release gates

Before Alpha 1:

- Prove prompt replacement/withholding and Read/Bash result replacement on an actual host.
- Verify model payload excludes synthetic markers in ON; inspect transcript/storage separately.
- Test all original-content aliases, especially `ref`, and forced hook failures.
- Test missing Node, dependency load failure, malformed/truncated helper output, limits, and timeout.
- Test OFF bypass, repeated commands, persistent warning, both mid-flight toggle directions, restored/branched sessions, concurrency, cancellation, and permission denial.
- Verify no tool reexecution or authentication/tool-argument rewriting.
- Install the clean packaged artifact without lifecycle-script assumptions.
- Record host version, generated type snapshot, Node/platform matrix, exact core version, test results, and known exclusions.
- Publish license, dependency notices, private security-reporting instructions, and a beta disclosure.

Mac ARM64 CLI is the first proposed qualification target, then Linux. Windows and Desktop must not be advertised before independent qualification. External user pilots follow technical qualification; CI volume is not adoption evidence.

## Sources

[Mod creation](https://code.claude.com/docs/en/plugins/mods/create), [events](https://code.claude.com/docs/en/plugins/mods/events), [reference](https://code.claude.com/docs/en/plugins/mods/reference), [public SDK types](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts), [loading](https://code.claude.com/docs/en/plugins/loading), [testing](https://code.claude.com/docs/en/plugins/mods/test), and [pinned Redact Secret source](https://github.com/redact-secret/redact-secret/tree/v0.1.0-beta.14).

Installed SDK behavior and release qualification take precedence over this provisional design.

