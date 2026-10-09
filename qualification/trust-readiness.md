# Trust and release readiness

Audit scope: issues [#11](https://github.com/milocosmopolitan/redacton/issues/11), [#12](https://github.com/milocosmopolitan/redacton/issues/12), and [#13](https://github.com/milocosmopolitan/redacton/issues/13). This is a read-only repository/settings assessment, not release qualification or pilot evidence.

## Integration follow-up

The initial gaps below are historical. Integration now adds [MIT licensing](../LICENSE), [exact dependency notices](../THIRD_PARTY_NOTICES.md), [the threat model](../docs/THREAT_MODEL.md), and a private email conduct route in [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md). The address was read from the maintainer's public GitHub profile and matches the repository author; no email was invented and no test report was sent. This verifies address provenance, not inbox delivery or a response guarantee. Private vulnerability reporting remains verified enabled. The [current compatibility evidence](INTEGRATION_REPORT.md) governs release readiness; [pilot evidence](PILOT_PLAN.md) remains uncollected.

## Historical baseline

- The GitHub repository is public. `GET /repos/milocosmopolitan/redacton` returned `license: null`; the community profile also returned no license. No local LICENSE was present at assessment.
- `GET /repos/milocosmopolitan/redacton/private-vulnerability-reporting` initially returned `{"enabled":false}`. The orchestrator subsequently enabled it under the user's authorization; this audit independently re-read the endpoint and verified `{"enabled":true}`. Repository secret scanning and push protection were also enabled, but these do not provide a reporting channel.
- README, SECURITY, CONTRIBUTING, and the security section of CODE_OF_CONDUCT now name the verified [GitHub private vulnerability reporting route](https://github.com/milocosmopolitan/redacton/security/advisories/new). A read-only HTTP request to this URL returned 200. The security-advisories API was readable and returned zero advisories; no report was submitted to test the route.
- CODE_OF_CONDUCT explicitly states that no private conduct channel is published. It prohibits retaliation and asks maintainers to avoid conflicts, but does not identify an independent reviewer or a working private review route.
- The pinned upstream [Redact Secret LICENSE](https://github.com/redact-secret/redact-secret/blob/v0.1.0-beta.14/LICENSE) is MIT, copyright 2026 Omiologic. Its notice must accompany copies or substantial portions. This does not select Redacton's own license or complete a dependency inventory.
- The [engine investigation](engine-research.md) verified the pinned manifest at `packages/javascript/package.json`. Dependency-license completeness still requires review of the final lockfile and packaged native/WASM assets.
- No installable release or host qualification is established by the baseline documentation. README, ARCHITECTURE, and CONTRIBUTING consistently describe proposed behavior.

## Initial issue #11 requirements, superseded by integration follow-up

Choose an explicit project license and correct copyright ownership before distribution. Include the pinned engine's license and review every bundled dependency, native artifact, and WASM fallback using the final lockfile and packaged artifact. A dependency's MIT license does not establish redistribution terms for Redacton's own work.

The private security-reporting setting is enabled and its GitHub URL is documented. A maintainer profile and public issues are not confidential reporting channels. Private conduct reporting remains a separate requirement.

Establish a verified private conduct route and describe how a report involving the maintainer reaches a reviewer without that conflict. Preserve the existing prohibition of retaliation. Do not invent an email address, confidentiality guarantee, response SLA, or alternate reviewer.

Document the threat model across host, Mod, helper, model payload, UI, and transcript/storage. In particular:

- Host collection or persistence can occur before a hook, and must be measured separately from model delivery.
- Plaintext temporarily exists in host/helper memory; there is no secure-erasure guarantee.
- Untrusted text must remain data sent through stdin. Tool arguments and authentication parameters remain unchanged.
- Default helper environment inheritance requires review against the installed process API. No credentials should be added to argv, shell text, environment, or temporary input files.
- A post-execution result block cannot undo tool side effects. Diagnostics must use fixed codes and safe metadata rather than raw process errors, paths, or input excerpts.
- Claims about local scanning do not establish that host telemetry, transcripts, or storage are local or sanitized.

These descriptions can be developed in parallel with implementation. License choice and a verified conduct route require factual owner input or an existing owner preference. The orchestrator changed the security setting; this audit only verified it and documented the route. No external contact was performed.

## Issue #12: release cannot precede evidence

Release depends on #9, #10, and #11. Record exact host/SDK, Node, platform, dependency, lockfile, and artifact identifiers. Separate evidence for model payload, transcript/storage, and UI. Include clean installation, strict validation, Mod tests, helper tests, failure qualification, readiness behavior, both commands, and persistent OFF-warning visibility.

Mac ARM64 CLI is the first qualification target. Linux, Node 22/24, Windows, and Desktop support require actual relevant matrix results; their mention in a design is not support evidence. State beta status, supported prompt/Read/Bash coverage, exclusions, known issues, and installation steps. Do not publish an alpha artifact merely because a preparation PR merged.

## Issue #13: pilots remain a separate evidence gate

Pilots depend on the qualified #12 release. Recruit at least three independent users only with authorized external outreach. Record installations, host/platform, time to first protected operation, comprehension, warning visibility, latency, disruption, and task completion using synthetic examples and consented safe feedback.

The acceptance criteria require repeat-use observations after seven days. Maintainer demonstrations, CI runs, downloads, or simulated users cannot satisfy this requirement. The proposed positive signal is at least two users keeping protection enabled and requesting a concrete continuing workflow. Record reasons for disabling/uninstalling and the MCP Beta 1 go/no-go decision. No pilot has been claimed or conducted here.

## Minimal-PR dependency plan

1. Merge compatibility evidence for #2 first. If reliable replacement/withholding cannot be proven, record the blocker and stop downstream protection/release claims rather than creating nominal completion PRs.
2. After a passing #2 gate, use one integration branch/PR for scaffold #3, then state/helper #4/#5 in parallel, then adapters/UI #6/#7/#8 in parallel. Run #10 assessment and #11 trust work alongside this integration. Perform #9 only against the combined behavior. Use separate issue-linked commits within this PR if useful; per-issue PRs add no necessary dependency isolation.
3. Prepare #12 evidence and release documentation only after #9/#10/#11 pass. Include preparation in the integration PR when all gates are satisfied, or use one final qualification PR if later evidence changes files. Publish a release only after the actual gates pass.
4. Keep #13 open until independent installations and seven-day follow-up occur. A pilot report can use a final documentation PR when real evidence exists; no empty pilot PR is needed.

Keep one active implementation worktree where possible and assign agents disjoint paths. Remove a worktree/branch only after its changes are merged or intentionally preserved. Avoid repeated CI dispatches during intermediate commits; run local checks and push a reviewable batch, respecting existing required checks.

## Instruction discrepancy

`AGENT.md` deliberately declares itself the canonical repository instruction file. `CLAUDE.md` initially imported absent `AGENTS.md`; this change repairs its pointer to `AGENT.md`. Automatic discovery by other agents still requires explicit reading of the singular file. The README's baseline date is October 9, 2026, while the session's local date is October 8; GitHub creation timestamps are already October 9 UTC. Preserve the stated baseline without treating it as a measured implementation date.
