# CI and qualification

CI passing proves its recorded checks, not host interception, detection accuracy, or production readiness. The published 0.1.0 evidence remains immutable. Candidate source is not qualified merely because it builds.

## Fast pull requests

`Checks / required` is the always-present aggregate status for branch protection. Do not require conditional matrix jobs individually. PRs run once, with no duplicate branch-push pipeline. Superseded PR runs are cancelled. Default permissions are `contents: read`; there is no `pull_request_target`, personal credential, trusted self-hosted runner, or paid model endpoint.

Code changes run Linux pure checks on exact Node **22.16.0** and **24.21.0**, with npm **10.9.2** and `npm ci --ignore-scripts`. The explicit npm cache key includes OS, architecture, exact Node version and lockfile; it stores downloaded packages, not generated outputs. Pure types cover helper/schema/controllers/protocol/state. SDK-bound adapters are exercised by pure runtime tests, and their type safety is checked separately by the SDK job.

The Linux Node 22 SDK job downloads official Claude **2.1.294**, verifies repository-pinned SHA-256 and byte length before execution, verifies its reported version, then generates SDK declarations, typechecks registration/adapters, runs Mod tests and strict plugin validation. The reviewed checksum source is the [official immutable-version manifest](https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.294/manifest.json). CLI redistribution/licensing and runner availability remain upstream constraints. Download or SDK-generation failure fails the distinct gate. No credentials are assumed; local commands use an isolated config and disabled loopback endpoint.

Portable runtime, packaging, installer, workflow, README and compatibility changes additionally run Linux x64 and Windows x64 Node 22 package smoke checks. Pure documentation changes skip conditional jobs while the aggregate still completes. `npm test` covers the fast pure/helper regressions; the slower installer suite lives under `tests/installers/` and runs through `npm run test:installer` only in package and full native jobs. Installer and archive regression-only changes also trigger those package rows, so moving the suite removes duplication without dropping its required checks. The existing Windows Node 22 package row also runs the pure storage/guard suite before building, catching OS/runtime filesystem regressions without adding a job or download. Each package row builds once, checks both archive formats, checks its actual installed native engine, exercises the packaged public WASM fallback, and runs synthetic installer fixtures. Package artifacts are retained **3 days**. Logs contain ordinary test diagnostics and fixed version/status evidence; host raw transcripts are never uploaded.

## Costly native rows

`Qualification` can select `probe: config-races` for a targeted configuration diagnostic; every unrun gate stays blocked and cannot qualify a release. `Qualification` is manual, targets one row by default, and selects **22.16.0** or **24.21.0**. `all` covers macOS ARM64/x64, glibc Linux ARM64/x64, and Windows x64 on matching hosted runners. Native architecture is asserted; at most **2 rows** run concurrently, each with a **30-minute** timeout. Targets map `darwin` to macOS and `win32` to Windows in the platform matrix. WSL is not a qualification target and is never inferred from Windows or Ubuntu. Unavailable hosted runners block that row; emulation does not qualify it. Musl and Windows ARM64 have no claim.

The workflow builds one canonical archive on Linux Node 22, then every selected native row downloads and tests those exact bytes. Separate Node 22/24 runs use the same builder and require an identical digest. Each row runs deterministic checks, artifact/native/WASM verification, fresh/repeat actual-archive installer checks and pinned actual-host synthetic loopback probes. Unix cancellation process-group tests and Windows actual terminal Ctrl-C probes remain separate. Windows uses an owned ConPTY and job for terminal interaction and cleanup; terminating that job is never credited as user cancellation. Terminal UI runs at both declared sizes, and policy races require an observed state transition while a real Bash invocation is still held, followed by captured model-payload checks. Missing configuration or interactive evidence remains blocked. Headless probes never establish interactive terminal or Desktop behavior.

Configuration races use `/redactconfig` to open the existing panel while an actual Bash invocation is held. The probe requires validation, synthetic preview and explicit Apply before release. A companion delegates the real helper call unchanged and observes its captured revision/rule count: the held result must use the previous configuration, and the next Bash result the new one. Exactly two executions, two stdout sanitizations and four main requests are required; an extra helper rerun fails. Distinct synthetic tokens distinguish intentionally unprotected earlier history from the newly protected result, which must be absent from every main, auxiliary and token-counting request. A phase that is not observed never passes.

`scripts/qualify-host.mjs` refuses a dirty checkout, safely extracts the canonical artifact for product host probes and writes only bounded fixed gate/status/version fields, exact Git commit and actual archive digest. Fault-injection and layered-guard fixtures exercise deliberate regressions and are not the unmodified package. Subprocess stdout/stderr is discarded. Only `qualification/results/ci-evidence/*.json` is uploaded, for **14 days**; internal harness reports, payloads, storage and screenshots are excluded. A failed probe fails the job. A blocked unimplemented gate remains blocked in evidence even if available probes passed. Review synthetic evidence before treating it as a qualification record.

## Release gate

`Release qualification gate` runs on version tags and manually. A tag never publishes automatically. Manual execution downloads reviewed Node 22 and Node 24 qualification run artifacts from this repository. `npm run release:gate -- <evidence-directory>` rejects missing/failed/blocked gates, emulation, duplicate rows, unexpected fields, files over **4096 bytes**, wrong host/engine/version, stale commits and differing archive digests. It requires all **10 actual-host rows**, the native OS/architecture/Node rows. Automatic terminal/race probes supply only their observed results. Missing configuration, unavailable architecture or other blocked/failed gates still prevent release qualification. Desktop stays unqualified.

Before downloading, the gate checks both run IDs through the Actions API: successful manual `qualification.yml` executions in this repository at the exact checkout commit. Fork/PR evidence cannot qualify a release merely by claiming a commit in JSON. Tag execution without supplied exact-commit evidence fails closed. Existing releases are never rewritten. This gate validates eligibility; it does not upload or replace release assets. A future publishing step must consume the exact qualified archive, retain its checksums/notices durably and preserve each release's identities.

There is no expensive daily schedule or browser installation. Review Actions duration and billed runner minutes after the first PR and each full native run; avoid repeating passing rows unless source/artifact identity or affected protection boundaries change. Schema/helper/Mod changes invalidate relevant host evidence. Documentation alone requires host reruns only when changing a compatibility claim. Targeted reruns must retain exact source and artifact identities.

That documentation-only policy describes automatic PR execution. Rebuilding a release archive after any new commit changes its provenance; old exact-commit/archive evidence remains stale even if the change was only documentation.

Measured PR [run 37885273757](https://github.com/milocosmopolitan/redacton/actions/runs/37885273757): pure Node 22 **18 s**, pure Node 24 **14 s**, SDK **23 s**, Linux package **25 s**, Windows package **67 s** (failed). Changes-start to aggregate-end wall time was **81 s**; total job time was **155 s**, about **2.6 unweighted runner minutes**. These values exclude queue time, billing rounding and runner multipliers; they are not an invoice estimate. Full native-run measurements remain pending.

## Package, race and UI evidence

Choose `scope: package` to run the native package/installer matrix without downloading Claude or implying host qualification. Those records leave host gates blocked with `NOT_RUN`; the installer uses an explicitly disclosed existence-only Claude prerequisite fixture. Choose `scope: host` for pinned-host probes, persistent OFF/no-helper checks and actual terminal UI at 140×40 and 80×40 with hash-locked temporary Python dependencies, using Unix PTYs or the Windows ConPTY adapter. Interactive probes reuse one owned Python dependency directory per host run; missing Python/pip blocks those gates while independent probes continue.

For a failed UI or guarded-error probe, select `probe: terminal-ui` or `probe: guarded-errors` with one target and `scope: host`. Canonical package provenance and installer prerequisites still run; other host gates remain blocked with `NOT_RUN`, so diagnostic evidence cannot qualify a release. Diagnostics whitelist UI stages, focused button, receipts and action counts, or fault modes and bounded boundary counters. Raw screens, payloads and stderr remain excluded. The default `probe: all` preserves full qualification checks.

Historical [Linux Node 22 UI run 37927184889](https://github.com/milocosmopolitan/redacton/actions/runs/37927184889), source `81cd12b`, failed the 140×40 OFF form. An overly broad startup-dialog detector sent onboarding keys inside the settings form. After restricting those keys to exact startup dialogs, [run 37937422236](https://github.com/milocosmopolitan/redacton/actions/runs/37937422236), source `041682b`, passed both widths. This targeted result does not qualify unrelated gates or newer source. [Windows Node 24 fault run 37926248793](https://github.com/milocosmopolitan/redacton/actions/runs/37926248793) passed all eleven synthetic fault modes after replacing shell-relative counter writes with a test-owned Node fixture.

UI bootstrap reports the observer and ConPTY tests independently. The observer reads its Python source explicitly as UTF-8. Native ConPTY checks actual stdin/stdout/stderr TTY state, captured synthetic stderr, exact empty/JSON/space arguments, dimensions, input acknowledgment and descendant cleanup. A failed startup drains at most two seconds of final output for fixed-category diagnostics; that drain never supplies qualification credit. Only finite phase/exception categories, booleans and bounded counts leave these probes.

Strict `gateCodes` distinguish pass, unavailable/manual/platform prerequisites and failed/timeout/process outcomes. Explicit race/UI probes may use exit 2 for an unavailable capability. The terminal race probe holds an actual Bash execution behind a release file and requires the unique AbovePrompt policy label to change before release/model delivery. Auxiliary title requests cannot count as tool execution; protected operation markers must be absent from every captured loopback request. A queued or unobserved transition leaves `RACE_PHASE_UNAVAILABLE` blocked, rather than crediting a subsequent toggle as a race.

## Reviewed external manual evidence

`Reviewed manual qualification evidence` accepts only a maintainer-dispatched bounded JSON attestation: authenticated `admin` permission or `maintain` role, `reviewed: true`, exact source commit, exact canonical archive digest and successful base Node 22/24 host run IDs. It reads the attestation from the Actions event file so unvalidated text is not echoed in step environment diagnostics. Never submit raw payloads, transcripts, screenshots, paths or credentials through this input. The workflow stores only whitelisted outcome records and a separate immutable review manifest binding actor, review run/attempt, base run IDs, validated attestation digest and gate names.

The shape is `{ "schemaVersion": 1, "reviewed": true, "sourceSha": "<exact 40 hex commit>", "artifactSha256": "<exact 64 hex digest>", "rows": [{ "platform": "win32", "arch": "x64", "node": "v22.16.0", "gates": { "terminal-ui": "passed" } }] }`. Only blocked terminal UI, configuration/toggle races and Windows cancellation gates may be filled after an actual observed manual regression. An automated failure cannot be overridden, and automated SDK/package/model-payload passes cannot be invented. Owner review is an explicit trust boundary, not additional automated proof.

The WSL2 qualification harness was removed: WSL is not a qualification target and `externalRows` attestations no longer exist. Hosted WSL2 boot and Node 22/24 installation once passed in [run 37938613891](https://github.com/milocosmopolitan/redacton/actions/runs/37938613891); that installation evidence never established protection. No trusted self-hosted runners are configured.

The release workflow's optional `manual_run` accepts only a successful exact-commit `manual-evidence.yml` run. It verifies the review manifest against the actual run actor/attempt, exact base run IDs and canonical digest before downloading merged records. Manual review does not qualify Desktop; every target row and gate must still pass for release eligibility.


## CLI licensing and authentication boundary

The CI runner downloads the pinned, unmodified official Claude binary only into a temporary directory. It never includes that binary in the plugin archives or uploaded qualification records. Claude use is governed by the applicable [Anthropic commercial or consumer terms](https://code.claude.com/docs/en/legal-and-compliance); downloading a checksum-pinned binary is an integrity check, not a grant of additional rights. Upstream licensing, download availability or authentication changes can block SDK/host checks and must be reviewed before updating the pin.

These regression probes isolate configuration and use synthetic inputs plus a local model endpoint. They require no personal OAuth token or paid Anthropic model call. This does not establish credential-free production use. End users authenticate their own normal Claude installation under their applicable terms; the plugin does not collect credentials or intermediate billing. The [commercial terms](https://www.anthropic.com/legal/commercial-terms) and official CLI guidance remain the upstream authority.

## Approved release records and tags

A successful manual `Release qualification gate` verifies both exact-source native runs, any reviewed manual overlay, every advertised row and gate, and both portable archives. Only then does it prepare `approved-release-records`: the exact tar/ZIP/checksums, ten bounded row records, optional bounded manual-review provenance, and a digest manifest binding source, package version, gate actor, run ID and run attempt. SDK, engine, Node and platform identities remain in those digest-bound row records; license/provenance notices remain in the checked archives.

The `v<package-version>` tag job discovers an exact-commit successful **manual release-gate workflow** in the canonical repository, verifies that run again against the downloaded manifest, checks every listed file digest, and reruns the complete qualification and archive checks. A successful unrelated workflow, fork, stale commit, failed run, altered attempt, partial diagnostic record or merely named artifact cannot supply approval. If the reviewed record has expired after **14 days**, re-run the manual gate with available exact-source evidence before tagging. This prepares a durable record bundle for a future authorized publisher to attach unchanged to the matching release; these workflows do not publish a release or imply that a currently blocked row passed.

## Current remediation measurements and authority gates

The existing PR Linux pure Node 22/24 jobs and Windows Node 22 package job also
run bounded startup/scan/settings measurements. Their small numeric JSON reports
have three-day retention; no new job, daily schedule, paid model endpoint or
machine-specific latency threshold is introduced. Failed bounded operations fail
the measurement step. An unavailable native addon is explicit while forced WASM
still runs. See [measurement method and local observations](BUDGETS.md).

SDK and stream-origin disable attempts now test refusal with protection retained.
They cannot stand in for a local user's OFF action. The actual-host OFF gate also
requires terminal composer execution and immediate/persistent warnings at both
140 and 80 columns, using the existing isolated Python dependencies. A missing
terminal prerequisite stays blocked. Historical records stay pinned to their
original source/host/artifact; print-mode denial does not retroactively replace
old OFF/no-helper evidence or qualify a new platform.
