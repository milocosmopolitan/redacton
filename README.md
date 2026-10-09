# Redacton

Experimental local credential protection for Claude Code. `/redacton` requests protection; `/redactoff` bypasses scanning for new operations in the current session. New, resumed, and branched CLI sessions request ON.

**Alpha 1 protects only qualified textual prompt fields, Read text, and Bash stdout/stderr under the tested host conditions. It is not production-ready and does not prevent Claude Code from storing original prompts or tool arguments.** The host can bypass every plugin guard if the host/runtime or all guards fail. The layered guard handles tested inner-hook/catch failures; it cannot replace a host-enforced fail-closed primitive.

## Evaluate locally

The first host qualification target is **Claude Code 2.1.294, macOS ARM64, Node 22.16.0**. Node 24.21.0 helper/state/protocol tests are separately recorded; that does not qualify a Node 24 host installation. Linux, Windows, Desktop, other host versions, and other architectures are not advertised as supported.

From source:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:mod
npm run validate
node scripts/verify-artifact.mjs
claude --plugin-dir ./artifacts/redacton-alpha-1
```

The generated `artifacts/redacton-alpha-1-evaluation.tar.gz` contains a prebuilt helper and pinned dependencies inside the plugin root. Extract it and load the resulting directory with `--plugin-dir`. Verify the download against its accompanying `SHA256SUMS`. No postinstall compilation or external symlink is required. A local evaluation build is not a published qualified release; see [compatibility evidence](qualification/INTEGRATION_REPORT.md) for the actual qualification status and outstanding gates.

## Controls and coverage

`/redacton` immediately requests ON and distinguishes loading, unavailable, and ready. Selected content is withheld when protection cannot validate it. Readiness describes the local scanner, not an unconditional security guarantee. Running operations retain the ON/OFF state captured at their start; toggles affect subsequent operations.

`/redactoff` makes subsequent operations bypass the helper and immediately displays:

> Warning: Redacton is OFF. Credentials may reach Claude unchanged.

The prompt-area indicator while OFF is:

> ⚠ Redacton OFF — credential protection disabled

There is no global persistent OFF preference. Commands take no arguments. Actual resumed/branched CLI sessions request ON; the first protected prompt rechecks readiness. Fresh module registration/session.start requests ON, with SDK regression coverage. Editing the module during the evaluated print-stream process did not reload it: its existing OFF state remained OFF. Interactive watch/reload is not qualified. In-process clear/resume reset is SDK-tested.

The normal terminal warning was observed before and after typing, cleared on ON, restored on repeated OFF, and remained after an actual core Bash call while OFF. This was Claude Code 2.1.294 at 40×140 terminal cells; [UI evidence](qualification/ui-report.md) keeps normal and screen-reader results separate.

Recognized credentials are redacted through `@redact-secret/core@0.1.0-beta.14`; recognized private-key content blocks the entire selected event. Zero findings means **no recognized findings**, not safe input. Unknown selected envelopes, unsupported attachments, nonempty tool context, populated persisted/background/image output fields, invalid helper replies, limits, and helper failures withhold selected content.

MCP, PII, vault/restore, binary/audio/image input, other tools, tool-argument rewriting, authentication parameters, and old history are outside coverage. Withholding a tool result does not undo execution or previously recorded host content. Original permission decisions are preserved and tools are not retried.

## Evidence and limits

[Compatibility](qualification/INTEGRATION_REPORT.md), [layered failure reproduction](qualification/layered-spike/REPORT.md), [helper budgets](qualification/budgets.md), and [synthetic detection assessment](qualification/quality-report.md) report separate measurements. Model payload, UI, and transcript/storage are separate channels. Passing unit tests alone does not prove host interception.

[Actual session and interruption evidence](qualification/SESSION_REPORT.md) verifies resumed/branched ON defaults, same-process OFF helper bypass, and SIGINT before/after helper dispatch. A delayed child was gone after 2,200 ms; immediate termination and a live terminal Esc gesture are not claimed. [Acceptance accounting](qualification/ACCEPTANCE.md) identifies closure conditions and remaining release/pilot steps.

The 29-case synthetic assessment contains a base64 credential miss. It is a small maintainer-curated corpus with six public held-out cases, not independent production-accuracy evidence. The initial single-layer failure remains recorded in [the original spike](qualification/host-spike/REPORT.md).

Configured bounds: **262,144 UTF-8 input bytes, 256 segments, 1,000 findings, 2,097,152 response bytes, four pending protected helper calls, and 2,000 ms including helper startup**. Cancellation discards returned content; the installed SDK has no helper AbortSignal option, so a dispatched child may live until its bounded deadline. The host process API inherits its environment; no clean-child-environment or secure-memory-erasure guarantee is made.

No detector network calls, live credential validation, telemetry, or automatic feedback collection are added. Host collection, telemetry, and persistence are separate and not disabled by Redacton. See [the threat model](docs/THREAT_MODEL.md).

## Reporting, license, and development

Use [GitHub private vulnerability reporting](https://github.com/milocosmopolitan/redacton/security/advisories/new), verified enabled, and follow [SECURITY.md](SECURITY.md). Report conduct concerns through the existing maintainer email in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Public issues are not confidential.

Redacton uses [MIT](LICENSE); pinned dependencies and derived canonical-type data are covered by [third-party notices](THIRD_PARTY_NOTICES.md). Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENT.md](AGENT.md), and [ARCHITECTURE.md](ARCHITECTURE.md). The singular instruction filename is intentional and explicitly linked by CLAUDE.md.

[Execution gates](qualification/EXECUTION.md) describe dependency order and PR batching. [Independent pilots](qualification/PILOT_PLAN.md) require three real installations and seven-day follow-up. No agents, downloads, or maintainer demonstrations count as adoption evidence.

