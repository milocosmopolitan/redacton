# Epic #57 remediation review

This review distinguishes implemented code, executed synthetic runtime probes and
unsupported boundaries. Static inspection alone is not a security certification.
Historical releases and their evidence are unchanged. No release is published by
this work; the PR's final clean source/archive identities accompany its results.

## Priority recovery and availability

#58 restores failed personal settings through one explicit `/redacton` attempt in
the same session. Coalesced retries, OFF/reset generation invalidation and exact
revision/rule preservation have deterministic SDK regressions. Actual 2.1.295
sessions reproduced first-load busy, real timeout and nonzero exit, then real
engine recovery with no management or refused-event model request.

#59 separates validated event refusals from systemic scanner failure. Actual
finding-limit injection and oversized prompts preserved ready health for a later
small custom-rule event. A real scanner timeout required explicit self-check
before delivery. Concurrency tests prevent late success/failure from clearing or
poisoning a different generation/revision. Malformed/truncated helper replies,
limits and engine/config failures retain complete withholding, never raw fallback.

#60 compares installed SDKs and actual synthetic Bash shapes for 2.1.294,
2.1.295 and candidate 2.1.296. Both proposed aliases are declared but absent in
the observed small foreground results; the hypothesized 2.1.295 regression was
not reproduced. Known undefined data properties are stripped, while populated
paths/structured aliases, symbols, accessors and unknown keys remain withheld.
[Bash observations](BASH-HOSTS.md) give the exact version scope and reproduction.

## Host activation, authority and coverage

#61 distinguishes installed files, helper readiness, active interception and
qualified support. Markdown fallback stubs explicitly say protection is inactive.
Official Cowork plugin capability and the local Desktop UI were inspected, but
Cowork Mod activation was not available: NO-GO, not implemented support.
[Host authority](HOST-AUTHORITY.md) records the unknown runtime/path/loading
requirements and dependencies on #27/#47/#50. This is an explicit unsupported
outcome permitted by the issue, not universal evidence that Cowork cannot work.

#62 restricts disable/configuration entry to host-stamped composer origin. Actual
SDK/plugin/nested-command/provenance-forgery refusals and forced model Skill
attempts preserve local authority. Actual terminal OFF at 140 and 80 columns
shows immediate and persistent warnings through typing and Bash; ON clears the
warning. Management and terminal probe paths make zero model requests; each
synthetic model Skill negative control necessarily makes two loopback requests.
Print/stream refusal is no longer counted as a user's successful OFF action.
Local UI Apply/import/save still require explicit reviewed actions; arbitrary
host plugins and same-user OS/file changes remain outside this authority claim.

#66's actual 2.1.295 audit demonstrates Grep text, Glob paths and MCP results
reaching the loopback model, and Write's credential-shaped content reaching a
local file. These routes remain unprotected. The refused WebFetch fixture made
zero GETs and does not qualify successful page delivery. Existing #42/#51 retain
adapter ownership; [coverage](COVERAGE.md), README, status and config state the
specific exclusions and encoded/base64 miss. No blanket tool expansion was made.

## Budgets, storage and environment

#63 separates process startup, module/native/WASM initialization, first/warm
scan, settings ownership/lock refusal and complete helper event timings. Local
Node 22.16.0/24.21.0 native and forced-WASM runs and bounded CPU competition had
zero local failures. Actual Windows CI subsequently failed cold ownership probes
at 1,052/1,076 ms and 1,557 ms despite later warmed tests passing. Scans/self-checks
retain 2,000 ms and four pending calls; settings/transfer operations have a finite
5,000 ms parent/helper budget with a 3,000 ms ownership-probe phase. Stdin parsing
remains 2,000 ms and only complete validated settings requests extend the helper's
absolute deadline. Existing Windows CI measures first full save before storage
tests, retaining numeric cold-event results and failures. No prewarm-only gate,
daemon, implicit retries or live-owner bypass is introduced. Existing Linux Node 22/24 and Windows
Node 22 PR jobs retain new bounded measurement reports. [Budgets](BUDGETS.md)
state provenance, uncontrolled cold disk cache and unmeasured WSL/host cases. The existing Linux Node 22 job additionally schedules its benchmark and finite competitor on one verified allowed logical CPU in the GitHub VM, retaining a second report without adding a job. This is process contention, not a machine-wide CPU quota; local macOS results do not prove that Linux CI row.

#64 binds leases/recovery claims to host/PID namespace, observed process start
and nonce, retaining atomic CAS and revalidation. Regressions cover PID reuse,
live/dead writer, EPERM, foreign ownership, crashed claimant and concurrent
reclaim. Review found and fixed macOS timezone-dependent start observations by
pinning UTC. Legacy/indeterminate ownership stays busy; an explicit new private
scope with reviewed rules preserves the uncertain old root. Shared/network roots,
Windows ACL assumptions and second-level macOS precision remain documented.

#65 clears inherited Node startup options/search overrides at all helper launches
and in the PowerShell installer, which restores caller values. An actual 2.1.295
probe confirms `env` overlays inherited values, verifies synthetic preload
neutralization, and reaches real settings/scanner readiness. PATH, other inherited
values and OS-loader behavior remain residual boundaries. Linux now checks
procfs PID visibility before process-start identity; missing/mismatched namespace
metadata refuses writes rather than inventing ownership. No environment dump,
credential probing or global execution-policy change was introduced.

## Omitted files and exact-artifact gate (#67)

Inspected `scripts/install.ps1`, Mod configuration/settings/form/view/storage,
helper configuration/rules/core/storage, `release-gate.yml`, qualification/manual
provenance validators and host harnesses. Privileged persistence stays outside
pure Mod controllers; immutable snapshots and shared schema remain intact. The
installer checks archive/file identity before helper readiness and activation,
uses fixed diagnostics, and preserves rollback. Real Windows execution belongs
to CI, not local macOS evidence.

Release records still require canonical successful exact-source runs, reviewed
actor/run attempt, matching archive digest, every advertised row/gate, and exact
engine/Node/SDK identities. Missing, skipped, partial, stale or foreign evidence
cannot turn into support. CI package/benchmark success is separate from actual
platform interception and does not qualify Cowork. Expensive full native/manual
matrices were not duplicated; the consolidated PR reuses existing checks.

Executed unit/helper, SDK, type/lint, installer, decision and clean native/WASM
artifact checks. Actual synthetic prompt/Read/Bash/permission probes cover the
three evaluated CLI versions. Fault probes cover malformed/truncated/missing
responses and timeout; layered guard probes include guarded catch failure and
an unguarded negative control that deliberately reproduces raw fallback. Recovery,
authority and environment probes retain only fixed codes/counts/booleans and
source/engine/runtime identities. Final packaged reruns and CI outcomes are
recorded in the PR with the exact clean archive identity.

Original host prompt/tool arguments can persist; withholding cannot undo tool
effects. The host can bypass every guard, and absence of findings does not prove
safe content. Transcript secrecy, encoded detection completeness, independent
accuracy/adoption, all-tool protection, Desktop/Cowork and untested platform/UI
paths are not certified by this review. Existing platform and adapter follow-ups
remain owners of those boundaries; no release gate is weakened to close this epic.
