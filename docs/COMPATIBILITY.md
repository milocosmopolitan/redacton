# Compatibility and evidence

The [published package](https://github.com/milocosmopolitan/redacton/releases/tag/v0.1.0-alpha.1) preserves the evaluated artifact and complete evidence. Current source can change independently; historical results do not automatically qualify a refactored binary. Reusable host regressions remain in `qualification/` and current validation commands are in [CONTRIBUTING](../CONTRIBUTING.md).

## Published package scope

Claude Code/generated SDK 2.1.294, macOS ARM64, Node 22.16.0 host. Node 24.21.0 separately passed 25 helper/protocol/state/adapter tests, not a Node 24 host installation. Linux, Windows, Desktop, other hosts/architectures, interactive watch/reload, arbitrary scrolling, and every terminal size were not qualified.

Historical checks include actual prompt/Read/Bash model delivery, separate storage observations, clean native/WASM installation, 11 fault modes, automatic permission refusal without execution, both policy races, session isolation, resumed/branched ON defaults, and SIGINT before/after helper dispatch. Normal-terminal OFF warnings remained after typing and a core Bash completion at 40×140 cells; screen-reader next-prompt output was measured separately.

The print-stream source-edit probe did not reload the Mod: helper count remained one and the existing OFF state stayed OFF. Fresh registration/session-start resets ON in SDK tests. SIGINT issued no later model requests; a delayed child was gone after 2,200 ms. This does not establish interactive Esc behavior or immediate process termination.

## Limitations that travel with the claim

- The host can bypass every failing guard. Layered protection covers the tested failures under a functioning host and outer guard, not arbitrary host/all-guards failure.
- Original prompt queue rows and tool arguments can remain in host storage. Sanitized model payload does not imply sanitized history, UI, or earlier persistence.
- The 29-case synthetic corpus recorded TP 17, FN 1, FP 0, TN 11; the base64 case remained undetected. Six public maintainer-held-out cases and the corrected AWS fixture length are disclosed. This is not independent production-accuracy evidence.
- Tool arguments, authentication parameters, MCP, other tools, binary/audio/images, PII, vault/restore, and history cleanup are outside coverage. Blocking a tool result does not undo its effects.
- The process inherits the host environment and plaintext exists temporarily in memory. No clean environment or secure-erasure guarantee is made.

## Immutable evidence

[Integration and storage](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/INTEGRATION_REPORT.md), [packaged-host identity](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/packaged-host-report.md), [faults](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/failure-host-report.md), [sessions/cancellation/permissions](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/SESSION_REPORT.md), [terminal UI](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/ui-report.md), [resource measurements](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/budgets.md), and [quality/provenance](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/quality-report.md) retain exact versions, hashes, counters, reproduction code and exclusions.

The original [single-layer failure](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/host-spike/REPORT.md) and [layered follow-up](https://github.com/milocosmopolitan/redacton/blob/v0.1.0-alpha.1/qualification/layered-spike/REPORT.md) remain available at the tag. Current design rationale is in [decision 0002](decisions/0002-layered-trusted-results.md).

Independent adoption remains unmeasured. [The pilot plan](../qualification/PILOT_PLAN.md) requires three actual independent installations and seven-day follow-up; agents, downloads and CI do not count.
