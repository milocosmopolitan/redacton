# Actual prebuilt artifact host qualification

Claude Code 2.1.294 on macOS ARM64 with Node v22.16.0 loaded the prebuilt evaluation artifact through `--plugin-dir`. The actual pinned helper and packaged dependencies executed from inside the artifact; no development build or dependency installation was needed for these four runs.

The actual loopback payload probes passed for prompt text, textual Read, Bash stdout/stderr and local `/redactoff`. Prompt, Read and Bash outputs included the exact engine placeholder `<SECRET_1>` and excluded the original recognized synthetic credential. Read/Bash results were successful sanitized results, not substituted errors; original tool arguments were unchanged. `/redactoff` produced its fixed immediate warning with zero model requests. All four runs had successful local Mod preflight and exit code 0.

Storage evidence remains separate: original prompt text persists in the host's queue-operation content; Bash command arguments persist as an excluded surface. Original synthetic output was absent from the evaluated persisted tool-result blocks. These observations do not guarantee absence of plaintext in all host storage.

Reproduce from the repository root:

```sh
rtk proxy node qualification/integration-host.mjs prompt --plugin-root artifacts/redacton-alpha-1
rtk proxy node qualification/integration-host.mjs read --plugin-root artifacts/redacton-alpha-1
rtk proxy node qualification/integration-host.mjs bash --plugin-root artifacts/redacton-alpha-1
rtk proxy node qualification/integration-host.mjs off --plugin-root artifacts/redacton-alpha-1
```

[packaged-host-report.json](packaged-host-report.json) records the evaluated candidate archive/manifest hashes, verifies every manifest-listed runtime file and dependency, and records runtime-source hashes plus safe per-mode counters. Final documentation-only archive rebuilding can change the archive hash; this report identifies the evaluated candidate and immutable runtime bytes rather than claiming a later archive was executed. Generated host declaration files are outside the original build manifest.

All model traffic stayed on a synthetic loopback endpoint. No paid model call or real credential was used. The artifact is for evaluation; these results alone do not authorize a release or qualify other operating systems or Desktop.
