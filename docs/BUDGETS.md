# Helper startup and bounded work measurements

Current-source issue #63 retains the 2,000 ms scan/self-check deadline and four
pending helper calls, with a separate 5,000 ms settings/transfer deadline.
The parent SDK bounds the complete process launch. The helper bounds stdin
reading and parsing to 2,000 ms; only a complete validated settings envelope and
documents gain the remaining time until an absolute 5,000 ms helper deadline.
An untrusted operation string, malformed request or delayed stdin cannot reset
that timer. Scan, self-check, configuration validation and preview remain 2,000 ms.

Actual Windows 2025 CI measured the first direct .NET process-start probes fail
at 1,052/1,076 ms under the former 1,000 ms phase budget, then at 1,557 ms under
1,500 ms, while later warmed probes passed. These failures are evidence that
local macOS measurements and warmed Windows tests do not establish cold Windows
startup. The probe phase is now bounded to 3,000 ms and complete settings helpers
to 5,000 ms. The first full settings load/save is measured before component fixtures
or storage tests can warm PowerShell. `firstSettings` retains its total elapsed
milliseconds, success and fixed failure code even when that cold event fails.
Engine artifact availability can touch engine files beforehand, but performs no
settings/PowerShell probe; cold OS filesystem caches are not claimed. Successful numeric cold full-save evidence
must come from the next actual Windows CI run, not a timeout-only observation.

This does not add a daemon, prewarming prerequisite, retries or a live-owner
bypass. Busy locks still refuse promptly. Multiple slow ownership probes during
stale recovery can exceed the finite settings deadline; the result stays
unavailable and retryable, with active rules unchanged and selected ON content
withheld. The setting applies globally rather than hiding a platform-specific
parent/helper mismatch.

## Method and scope

Run `node scripts/measure-budgets.mjs` after dependency installation. It builds the
helper, measures the native engine when available, and always creates a temporary
forced-WASM package. It removes those package copies in `finally`. No dependency
installation, new daemon, or persistent worker is introduced. Optional
`--cpu-load` adds one competing CPU process that exits after at most 30 seconds and
is terminated after measurements. This is CPU competition on the local machine,
not an assertion of a container quota. `--single-cpu-affinity --cpu-load` additionally requires Linux and verifies that both the measuring process and the competing worker have the same single allowed logical CPU in `/proc/self/status`. The competitor remains finite (at most 30 seconds), and early competitor exit fails the constrained report. Helper children inherit the same affinity. This constrains the process subtree's scheduling, not the VM's machine-wide CPU count or quota.

A single failed sample (for example one cold PowerShell ownership probe exceeding its finite deadline) fails a measurement. The Windows PR job runs the measurement once more after a first failure; two consecutive failed measurements are treated as a real regression.

Each artifact uses 10 fresh processes per measured operation. Reports retain
attempt/failure counts, nearest-rank p50/p95, and maximum over successful attempts.
The first process event is reported separately; subsequent events summarize warm
filesystem/cache observations. Every child is still a cold process. Cold disk-cache
state is uncontrolled and is not claimed. Within a component worker, first and
second scans separately measure cold and warm engine state. Module import,
initialization, helper module load, pure settings load/save and immediate live-lock
refusal are independent numeric timings. A minimal Node child supplies the process
startup baseline. Components are independent samples and must not be subtracted
from full-event timings.

Full helper events separately measure scans, load and save through stdin. Maximum
scan fixtures use exactly 262,144 UTF-8 text bytes. Validations require successful
bounded protocol 2 responses, the expected native/WASM artifact, and removal of
the synthetic token. No live credentials or raw input/env/error output is retained.
Startup overrides clear `NODE_OPTIONS` and `NODE_PATH`. The generated JSON report
contains aggregate timings, bounded identity provenance and fixed failures only.
`REDACTON_BUDGET_REPORT` selects its output file for existing CI job artifacts.
The script fails on unsuccessful measured operations, but uses the actual configured
2,000 ms scan and 5,000 ms settings deadlines rather than a flaky machine-specific p95 threshold. Native
unavailability is explicitly reported, not mislabeled as native success.

These direct Node fixtures exclude Claude SDK dispatch, UI rendering, model payload
delivery, host storage, OS cold caches and unmeasured platforms. Existing
`tests/resource-boundary.test.ts` and `tests/recovery-host.test.ts` provide distinct
cancellation, deadline, burst saturation and repeat-recovery regressions; benchmark
success does not replace them. Cancellation can suppress delivery while an SDK
child remains running until its bounded timeout. No unlimited wait or partial
content delivery is introduced.

## Observed local results

macOS ARM64, Node v22.16.0, core 0.1.0-beta.14; 10 attempts per
operation with zero failures, both idle and one competing CPU worker. Values below
are p50 / p95 milliseconds. With 10 samples, nearest-rank p95 equals the maximum;
these small samples are observations, not latency guarantees.

| Complete event | Native idle | WASM idle | Native competing CPU | WASM competing CPU |
| --- | ---: | ---: | ---: | ---: |
| Scan | 46.937 / 59.392 | 57.922 / 89.739 | 56.393 / 103.378 | 52.056 / 57.968 |
| Load settings | 47.702 / 217.637 | 56.846 / 139.600 | 55.381 / 70.634 | 48.625 / 66.990 |
| Save settings | 67.838 / 166.108 | 77.336 / 130.021 | 76.954 / 167.960 | 66.504 / 81.106 |
| Maximum text scan | 57.649 / 97.728 | 81.116 / 142.866 | 68.593 / 142.049 | 75.624 / 80.140 |

Idle process-start baseline: 26.607 /
45.936 ms. First fresh-process full scans were
51.826 ms native and
59.681 ms WASM. Subsequent
warm-filesystem fresh-process scans were
46.937 / 59.392 ms native and
57.922 / 89.739 ms WASM.

| Idle component | Native p50 / p95 ms | WASM p50 / p95 ms |
| --- | ---: | ---: |
| Core module import | 6.864 / 15.740 | 4.915 / 7.327 |
| Engine initialization | 1.332 / 2.595 | 12.969 / 16.648 |
| First scan | 0.796 / 1.856 | 4.050 / 4.936 |
| Warm engine scan | 0.061 / 0.070 | 0.114 / 0.164 |

| Idle settings component | Native p50 / p95 ms | WASM p50 / p95 ms |
| --- | ---: | ---: |
| Helper modules import | 4.066 / 9.246 | 2.611 / 3.370 |
| Settings load | 2.136 / 6.747 | 1.482 / 7.467 |
| Settings save and ownership | 21.536 / 24.680 | 20.781 / 25.823 |
| Live lock immediate refusal | 8.669 / 10.781 | 8.152 / 14.337 |

The current package already selects WASM through the pinned engine's supported
fallback, without lifecycle-script assumptions or an independent scanner. These
measurements support retaining that simple process-per-event design. The four-call
pending bound remains a security/resource cap; sequential timings do not prove
four-way host throughput or a maximum safe concurrency under every CPU quota.

## Node 24 comparison on the same local platform

A checksum-verified official Node v24.21.0 binary ran from a temporary directory
without replacing the host Node installation. Ten idle attempts per operation for
native and forced WASM completed with zero failures. The helper byte hashes match
the Node 22 run. No competing-CPU Node 24 or cross-version causal speedup claim
is made, because background load and caches varied between local runs.

| Complete Node 24 event | Native p50 / p95 ms | WASM p50 / p95 ms |
| --- | ---: | ---: |
| Scan | 33.794 / 35.269 | 50.656 / 120.577 |
| Load settings | 35.563 / 40.757 | 51.424 / 65.076 |
| Save settings | 52.343 / 53.969 | 67.796 / 160.342 |
| Maximum text scan | 42.395 / 44.691 | 69.974 / 124.492 |

Process-start baseline: 22.984 /
24.513 ms. First fresh-process events were
34.031 ms native and
49.001 ms WASM; subsequent
warm-filesystem fresh-process events measured
33.794 / 35.269 ms native and
55.453 / 120.577 ms WASM.

| Node 24 component | Native p50 / p95 ms | WASM p50 / p95 ms |
| --- | ---: | ---: |
| Core module import | 3.522 / 4.551 | 3.546 / 6.385 |
| Engine initialization | 1.054 / 1.566 | 12.991 / 22.639 |
| First scan | 0.703 / 1.993 | 4.285 / 5.558 |
| Warm engine scan | 0.058 / 0.077 | 0.111 / 0.156 |

| Node 24 settings component | Native p50 / p95 ms | WASM p50 / p95 ms |
| --- | ---: | ---: |
| Helper modules import | 3.948 / 4.650 | 2.157 / 3.264 |
| Settings load | 1.364 / 8.294 | 1.397 / 6.312 |
| Settings save and ownership | 17.353 / 19.258 | 18.923 / 27.646 |
| Live lock immediate refusal | 6.964 / 8.116 | 7.947 / 12.706 |

## Provenance and remaining targets

Measured helper base: `1eefaaab570bd88618cd0524cbe9ebf1edffa0ed`. Hashes are generated helper byte
identities, never hashes of scanned input or rule contents:

- `index.js`: `61ced6aa6da1231622515d295ca8b3b3a0a4a7561ab50e58b15ec468bde97427`
- `core.js`: `bc416665015d93208eb44cc07374b98e6ea66c58930e6045ff5434a1d21f5246`
- `storage.js`: `8c922779e01fe417c55bd966a1de234e9e065128cc5edfcdb31b00c235c97c23`

Node 22.16.0 and the temporary Node 24.21.0 binary were measured locally.
Linux, native Windows, WSL, Cowork, VM and
container runtime measurements remain unverified locally. The existing Linux
Node 22 PR job now runs a second report on its virtualized GitHub runner:
`taskset` selects the smallest CPU in the job's actual allowed affinity set,
then the script verifies parent and worker affinity before measuring. It does not
assume CPU 0 is allowed. Both idle and single-CPU contention reports are uploaded
by the same existing job, without adding jobs or a benchmark-specific workflow.
Successful CI execution establishes that named GitHub VM process-contention row;
it does not establish a machine CPU quota or unknown user's VM behavior. The installed Docker
client's read-only daemon probes did not complete and were interrupted; no image
was pulled or runtime created. Existing CI jobs can run this script on their
actual Node/platform combinations and retain small JSON reports without adding
new jobs. A VM runner result should be identified as that runner, never generalized
to an unknown user's VM or Desktop environment. Large/synthetic reports and
package copies are not committed. Actual host event delivery latency still needs
its own host evidence.
