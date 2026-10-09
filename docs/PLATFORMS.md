# Platform targets and qualification

Cross-platform CLI protection is required product scope, tracked in [#29](https://github.com/milocosmopolitan/redacton/issues/29). Package availability, a passing helper, and a successful installer are separate from actual Claude model-boundary protection. The machine-readable target list is [platform-matrix.json](platform-matrix.json); reproduce pinned dependency inspection with `node scripts/inspect-platforms.mjs` after `npm ci --ignore-scripts`.

## Requirements and identities

The candidate helper accepts Node **22.16.0 or newer in major 22**, or **24.21.0 or newer in major 24**. These conservative floors come from recorded macOS tests, not a measurement on every OS. Other Node majors are rejected. The historical v0.1.0 installer remains limited to macOS ARM64 and Node 22.

The qualification host is exactly **Claude Code/generated SDK 2.1.294**. No supported host version range has been established. Newer hosts need their own evidence. The [official host setup](https://code.claude.com/docs/en/setup), reviewed 2026-10-09, lists native macOS, Linux, Windows and WSL installation. Its OS availability does not establish Mod/local-process behavior on those systems. Adopted candidate OS floors are macOS 13+, Ubuntu 20.04+/Debian 11+ with **glibc 2.31+**, and native Windows 10 1809+/Server 2019+. Musl is a separate follow-up even though the pinned engine declares musl addons.

The pinned engine is `@redact-secret/core@0.1.0-beta.14`, whose public ESM import initializes a native addon first, then automatically loads its ordinary `@redact-secret/wasm@0.1.0-beta.14` dependency if native loading fails. A portable candidate deliberately omits optional addons and uses that normal fallback, without runtime patches or a detector fork. Native testing uses the normal locked development installation separately. A WASM helper pass cannot qualify the host's interception, permissions or session behavior.

## CLI matrix

Every target row requires both Node floors above, package/install checks and actual-host evidence for the same source/artifact. Historical verification applies only to the existing tagged artifact.

| Environment | Engine addon declared in exact lock | Candidate installer | Protection evidence |
| --- | --- | --- | --- |
| macOS ARM64 | `node-darwin-arm64` | Unix; historical default also available | Historical v0.1.0 CLI/Node 22.16.0 verified. Candidate requires its own evidence. |
| macOS x64, native | `node-darwin-x64` | Unix candidate | Target, unqualified until native runner and actual host pass. |
| Linux glibc x64 | `node-linux-x64-gnu` | Unix candidate | Target, unqualified until installer and actual host pass. |
| Linux glibc ARM64, native | `node-linux-arm64-gnu` | Unix candidate | Target, unqualified until native runner and actual host pass. |
| Windows x64, native | `node-win32-x64-msvc` | PowerShell candidate | Target, unqualified. Bash interception additionally needs the host's Bash tool. PowerShell tool output is outside current coverage. |
| WSL2 Linux x64/ARM64 | Matching Linux GNU addon | Unix candidate inside WSL | Separate target, blocked on an actual WSL2 environment. Ubuntu CI alone is not WSL evidence. |

All addon names have the `@redact-secret/` prefix and version `0.1.0-beta.14`. All rows can use the portable WASM candidate. No architecture emulation counts as native evidence.

## Separate capability gaps

- Linux musl x64/ARM64: locked musl addons exist, but installer/distribution/host qualification is follow-up; candidate Unix installer rejects musl.
- Windows ARM64: locked native addon exists, but installation and host qualification remain follow-up.
- Desktop: a host surface, not an OS. [#27](https://github.com/milocosmopolitan/redacton/issues/27) owns local-process, commands, forms and UI qualification; CLI tests cannot close it.
- Native Windows without Git for Windows: the official host can use PowerShell instead of Bash. Redacton currently intercepts Bash and Read, not the PowerShell tool. Do not count a PowerShell execution as a protected Bash probe.
- No upstream engine loading gap has been demonstrated: target addons are declared and the normal WASM fallback is usable on the inspected macOS environment. Open an upstream task only for a reproduced unusable consumer row.

## Installation and troubleshooting

The two-minute README command installs the immutable macOS ARM64 v0.1.0 release only. Portable archives and Windows installation are **candidate workflows**, not newly published verified release assets. Build with `npm run build`, inspect the produced checksum/provenance, then use the explicit candidate inputs described by the installer. Never repin v0.1.0 or reuse its checksum for a different archive.

For a **local 0.1.1 candidate built from the reviewed source**, Unix installation uses:

```sh
npm ci --ignore-scripts
npm run build
digest=$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync("artifacts/redacton-0.1.1.tar.gz")).digest("hex"))')
REDACTON_RELEASE_VERSION=0.1.1 REDACTON_ARCHIVE_SHA256="$digest" \
  REDACTON_ARCHIVE_PATH="$PWD/artifacts/redacton-0.1.1.tar.gz" bash scripts/install.sh
```

On native Windows x64, build in the checked source directory with Node and npm, then run:

```powershell
npm ci --ignore-scripts
npm run build
$digest = (Get-FileHash -LiteralPath 'artifacts/redacton-0.1.1.zip' -Algorithm SHA256).Hash.ToLowerInvariant()
./scripts/install.ps1 -ReleaseVersion 0.1.1 -ArchiveSha256 $digest -ArchivePath "$PWD/artifacts/redacton-0.1.1.zip"
```

These commands verify locally built bytes and readiness; they do not download a nonexistent published 0.1.1 release or qualify its host. If your PowerShell policy blocks local scripts, follow your organization's approved process; the installer does not change execution policy. Use the quoted launch command printed by the installer only when you explicitly want to start Claude.

WSL must use Linux `node` and `claude` inside the distribution, place its installation/settings in the Linux filesystem, and keep them separate from `%LOCALAPPDATA%` on native Windows. A Windows executable inherited through WSL PATH is not a Linux installation.

Missing Node/Claude, an unsupported CPU/libc, invalid checksum, unsafe archive or failed helper readiness must stop installation. Download/extract/self-check failures preserve the previous installation. A successful self-check reports engine readiness, not a protected model task. Launch explicitly and confirm **Protect ready** before work.

Settings reads reject links and file-identity changes even where Node lacks `O_NOFOLLOW`. POSIX settings use private file modes; Windows inherits the account/directory ACL, and Unix mode bits do not establish Windows privacy. When Windows cannot fsync a directory, successful atomic replacement does not promise survival of a power loss. Keep the dedicated user data directory under an appropriate account ACL.

## Delivery sequence and remaining gates

1. #30 defines target identities, package declarations, floors and gaps.
2. #31 supplies a portable locked archive and strict extraction.
3. #32 and #33 implement Unix and native Windows installation in parallel.
4. #36 adds inexpensive deterministic checks; #37 exercises package/install rows.
5. #34 runs actual-host protection/session/failure probes, then #38 gates releases on exact-commit evidence. UI/Desktop remains separate.
6. #35 can clarify target versus verified scope immediately, but working published cross-platform commands require checked release assets.

Implementation merge does not close rows whose native installation, host or interactive evidence is missing. See [CI policy](CI.md) for costs, fork isolation and evidence retention. Prior release evidence remains immutable in [COMPATIBILITY.md](COMPATIBILITY.md).
