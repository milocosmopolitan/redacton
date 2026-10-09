# Claude Code host compatibility gate, issue #2

**NO-GO for the proposed fail-closed Alpha 1 on Claude Code 2.1.294.** A deliberately thrown post-execution catch handler caused the original synthetic Bash stdout to appear in the next actual model request. Stop downstream product implementation until the host boundary is redesigned or upstream behavior changes and is requalified. A safe catch handler works in the tested path, but it does not establish the mandatory failure guarantee.

## Environment and provenance

Evaluated October 8, 2026 on macOS Darwin 25.5.0 ARM64, Node v22.16.0, Claude Code 2.1.294. No separate SDK package was installed: the host generated its own early-access declarations by loading the qualification Mod. Files are ignored and regenerated on load to avoid committing a 784 KiB snapshot.

- `claude-code/index.d.ts` SHA-256: `3831d13d34fa0696302ae5d0cec4b989639c5f20dd59c229b94f2c58c7f1e819`
- `claude-code-tools/index.d.ts` SHA-256: `dd157a9142c017544271de6673d4bc38035fa354f2a718b3863d90fbf8359af9`
- Declaration first line: `Written by Claude Code 2.1.294.`

Official references: [creation and generated types](https://code.claude.com/docs/en/plugins/mods/create), [test kit and its limitations](https://code.claude.com/docs/en/plugins/mods/test), [reference](https://code.claude.com/docs/en/plugins/mods/reference). Installed types are authoritative for this experiment.

## Reproduce without a paid model call

Run from the repository root. These commands use only synthetic text. The mock endpoint listens on loopback, supplies deterministic Anthropic-format streamed replies, observes real host request JSON in memory, and discards it. Its test-owned temporary configuration directory is removed in `finally`; each child has a 30-second bound. Existing user configuration and transcripts are not read. The temporary isolated configuration uses a synthetic API key and the loopback API endpoint. Nonessential host traffic is disabled.

```sh
rtk proxy claude plugin validate --strict qualification/host-spike
rtk proxy node qualification/host-spike/run-tests.mjs
rtk proxy node qualification/host-spike/mock-host.mjs
rtk proxy node qualification/host-spike/mock-host.mjs 'printf SPIKE_RAW # spike-throw'
rtk proxy node qualification/host-spike/mock-host.mjs 'printf SPIKE_RAW # spike-catch-throw'
rtk proxy node qualification/host-spike/mock-host.mjs 'printf SPIKE_RAW # spike-invalid'
```

The synthetic `SPIKE_RAW` marker is intentionally present in Bash arguments, which are outside the proposed protection scope. The payload probe examines `tool_result` blocks separately from those arguments. Prompt counters examine only text blocks in the first model request, so a later sanitized tool result cannot falsely prove prompt replacement. A meaningful result requires exit code 0, two requests, one tool result, and completion; the harness exits nonzero when these prerequisites are missing. A completed reproduction that demonstrates leakage still exits zero: inspect the raw-marker counter for the compatibility verdict.

## Observed results

Strict validation passed. The two local SDK tests passed. They establish event-chain behavior with stubs, not actual file reads, model payload mapping, or UI painting.

All four loopback runs completed with exit code 0, two requests and one tool result:

- Normal replacement: sanitized marker present, raw marker absent in the tool result.
- Main hook throws after `next`: fixed catch-deny present, raw marker absent.
- Main hook and catch both throw: **raw marker present in the model's tool result**. The CLI also emitted stderr; raw stderr is intentionally not recorded.
- Invalid `result: null`: raw marker absent, sanitized marker absent, fixed catch-deny absent. This is not proof that invalid envelopes fail closed generally. The SDK testing API independently accepted and returned null without schema rejection.

The first request's prompt text was rewritten to the sanitized marker. The local event test also proves pre-`next` prompt drop and thrown-hook catch-drop do not reach the terminal stub. Actual prompt catch-failure payload behavior remains unevaluated.

## Exact installed surfaces and implications

The plugin layout is `.claude-plugin/plugin.json` plus `hooks/hooks.json` with `modules`, whose module exports `register(on)`. Commands register through `$.command.register` during `session.start`; `/spike` was actually executed with `claude -p` and returned the local fixed response without a model call. Product `/redacton` and `/redactoff` are not implemented by this spike.

`prompt.submit` input includes text, optional attachments/context, wait, origin, and optional running turn ID. Rewriting must happen before calling `next`, because it enters or queues the prompt. A post-`next` drop is invalid. Tool calls have `tool_use_id` and optional `agentId`; an enclosing hook can capture state before awaiting `next` and retain that snapshot until the same invocation returns. Toggle races and session restoration were not tested.

Core tool envelopes contain `result`, `text`, and `ref`, with optional `context`, `isError`, and `isReadOnly`. A returned `ref` reuses core messages. Stub tests removed `ref` and `text` by reconstructing an envelope. Downstream `context` cannot be removed: experimentally the engine rejected a replacement omitting a context entry attached below. The spike therefore withholds whole results that contain context. A post-execution `deny` is accepted and does not undo side effects. The safe catch path executed the original operation once in the stub test.

Installed Bash results require `stdout`, `stderr`, and `interrupted`; optional raw/persisted output paths, structured content, image/background flags and additional metadata are available. Installed Read text results contain `type: text` and `file` with `filePath`, `content`, `numLines`, `startLine`, `totalLines`, and optional truncation/artifact data. These are inspected schemas, not proven supported coverage.

`$.process.run` takes an argv array and options `cwd`, `env`, `stdin`, and `timeoutMs`. Its environment overlays the host environment; it cannot request a clean environment through these options. Default timeout is 30 seconds, maximum ten minutes. Timeout kills the child and rejects. Stdout and stderr each cap at 4,194,304 bytes with explicit truncation booleans. No AbortSignal is declared. These are type-contract facts; actual Mod process execution was not exercised.

`ui.render` provides `AbovePrompt`, including available row/column limits, survey/working flags and scroll state. It is a candidate persistent-warning surface only; neither a real terminal warning nor Desktop rendering was qualified.

## Still open

Issue #2 is partially evaluated and must remain open. Read replacement, Bash stderr, prompt context/attachment aliases, transcript/storage plaintext behavior, unknown envelopes, permission denial, cancellation, process failures, UI visibility, ON/OFF commands, both toggle-race directions, concurrency, session isolation/restoration, clean artifact install, Linux and Desktop remain unevaluated. No production readiness, supported-platform release, plaintext-storage exclusion, or all-tool coverage claim follows from this report.

The next action is to resolve the host catch-failure boundary and rerun qualification before implementing the protection feature.
