# Compatibility and evidence

The [historical package](https://github.com/milocosmopolitan/redacton/releases/tag/v0.1.0-alpha.1) preserves the evaluated artifact and complete evidence. Current source can change independently; historical results do not automatically qualify a refactored binary. Reusable host regressions remain in `qualification/` and current validation commands are in [CONTRIBUTING](../CONTRIBUTING.md).

## Current terminal configuration

Version 0.1.0 targets Claude Code/generated SDK **2.1.294**, **macOS ARM64** and **Node 22.16.0**. Node 24.21.0 separately passed the same 59 unit/helper tests; the actual host and installer remain qualified only on Node 22.16.0. Independent checks passed TypeScript, Biome on 52 files, 59 Node unit/helper tests, 35 SDK tests, decision validation and packaged clean-install/native/WASM/configuration-v2/strict-host verification. These checks qualify those tested boundaries, not every host or platform.

Required cross-platform follow-on work (#29–38) targets macOS ARM64/x64, Linux x64/ARM64 and Windows x64/WSL. Only the Apple Silicon CLI combination above has current host/installer evidence. The other targets and Desktop remain unqualified; platform support is required follow-on work, not an optional release claim.

The [reproducible platform matrix](PLATFORMS.md) records the exact engine declarations, conservative Node floors, Linux glibc baseline, native Windows versus WSL identities, and remaining host gates. Current source builds a portable WASM candidate using the public automatic fallback, while the installer defaults and existing release assets retain their historical macOS scope. Candidate package checks, SDK checks and actual-host results are separate evidence; see [CI policy](CI.md). No supported Claude version range or universal platform claim follows from these changes.

Namespaced command interception, four-command autocomplete and local form input have terminal fixture evidence. Cached status dispatches no helper; SDK regressions cover immutable configuration races, restoration, corruption, panel-open composer withholding and stale form receipts. The immutable packaged 140×40 and 80×40 terminal workflows passed focused add, core validation, visibly displayed synthetic redact/nonmatch outcomes, explicit Apply feedback, actual custom Bash sanitization, removal, visible Revert feedback restoring one rule and Escape close. OFF warnings remained during typing and tool activity; OFF Validate rejected locally with helper calls unchanged at 10→10. Management model requests were zero. Four-command autocomplete was observed; all four commands appearing in `/help` remains unproven.

A synthetic local form marker was observed in zero persisted files in the scoped fixture; a slash-argument marker was observed in two host files. This establishes the need for argument-free management commands, not universal form-storage privacy. Desktop and independent custom-rule usability remain unqualified. See [configuration](CONFIGURATION.md).

## Host capability boundary

| Surface | Observed capability | Support |
| --- | --- | --- |
| Claude Code / generated SDK 2.1.294, macOS ARM64 | Actual local helper execution, command interception and terminal UI under scoped tests. | Qualified CLI boundary and 140×40 and 80×40 packaged workflows above. |
| Claude Desktop 2.26454.2, macOS ARM64 | Plugin upload and marketplace entries observed. Mod commands, forms and local-process execution were not verified; helper execution location is not established. | Unsupported. |

## Historical package scope

Claude Code/generated SDK 2.1.294, macOS ARM64, Node 22.16.0 host. Node 24.21.0 separately passed 25 helper/protocol/state/adapter tests, not a Node 24 host installation. Linux, Windows, Desktop, other hosts/architectures, interactive watch/reload, arbitrary scrolling, and every terminal size were not qualified.

Historical checks include actual prompt/Read/Bash model delivery, separate storage observations, clean native/WASM installation, 11 fault modes, automatic permission refusal without execution, both policy races, session isolation, resumed/branched ON defaults, and SIGINT before/after helper dispatch. Normal-terminal OFF warnings remained after typing and a core Bash completion at 40×140 cells; screen-reader next-prompt output was measured separately.

The print-stream source-edit probe did not reload the Mod: helper count remained one and the existing OFF state stayed OFF. Fresh registration/session-start resets ON in SDK tests. SIGINT issued no later model requests; a delayed child was gone after 2,200 ms. This does not establish interactive Esc behavior or immediate process termination.

## Limitations that travel with the claim

- The host can bypass every failing guard. Layered protection covers the tested failures under a functioning host and outer guard, not arbitrary host/all-guards failure.
- Original prompt queue rows and tool arguments can remain in host storage. Sanitized model payload does not imply sanitized history, UI, or earlier persistence.
- The 29-case synthetic corpus recorded TP 17, FN 1, FP 0, TN 11; the base64 case remained undetected. Six public maintainer-held-out cases and the corrected AWS fixture length are disclosed. This is not independent production-accuracy evidence.
- Tool arguments, authentication parameters, MCP, other tools, binary/audio/images, PII, vault/restore, and history cleanup are outside coverage. Blocking a tool result does not undo its effects.
- The process inherits the host environment and plaintext exists temporarily in memory. No clean environment or secure-erasure guarantee is made.

## Current package evidence

Version 0.1.0 release assets [QUALIFICATION.json](https://github.com/milocosmopolitan/redacton/releases/download/v0.1.0/QUALIFICATION.json) and [RELEASE_MANIFEST.json](https://github.com/milocosmopolitan/redacton/releases/download/v0.1.0/RELEASE_MANIFEST.json) record qualification outcomes and exact runtime fingerprints. The packaged workflow was tested by a maintainer using synthetic definitions, not independent participants. Existing-rule editing and shared names-action controls have unit/SDK coverage; no actual terminal workflow claim is made for those controls yet.

## Immutable evidence

[Integration and storage](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/INTEGRATION_REPORT.md), [packaged-host identity](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/packaged-host-report.md), [faults](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/failure-host-report.md), [sessions/cancellation/permissions](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/SESSION_REPORT.md), [terminal UI](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/ui-report.md), [resource measurements](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/budgets.md), and [quality/provenance](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/quality-report.md) retain exact versions, hashes, counters, reproduction code and exclusions.

The original [single-layer failure](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/host-spike/REPORT.md) and [layered follow-up](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/layered-spike/REPORT.md) remain available at the tag. Current design rationale is in [layered-guard decision](decisions/layered-trusted-results.md).

Independent adoption remains unmeasured. [Issue #28](https://github.com/milocosmopolitan/redacton/issues/28) tracks three independent installations and seven-day follow-up; agents, downloads and CI do not count.
