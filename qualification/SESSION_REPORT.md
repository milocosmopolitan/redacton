# Actual host session lifecycle and interruption evidence

Claude Code 2.1.294, Node v22.16.0, macOS ARM64. All runs use synthetic fixtures, isolated temporary configuration and a loopback Anthropic-format endpoint. Reports contain source SHA-256 values, fixed counters and booleans; they contain no input values, raw stderr or filesystem paths. The hashes identify evaluated source snapshots, not credential material.

## Resumed and branched sessions

```sh
rtk proxy node qualification/session-host.mjs
```

An actual default-ON session submitted a recognized synthetic credential. The host's model request excluded the original and included `<SECRET_1>`. The same recorded session was resumed for the local `/redactoff` command, which returned its immediate warning with zero model requests. A subsequent actual `--resume` process requested ON again and redacted the new synthetic prompt. Actual `--resume --fork-session` also requested ON, redacted the prompt and returned a distinct session ID. Each prompt run completed exactly one model request with exit code 0. This establishes that the evaluated OFF command did not create a global persistent OFF preference.

Exact evidence: [session-host-report.json](session-host-report.json). The existing SDK tests additionally exercise in-process session-end clear/resume reset and lazy readiness checks; an interactive `/resume` menu was not used for this probe.

## Same live process OFF bypass

```sh
rtk proxy node qualification/stream-session-host.mjs
```

A direct argv child preserves Claude's streaming output, while the shell entrypoint still uses `rtk`. The test sends stream-JSON inputs sequentially in one actual CLI process: local helper-count command, `/redactoff`, synthetic prompt, and another helper-count command. A separate qualification-only Mod counts `process.run` dispatches without reading or logging stdin.

The count remained exactly **1**, the session's initial readiness helper, before and after the OFF prompt. The fixed immediate warning appeared; the synthetic prompt reached exactly one model request unchanged, which is the explicit OFF behavior. Exit code was 0. This qualifies actual live-session scanner bypass rather than inferring it from local state tests.

Exact evidence: [stream-session-host-report.json](stream-session-host-report.json). The counter Mod is qualification-only and is not part of the distributed product.

## Actual process-level cancellation

```sh
rtk proxy node qualification/cancellation-host.mjs
```

A temporary copy of the production Mod replaces only the helper with a bounded synthetic delay fixture. The first case interrupts the actual CLI with SIGINT after its first model request but before any tool-helper dispatch. The second interrupts after the tool helper writes its opaque process ID and begins a five-second delay; production `process.run` retains its 2,000 ms timeout.

Both cases reached their intended stages, stopped after SIGINT with exit code 0, and issued **zero subsequent model requests**. Neither delivered a tool-result block or the original synthetic output. In the during-helper case, the child was no longer alive when checked after 2,200 ms. The fixture and temporary copied plugin/configuration were removed.

Exact evidence: [cancellation-host-report.json](cancellation-host-report.json). This is actual subprocess SIGINT evidence. It does not claim a live terminal Esc gesture, an injected SDK AbortSignal, immediate child termination, or secure memory erasure. The observation cannot distinguish cancellation cleanup from the already configured helper timeout.

All probes have finite child bounds and task-owned cleanup. No paid model request, provider verification or real credential is involved.

## Actual host permission denial

```sh
rtk proxy node qualification/integration-host.mjs denied-bash --report qualification/permission-denied-host-report.json
```

The actual CLI runs in `dontAsk` mode with no Bash allow rule. The loopback model requests a Bash command that would append a nonsecret execution counter and emit the synthetic token. The host denies permission: the counter remains absent, recording **zero executions**. The next model request contains exactly one errored tool result with a fixed Redacton withholding code and no original output. Its previous assistant tool-use arguments are byte-for-byte unchanged. This establishes that the Mod does not bypass the evaluated host permission denial or rewrite tool arguments.

The run completed two model requests with exit code 0. Original arguments remain in the host transcript as an excluded surface; no original token appears in persisted tool-result blocks. Exact source hashes and counters: [permission-denied-host-report.json](permission-denied-host-report.json).

## Hot reload scope

```sh
rtk proxy node qualification/hot-reload-host.mjs
```

In the evaluated print/stream-JSON mode, editing the temporary plugin's runtime initialization did **not** trigger a reload. The initial and final helper counts remained 1, no reload notice appeared, and the existing session remained intentionally OFF. The probe exits 1 because its expected reset/reload was not observed; [hot-reload-host-report.json](hot-reload-host-report.json) records this negative result.

This does not establish failure of an ON operation: the user had explicitly requested OFF and no new plugin instance was observed. Automatic hot reload and state preservation/reset in an interactive live terminal remain unevaluated. Fresh-process restoration and branching are separately qualified above; product documentation must not advertise print-mode live reloading.
