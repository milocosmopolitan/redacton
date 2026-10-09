# Agent Instructions for Redacton

Read this file explicitly before working on this repository. The filename is intentionally AGENT.md as requested by the project owner. Do not assume tools that auto-discover AGENTS.md will discover it. A future scaffold may add a small AGENTS.md pointer if needed.

## Context

Redacton is a local credential-protection Claude Code Mod using Redact Secret. TypeScript source is split between the host Mod and a separate prebuilt Node helper. README.md and ARCHITECTURE.md describe current behavior; docs/COMPATIBILITY.md links immutable published evidence and distinguishes it from current-source validation.

Primary commands are exactly `/redacton` and `/redactoff`. New sessions request ON; OFF produces an immediate warning and a persistent visible warning. OFF bypasses scanning. No observation mode is supported.

## Before editing

1. Read README.md, ARCHITECTURE.md, CONTRIBUTING.md, and the relevant issue.
2. Inspect existing implementation and installed generated SDK types.
3. Distinguish confirmed host behavior from assumptions.
4. Keep scope aligned with the implementation epic and its dependency order.

If the host cannot reliably replace or withhold selected content, document the blocker before broadening the feature or making protection claims.

## Architecture rules

- No Node, WebAssembly, scanner import, or dynamic import inside Mod hooks.
- SDK calls stay in the registration module; imported helpers are pure and receive data only.
- A separate Node helper uses the pinned Redact Secret package.
- Sensitive input goes through process stdin, not argv, env, shell text, or temporary input files.
- Use argv arrays and supported SDK process options.
- Batch segments per event; no speculative daemon, hand-written detector regexes, manual range rewriting, or streaming-chunk stitching.
- Verify exact core APIs and fallback behavior from the pinned source.
- Bundle helper output and keep exact pins plus npm lockfile. Do not assume lifecycle scripts run.
- Keep artifacts and imports inside the plugin root.

## Non-negotiable behavior

- Separate requested ON from readiness. Unavailable protection must not look ready.
- Snapshot state at operation start; toggles affect subsequent operations.
- OFF dispatches no scanner/helper calls.
- Under ON, selected content is withheld on unknown shapes, unavailable helper, invalid responses, timeout, truncation, limits, and policy failure.
- Rebuild allowlisted result envelopes. Strip raw aliases and original-content references.
- Never return cached original content from post-execution catch handlers.
- Preserve permissions and execute a tool at most once.
- Do not rewrite tool arguments or authentication parameters.
- UI and diagnostics use fixed error codes, canonical types, counts, and opaque identifiers.
- No input previews, secret hashes, raw paths, arbitrary exception text, or raw stderr in diagnostics.
- No live credential verification, telemetry, vault/restore, or PII features in the supported scope.

## Verification

Use synthetic fixtures. Run meaningful tests appropriate to the change, and report what could not run.

Helper tests do not prove host interception. Qualification must separately inspect model payload, transcript/storage, and UI paths. Test failure fallbacks, aliases, both toggle-race directions, cancellation, session isolation, permission denial, and clean artifact installation.

Record actual Claude Code, SDK, Node, platform, and engine versions. Do not claim production readiness, Desktop support, all-tool coverage, or absence of plaintext persistence without corresponding evidence.

Do not copy real secrets into fixtures, commits, screenshots, issue bodies, logs, or PR descriptions.

## Documentation and repository actions

Mark planned and implemented behavior accurately. Keep ON/OFF wording consistent. Never fabricate test results, adoption, benchmarks, supported platforms, or API fields.

Do not push changes, publish releases, or send third-party outreach without authorization. Repository issue creation is authorized for the initial epic/backlog task; it does not authorize unrelated communications.

Use concise PR descriptions that state the user-visible result, relevant validation, and material limitations. Configure license and private security/conduct-reporting channels before release.

## Sources

Use the official Claude Mod documentation and the installed generated SDK types. Prefer pinned Redact Secret source to undocumented API assumptions. See ARCHITECTURE.md for reference links.

