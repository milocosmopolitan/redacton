# Actual permission-denied Bash qualification

Claude Code 2.1.294, macOS ARM64, Node v22.16.0. The actual host runs in `dontAsk` permission mode without an explicit Bash allow rule. A loopback model requests a synthetic Bash command whose first action would append a fixed execution counter in the temporary workspace. The counter remains absent: zero executions.

The subsequent real model request contains an errored selected-tool result with a fixed Redacton code and no original synthetic output. The model's original tool-use arguments remain unchanged. The run completes with two model requests, one tool-result block and exit code 0. The original arguments persist in the transcript as an excluded surface; original output is absent from evaluated persisted tool results.

This is actual host denial evidence rather than a stubbed permission result. It does not claim behavior across every permission mode, a permission-grant dialog, or all tools. All inputs, counters, configuration and storage are temporary synthetic fixtures; no paid model or real credential is involved.

Reproduce with `rtk proxy node qualification/integration-host.mjs denied-bash --report qualification/permission-denied-host-report.json`. Exact source hashes and safe counters are in [permission-denied-host-report.json](permission-denied-host-report.json).
