# Contributing

Read [AGENT.md](AGENT.md), [the architecture](ARCHITECTURE.md), and [compatibility](docs/COMPATIBILITY.md) before changing protection boundaries. Follow [the conduct policy](CODE_OF_CONDUCT.md).

## Development

Run from the source checkout:

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run test:mod
npm run validate
node scripts/verify-artifact.mjs
```

`check` runs the current type/lint and unit checks; `typecheck`, `lint`, and `format` are also available individually. Use the installed Claude Code-generated declarations, not an assumed public SDK snapshot. Generated helper output and qualification results are build products, not a second editable source tree.

TypeScript belongs in `mod/` and `helper/src/`. SDK calls stay in Mod registration; imported adapters receive data only. Scanning stays in the separate pinned-engine helper. Do not add a Rust detector/helper merely to duplicate the engine's existing native/WASM implementation.

## Security and verification

Capture ON/OFF at operation start. OFF dispatches no helper. Selected ON failures withhold content through a fixed response under the documented host/guard conditions; never return cached originals from catches. Rebuild allowlisted envelopes and strip aliases. Preserve permissions, execute a tool once, and leave authentication/tool arguments unchanged. Send sensitive input through stdin only.

Use synthetic fixtures. Test user-visible behavior and failure boundaries, not implementation mirrors. Actual-host regressions in `qualification/` isolate settings and use loopback model responses; helper and SDK tests alone do not prove model delivery. Keep payload, UI and transcript/storage evidence separate. Record versions, actual results and exclusions. Never log credentials, raw input/paths/stderr, arbitrary exceptions or secret hashes.

For a boundary change, use `qualification/integration-host.mjs` with `prompt`, `read`, `bash`, `off`, or `denied-bash`, then the fault/session/interruption harness appropriate to the change. The retained catch-failure host regression has an explicit negative control:

```sh
node qualification/host-boundary-host.mjs normal
node qualification/host-boundary-host.mjs guarded-catch-failure
node qualification/host-boundary-host.mjs unguarded-catch-failure
```

The last mode intentionally reproduces the host's raw fallback and must not be treated as a protection pass. The terminal UI runner requires a temporary pyte installation. These are actual-host regressions, not replacements for unit checks; disclose any path that was not rerun.

Published package evidence is immutable at its release tag. Refactoring source does not requalify that artifact or unrelated platforms. Run the relevant current checks before making new compatibility claims. Desktop, other platforms and an independent production-accuracy claim require their own evidence.

## Reviews and releases

A PR should state the user-visible change, related issue, validation and material limitations. Update current docs when behavior changes; preserve historical evidence through tag links rather than duplicating generated reports in main. Do not claim a planned feature or pilot result merely because code exists.

Distribution requires a prebuilt clean artifact, exact pins/lockfile, MIT/dependency notices, private reporting, compatibility evidence and explicit beta exclusions. Vulnerabilities use [private GitHub reporting](https://github.com/milocosmopolitan/redacton/security/advisories/new); conduct concerns use [the documented maintainer email](CODE_OF_CONDUCT.md). Public issues are not confidential. Never send outreach without authorization.
