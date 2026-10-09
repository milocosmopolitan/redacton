# Evaluated Bash schemas

Issue #60's proposed 2.1.295 shape drift was not reproduced in the synthetic small
foreground Bash run. Installed generated SDKs for 2.1.294, 2.1.295 and the exact
current candidate 2.1.296 all declare optional `rawOutputPath?: string` and
`structuredContent?: unknown[]`. All three actual small Bash results omitted both
properties. Declaring a property does not prove it is present at runtime.

## Current observations

On 2026-10-09, macOS ARM64 / Node 22.16.0 / beta.14:

| Claude Code | Installed declarations | Actual foreground result | Qualification scope |
| --- | --- | --- | --- |
| 2.1.294 | Both aliases optional | Both absent | Synthetic shape and model-delivery regression |
| 2.1.295 | Both aliases optional | Both absent | Synthetic shape and model-delivery regression |
| 2.1.296 | Both aliases optional | Both absent | Evaluated current candidate, no future-version range |

The model-origin envelope retains other known optional data properties as
`undefined`, including persisted/background output metadata. It exposes string
stdout/stderr, boolean interrupted/isImage/noOutputExpected, and the original
text/ref display aliases. Only stdout/stderr and interruption survive trusted
Bash reconstruction; original references and aliases are discarded.

The shared adapter accepts `rawOutputPath` and `structuredContent` only when
absent or exactly `undefined`, matching these exact SDK contracts. Every populated
value remains unsupported, including empty strings/arrays/null: paths may refer to
unscanned files, and structured blocks may contain alternate model content.
Accessors, symbols and unknown keys, even unknown `undefined` keys, remain
withheld. There is no blanket unknown-field exception, alternate file read,
argument rewrite, permission bypass or tool reexecution. Regression tests exercise
these negative cases and assert fresh envelopes without raw aliases.

`node qualification/bash-shape-host.mjs` generates the selected installed SDK
interactively, executes only a fixed synthetic Bash fixture against a loopback
model, and records property types/undefined/absence plus SDK SHA-256 identities.
It deliberately runs without protection to observe the host's original shape;
its synthetic raw marker reaching the loopback endpoint is a negative control,
not a protection pass. No tool text, paths, original values or model payloads are
retained. Temporary plugins, HOME and generated declarations are removed. Use
`CLAUDE_BINARY` to select an exact binary; the 2.1.296 evaluation used official
manifest SHA-256 `c9b5341637becbd423ddffc5b254afb645682a3868cb708bbc6cc0e7bb419937`.

The protected integration runner separately checks actual model-bound prompt,
Read and Bash results, original tool arguments, and permission denial against the
selected packaged Mod. Shape evidence does not prove populated aliases are safely
supported. Background/large-output paths remain withheld when unsupported fields
are populated. Desktop, Cowork, unmeasured platforms and future hosts remain
unqualified. Historical released artifacts retain their existing scope.

## Declaration generation

The 2.1.294 local command launch writes declarations in print mode; observed
2.1.295/2.1.296 do not. `scripts/test-mod.mjs --types` now verifies local enabling
command activation, then uses an isolated interactive PTY if declarations are
absent. This follows the [official installed-type workflow](https://code.claude.com/docs/en/plugins/mods/create#get-type-definitions-for-your-version).
The fallback requires Python 3 with Unix PTY support; native Windows current-host
type generation is not claimed. Existing Windows pure/package checks do not use
that fallback. It sends no model prompt, inherits no host credentials, disables
updates, uses only a synthetic API key and refuses missing declarations rather
than copying stale types. Schema generation is separate from interception tests.
