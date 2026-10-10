---
scope: workspace
status: accepted
---

# Ship one portable candidate and qualify each host separately

Redacton targets macOS and Linux with one Mod, helper and configuration implementation. Native Windows has a PowerShell installer candidate and WSL2 uses the Linux installer; neither has a qualification path. Desktop is a separate host surface. The immutable macOS ARM64 v0.1.0 artifact remains the verified release; candidate source version 0.1.1 does not change that claim.

Portable candidates bundle the pinned core and ordinary WASM dependency, omitting optional native packages so the public engine import uses its normal automatic fallback. The exact npm lock, prebuilt helper, dependency notices, full file digests, archive digests and source/builder provenance travel with the candidate. Node archive tooling avoids a build-host Python or RTK dependency. Installed dependency bytes are trusted through a clean integrity-checked `npm ci --ignore-scripts`; the builder does not independently authenticate modified node_modules.

Candidate installers require an explicit reviewed version and digest, use platform data directories, validate archive paths/types/file digests and helper readiness before switching, and restore the previous installation on failed activation. They do not launch a model task, edit a shell profile or bypass Windows execution policy. Historical installer defaults retain their original platform/version scope.

CI separates inexpensive deterministic tests, pinned SDK validation, native/WASM package and installer checks, actual-host model-boundary probes, and manual terminal/Desktop evidence. A passing helper or an unavailable runner never qualifies a host. The release gate binds complete evidence to an exact source commit and the same canonical archive. Full cross-platform jobs are manual, concurrent rows are bounded, and fork code never gets privileged credential-bearing runners.

Native Windows PowerShell installation does not add PowerShell tool interception: current protection still covers supported prompt/Read/Bash inputs. WSL2 uses Linux executables and its Linux filesystem; it is not qualified and its results are never recorded as Linux. Musl, Windows ARM64, Desktop, races and interactive flows remain explicit gaps until their own evidence exists.
