# Helper resource measurements

Node v22.16.0, darwin arm64, core 0.1.0-beta.14. Ten fresh helper processes per artifact scanned 65 UTF-8 bytes of synthetic ordinary text plus one recognized synthetic credential. Timing includes process startup, stdin, initialization, scanning, stdout and exit. Quantiles use nearest rank; raw millisecond samples are in [budgets.json](budgets.json). Filesystem/package caches were warm; these are sequential local samples, not latency guarantees.

| Artifact | p50 ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: |
| Native | 36.165 | 39.185 | 39.185 |
| Forced WASM | 49.211 | 54.975 | 54.975 |

One maximum-size event of exactly 262144 UTF-8 bytes took 39.738 ms native and 61.909 ms forced WASM. Both succeeded and removed the recognized synthetic token. A single maximum-size sample does not establish a tail-latency distribution.

Configured bounds remain 262,144 UTF-8 input bytes, 256 segments, 1,000 findings, 2,097,152 response bytes, 4 pending protected helper calls, and 2,000 ms including process startup. The helper timer also bounds waiting for stdin/initialization; the parent process deadline is required because synchronous scanning blocks JavaScript timers. Per-event excess input/findings/output is withheld; no partial response is delivered.

Installed Claude Code 2.1.294 SDK declares independent 4,194,304-byte stdout/stderr caps, with truncation flags. The 2 MiB helper response budget stays below that stdout cap. The [actual fault probe](failure-host-report.md) withheld 5 MiB stdout; without inspecting its process truncation flag this does not distinguish host truncation from the parent response-size guard. OFF dispatches no helper. No daemon, stream stitching, network verification, or telemetry was used.

Reproduce with `rtk proxy node scripts/measure-budgets.mjs`. Temporary forced-WASM package copies are removed in finally. Linux, Windows, concurrent load, cold disk-cache conditions, and host cancellation behavior are not established by this report.
