# Redacton

A local credential-protection Mod for Claude Code, powered by Redact Secret.

**Status: design and implementation backlog, October 9, 2026.** The repository is empty at this assessment. The behavior below is the proposed Alpha 1 contract, not a claim that the Mod already works. No supported Claude Code version or production-readiness claim exists yet.

Redacton aims to redact recognized credentials from supported prompt text and tool results before those values enter Claude's model context. It is a runtime integration, rather than a Git-history scanner.

## User controls

| Command | Behavior |
| --- | --- |
| `/redacton` | Requests protection for new operations; reports readiness or an unavailable state. |
| `/redactoff` | Disables protection for new operations in the current session and immediately warns the user. |

New, restored, and branched sessions start with protection requested ON. There is no global persistent OFF preference in Alpha 1. Repeating either command is safe.

When OFF, display a persistent warning near the prompt:

> ⚠ Redacton OFF — credential protection disabled

On disabling, also display:

> Warning: Redacton is OFF. Credentials may reach Claude unchanged.

OFF bypasses scanning and does not dispatch the local helper. Commands do not retroactively clean conversation history. A running operation retains the state captured when it started.

Requested ON and ready are different states. If the scanner cannot start or validate a result, supported protected content must be withheld with a safe error; the UI must not report protection ready.

## Initial coverage

Alpha 1 targets:

- Text in `prompt.submit` and supported textual prompt context.
- Supported textual `Read` results.
- Supported `Bash` stdout and stderr.

The compatibility spike must establish the exact event and result schemas on the installed Claude Code version. MCP results are a later milestone. Tool arguments, authentication parameters, images, audio, binary data, and previously stored history are outside Alpha 1. The UI must visibly identify partial coverage.

A successful scan only means no recognized credential finding under the pinned policy. It is not proof that text is safe. Redacton must not claim that host transcripts or local storage never contain original content: those paths require separate verification.

## Architecture

A thin Claude Mod handles events, commands, state, and UI. A separate local Node helper uses the pinned Redact Secret JavaScript package.

The Mod runtime does not provide Node or WebAssembly. It must not directly import the scanner. The helper receives text through process stdin, never command arguments, environment variables, or temporary input files. Each selected event uses one helper process and batches its text segments.

The initial planned engine is `@redact-secret/core@0.1.0-beta.14`. Its normal initialization uses the package's supported native loading and WASM fallback behavior. Exact dependency and lockfile qualification are required before shipping.

See [ARCHITECTURE.md](ARCHITECTURE.md) for state transitions, boundaries, protocol, and failure handling.

## Evaluation and development

There is no installable release yet. The first implementation must provide a plugin manifest, Mod entry point, bundled helper, package-lock.json, and reproducible build.

The intended contributor workflow after that scaffold exists is:

```sh
npm ci
npm run build
npm test
```

Use the installed Claude Code documentation for strict plugin validation, Mod tests, and local plugin loading. CI must record the exact host version and generated SDK types used. Passing helper unit tests does not establish that a host hook prevents content from reaching the model.

A release needs an actual Claude Code qualification run proving supported prompt/tool behavior, ON/OFF warnings, model-payload redaction, and safe failure paths. Desktop support requires its own process-execution and UI validation; it is not implied by CLI support.

## Privacy and security

- Scanning is local; Redacton does not make detector network calls or send telemetry.
- UI and diagnostics contain fixed error codes, canonical detector types, and counts—not matched text, paths, snippets, diffs, or secret hashes.
- Plaintext necessarily exists temporarily in host and helper memory. No secure-memory-erasure guarantee is made.
- Protected operations must not pass original content after scanner failures.
- A post-execution tool-result block cannot undo a tool's side effects.
- No credential validation against live providers is performed.

A private security-reporting channel must be configured and documented before public release. Until then, contact the [maintainer](https://github.com/milocosmopolitan) to arrange a private channel without posting sensitive details publicly.

## Contributing and conduct

Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [AGENT.md](AGENT.md). Use synthetic credentials in examples and tests.

The repository does not currently declare a license. Establish LICENSE and dependency-notice requirements before distribution; do not infer redistribution rights from this design.

## References

- [Claude Mod creation](https://code.claude.com/docs/en/plugins/mods/create)
- [Mod events](https://code.claude.com/docs/en/plugins/mods/events)
- [Mod reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Plugin loading](https://code.claude.com/docs/en/plugins/loading)
- [Mod testing](https://code.claude.com/docs/en/plugins/mods/test)
- [Redact Secret pinned source](https://github.com/redact-secret/redact-secret/tree/v0.1.0-beta.14)

