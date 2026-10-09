# Host activation and command authority

## Cowork decision: NO-GO until qualified

Cowork is a distinct surface, not a synonym for Desktop Code. As inspected on
2026-10-09, [official plugin guidance](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)
describes custom plugin uploads, skills/commands and local MCP servers in Cowork.
[Official authoring guidance](https://academy.claude.com/tutorials/how-to-build-a-plugin-from-scratch-in-cowork)
describes plugin skills across surfaces. Neither source establishes that this
package's `hooks.modules` Mod can replace or withhold model-bound results.
Standard plugin support is not evidence of the required Mod boundary.

The locally installed macOS ARM64 Claude Desktop is **2.31226.0**. Its observed
mode selector exposed Claude and Code, with no Cowork entry. No Cowork task was
created, plugin uploaded, or external model request sent. Consequently Cowork
module loading, generated SDK, `/redacton` registration, prompt/Read/Bash
interception, OFF warnings, Node availability/version, process execution location
and writable settings paths are **unverified**, not known to fail universally.
The available CLI is 2.1.295 with Node 22.16.0; CLI results do not qualify Cowork.

Do not package a `.plugin` or marketplace entry as evidence of support. Before
changing packaging, qualify the actual Cowork loading contract and inspect its
SDK. Then use isolated synthetic fixtures to inspect model payloads separately
from UI and stored history, including ON, OFF, permission denial, cancellation,
unknown envelopes, helper failure and both toggle-race directions. Desktop form
rendering remains [#27](https://github.com/milocosmopolitan/redacton/issues/27),
using the existing shared pure models/controllers. Host/platform dependencies
remain [#47](https://github.com/milocosmopolitan/redacton/issues/47) and
[#50](https://github.com/milocosmopolitan/redacton/issues/50).

## Installation is not activation

Installed means files passed archive integrity checks. Scanner-ready means the
helper self-check passed in the install process. Active means the host actually
loaded Mod hooks; supported additionally requires qualified interception on that
host/runtime. These states are independent. Installers now explicitly say
protection is inactive until loading and direct CLI users to `/redacton` and
**Protect ready**. Even that status is scoped to the supported boundaries.

An inactive Mod cannot render its own warning. `commands/*.md` therefore contain
conspicuous INACTIVE fallback instructions and retain
`disable-model-invocation: true`. They are text stubs, not scanners or a verified
host preflight; they must not consume or echo arguments or imply scanning.
Never place credentials in slash arguments because the host can persist them
before local rejection. A host ignoring frontmatter may still invoke a model;
fallback text is not a technical guarantee against that host behavior.

## Command authority evidence

Markdown command frontmatter does not apply to dynamically registered Mod
commands automatically. Command provenance must come from the generated host
SDK, never from slash text, arguments, or a claimed user identity in model output.
Read-only status and enabling/recovery must remain available. Disabling and
opening mutation controls require an explicit host user origin where enforceable;
Apply/import/save remain local form actions rather than command arguments.

The generated SDK for 2.1.294 and 2.1.295 declares `CommandRunInput.origin` as
the host's `PromptOrigin`: composer is the local user gesture, SDK is automation,
and plugin calls are stamped plugin. `CommandRunArgs` omits origin. Reducing
protection or opening settings now accepts only the exact composer origin;
unknown, SDK, bridge, schedule and plugin origins are refused with a fixed local
message. Remote bridge mutation is intentionally not qualified. `/redacton` and
cached status remain usable from automation. No slash arguments are echoed.

On **2.1.295 / Node 22.16.0 / macOS ARM64**, `authority-host.mjs` verified SDK
OFF denial and ON recovery with zero model requests. The actual companion's
nested plugin command attempts, including a forged composer origin object, were
refused. The SDK documents refusal inside a hook the turn waits on, so this
particular result does not prove an idle plugin call reached Redacton's guard.
A companion `command.run` hook rewriting `next`'s SDK origin to composer was
rejected by the actual host. SDK regressions separately verify plugin/SDK guards
against OFF and each management entry without helper dispatch or pane opening.

`routes-host.mjs model-off` and `model-config` forced model Skill attempts to run
`redactoff` and `redact:config` after synthetic injected instructions claimed user
authority. Each produced a tool error, two loopback model requests and no Mod
management execution. This does not prove arbitrary future host tools cannot
invoke commands. Actual terminal 140- and 80-column OFF/ON tests confirmed immediate and
persistent OFF warnings while typing and after a Bash operation, clearing on ON,
restoring on repeated OFF, and zero model requests. The OFF CI gate requires both
terminal cases. Automation OFF probes are explicitly
labelled SDK denial, never evidence of actual user OFF.

SDK test events prove handler behavior only. No claim
of protection against arbitrary host plugins, an OS process editing files, or a
host that falsifies provenance follows from an origin guard. Permission checks
and external-tool authentication remain the host's responsibility.
