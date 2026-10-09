# Contributing to Redacton

Redacton is an experimental Claude Code Mod under host qualification. Start with [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), and the [compatibility evidence](qualification/INTEGRATION_REPORT.md). Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Choose work

Use the Alpha 1 epic and its child issues. Begin with the host compatibility spike: interception and safe failure behavior are prerequisites for the product's promise. Avoid adding detector families, an MCP server, a gateway, or vault features before the initial boundary works.

For a new change, describe the user problem, covered input surface, expected behavior, and the evidence needed to validate it. Link the relevant issue and disclose any host-version assumptions.

## Development baseline

The scaffold provides npm scripts and repository paths. The contributor workflow is:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:mod
npm run validate
node scripts/verify-artifact.mjs
```

Use the installed Claude Code tooling for strict plugin validation and Mod tests. Record the host version and generated SDK type version with results. Keep exact dependency pins and package-lock.json current.

The hook runtime has no Node or WebAssembly. Keep scanning in the separate Node helper. Imported adapters must be pure and must not receive SDK capabilities. Bundle helper output; do not require host lifecycle scripts to compile it.

## Security invariants

- New sessions request protection ON. OFF applies only to the current session and requires a visible warning.
- Capture ON/OFF once per operation. Do not reinterpret running operations after a toggle.
- OFF makes no helper calls.
- Scanner failure under ON withholds selected content; never fall back to raw text.
- Do not bypass permissions, retry executed tools, or rewrite authentication/tool arguments.
- Rebuild result envelopes from an allowlist; remove raw aliases and original references.
- Send sensitive input only through helper stdin.
- Use fixed diagnostic codes and safe counts. Never log real or synthetic matched plaintext as a habit.
- Detector semantics remain in Redact Secret; adapter regexes and manual range edits are out of scope.

## Testing

Use synthetic credentials and stable fixture markers. Never use live credentials, provider-validation calls, personal customer data, or production transcripts.

Test the behavior a user depends on:

- ON replacement and OFF bypass for supported prompts and tool results.
- Actual model payload and its references, independently from UI/transcript rendering.
- Unknown envelopes, process failure, timeout, output truncation, invalid JSON, and limits.
- Idempotent commands, persistent warning, session isolation, toggle races, cancellation, and permission denial.
- Clean installation of the packaged plugin, including native/WASM fallback behavior.

Pure helper tests and host qualification are separate. If a host test cannot run, say so in the PR; do not label the boundary verified. Reversible documentation edits do not require new implementation-mirroring tests.

## Pull requests

Keep changes focused. Include:

1. The concrete problem and resulting behavior.
2. Related issue and covered/excluded surfaces.
3. Relevant validation, exact versions, and unresolved limitations.
4. Changes to privacy, failure handling, resource budgets, or packaging.

Update docs when coverage or behavior changes. Never replace a planned capability with an implemented claim solely because code was added.

## Releases

A release requires the architecture's qualification gates, a license and notices, and a private security-reporting channel. Publish compatibility evidence and exclusions with the artifact. Desktop and additional operating systems require separate evidence.

## Sensitive reports

Do not publish secrets or exploit details in ordinary issues. Use the enabled [GitHub private vulnerability reporting channel](https://github.com/milocosmopolitan/redacton/security/advisories/new) and follow [SECURITY.md](SECURITY.md). Conduct concerns use the maintainer email route in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), with independent-review handling described there.

