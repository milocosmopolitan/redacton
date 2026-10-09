# Settings ownership and child environment

This assessment covers current source for issues #64 and #65. It does not
requalify historical releases or prove Cowork/Desktop interception.

## Lease ownership and recovery

Settings saves retain atomic hard-link acquisition, exact document/revision CAS,
file sync before rename, and nonce revalidation before release or recovery.
Version 2 leases add platform/host identity and a process-start observation.
No timestamp or TTL permits removal of a live writer. Linux additionally binds
ownership to the kernel boot ID and PID namespace. Before using Linux process
metadata, the helper verifies `/proc/self/stat` reports its own Node PID; a
host-mounted procfs exposing another PID numbering scheme is unavailable rather
than evidence for reclaiming a live lease. Process starts come from Linux
`/proc/<pid>/stat`, macOS `/bin/ps lstart` with fixed UTC timezone, or Windows PowerShell direct .NET
`System.Diagnostics.Process.GetProcessById` StartTime UTC ticks. The Windows
probe disables logo/profile loading and avoids cmdlet/module autoloading. In-flight
self observations coalesce; a successful start remains stable and cached, while a
failed observation is retryable rather than poisoning the helper process cache.
Windows stdout must be bounded numeric ticks; unknown output never proves a
process identity. macOS has second-level precision; an indistinguishable reused
PID conservatively stays busy. Probes have fixed timeouts of 500 ms on macOS and
1,000 ms on Windows. Missing probes fail settings saves with a fixed unavailable
code; they do not bypass locking.

Only same-namespace ESRCH or a verified changed process start proves abandonment.
EPERM, unreadable identity, foreign namespace, and old/malformed leases stay
`SETTINGS_BUSY`. Recovery claims are versioned leases too, so a crashed claimant
can recover through the same arbitration. Recovery nesting stops after depth 4;
further indeterminate contention stays busy. No raw ownership paths or exception
strings appear in protocol errors. All writers must use this protocol; old helper
versions must not concurrently save into the same directory.

Personal directories must be private to one OS user and one host/PID namespace.
Unix checks require the current UID and no group/other permission bits. Windows
ACL privacy remains a deployment prerequisite, because POSIX mode checks do not
establish Windows ACL ownership. Linux host/container shared directories with
different PID namespaces refuse automatic recovery. Network shares, duplicate
hostnames on non-Linux hosts, multiple machines sharing one root, and deliberately
hostile same-user filesystem writers are unsupported. Use a private local root
per environment; the identity seed is not a cross-host authorization token.

For an indeterminate/legacy lock, do not remove the lock. Stop launches using the
old root, select a new absolute dedicated private `REDACTON_SETTINGS_ROOT` before
launching Claude, and load settings there. Review and reapply declarative rules
through configuration before trusting the new root. Keep the old directory intact
for inspection. This route changes scope identity and requires renewed project
approval; it does not silently overwrite an uncertain writer. For an indeterminate
project lock, a different personal root alone is insufficient: use a separate
clean project checkout without the old `.redacton` directory, then review and
approve its configuration. Preserve the old checkout. Genuine version 2
abandonment recovers automatically on the next save, with CAS still required.

## Inherited environment and startup

The host process API's `env` option overlays its inherited environment; supplying
an object does not create a clean child environment. The helper can therefore
inherit API credentials, proxy settings, SSH variables, home/profile directories,
PATH, and other values present in the user's Claude process. It does not send
these values to the scanner service or diagnostics, but they remain readable by
the child and dependencies. No clean-environment or compromised-host isolation
guarantee exists with this API.

Helper launches explicitly override `NODE_OPTIONS` and `NODE_PATH` with empty
strings to prevent inherited Node preload/options injection and extra module
search directories. Native/WASM loading still uses the pinned bundled engine;
there is no `--no-addons` switch. Original input goes only through stdin, never
argv, environment, shell commands or temporary input files. The Windows installer
also clears these two variables before all Node prerequisite/probe invocations and
restores the caller's values in `finally`; it never changes global execution
policy. Native Windows PowerShell is separate from WSL, and PowerShell tool output
remains outside Bash interception coverage.

The supported SDK resolves `node` through the host PATH. This trusts that PATH and
its executable; the helper cannot establish an independent executable trust root.
Missing Node/helper prerequisites yield fixed helper/settings failure codes and
unavailable readiness. Settings default to Node `homedir()/.config/redacton` on all
platforms to preserve existing location identity. An explicit override must be
absolute and nonempty. User-profile/home conventions come from Node, not the
plugin's own directory or a guessed Cowork mount. The configured directory must be
local, writable, private and free of symlink/reparse redirection. VM, Cowork, SSH,
WSL and native Windows may have distinct home directories and must each use their
own root. Node startup can still be influenced by OS loader variables, executable
replacement or a compromised host; these are residual boundaries, not claims of
universal startup isolation.

## Current evidence

On the local macOS host, storage regressions execute real process-start probes and
multiple real helper processes. Tests reproduce one CAS winner under concurrent
save/reclaim, a live competing writer, genuine dead ownership, simulated PID reuse,
EPERM, foreign namespace, crashed recovery claimant, path replacement, invalid
roots, and Unix directory permissions. Existing real helper tests cover native
engine startup and settings load/save through stdin. Windows file identities have deterministic coverage, but this local run does not
establish actual Linux/Windows process-probe or Windows installer execution.
Actual platform CI/qualification remains the gate for those claims. Environment
overlay behavior and startup override host evidence must be recorded with the
matching host regression results, separately from storage tests.

The 10-run local macOS Node 22.16.0 timing sample measured settings load at
6.39 ms median / 7.53 ms maximum and the first save including the process-start
probe at 17.40 ms median / 20.49 ms maximum. Each sample used a fresh Node process;
these timings exclude Node/engine startup and are observations, not guarantees.
The installer suite passed 13 tests with the native Windows test skipped locally.

The actual `qualification/environment-host.mjs` synthetic probe passed on Claude
Code 2.1.295 / macOS ARM64 / Node 22.16.0. A separate harmless inherited marker
remained visible through a process `env` overlay, confirming replacement is not
provided. A synthetic `NODE_OPTIONS` preload designed to refuse Node startup was
neutralized; real personal settings loading and self-check reached Protect ready.
No environment values or exception paths were dumped. The isolated CLI uses only
a synthetic API key and an unavailable loopback model endpoint. This does not
establish that every inherited credential is removed or that OS-loader/PATH
injection is prevented. The three production launch sites separately have SDK
regression assertions for both cleared Node variables.
