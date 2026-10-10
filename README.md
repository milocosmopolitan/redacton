# Redacton

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](ARCHITECTURE.md)
[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.294-D97757)](docs/COMPATIBILITY.md)
[![Powered by Redact Secret](https://img.shields.io/badge/Powered_by-Redact_Secret-6D28D9)](https://github.com/redact-secret/redact-secret)

Keep recognized credentials out of supported Claude Code model inputs. Redacton scans prompt text/context, Read text, and Bash stdout/stderr, replacing detected credentials with placeholders. Recognized private keys block the entire event.

Redacton targets **macOS, Linux and Windows CLI installations** with one shared Mod/helper implementation. The published verified release remains **macOS ARM64, Claude Code 2.1.294, Node 22.16.0**. Portable packages, Unix/PowerShell candidate installers and CI are development paths until each platform's actual host is qualified. See the [target and verified matrix](docs/PLATFORMS.md).

Powered by **[Redact Secret](https://github.com/redact-secret/redact-secret)**, a deterministic Rust detection engine with native and WebAssembly runtimes. Scanning runs locally, without sending content to a detection service. Explore [Redact Secret](https://www.redactsecret.com) for local redaction in your own apps, and [star the project](https://github.com/redact-secret/redact-secret) to support it.

## Install in two minutes

This command installs the existing verified **macOS Apple Silicon release**, not a universal cross-platform package.

Have **Claude Code and Node.js 22** installed on **macOS Apple Silicon**. The verified combination is Claude Code **2.1.294** and Node **22.16.0**; other platforms, host versions and Desktop have not been qualified. Required follow-on support targets macOS x64, Linux x64/ARM64 and Windows x64; WSL has no qualification path. Those targets are not supported by this installer.

```bash
curl -fsSL https://raw.githubusercontent.com/milocosmopolitan/redacton/main/scripts/install.sh | bash
claude --plugin-dir "$HOME/.local/share/redacton/current"
```

The installer downloads the published package, verifies its pinned checksum, and installs it without npm or a build step. You can [inspect the installer](scripts/install.sh) or download packages from [Releases](https://github.com/milocosmopolitan/redacton/releases).

The `--plugin-dir` option requests loading for that Claude Code launch. Use the same launch command for future sessions. Installed files and a successful helper check do not prove that the Mod is active. Confirm `/redacton` answers locally with **Protect ready**; fallback text saying **protection is inactive** means there is no interception. Cowork remains unsupported, with its activation blocker recorded in [host authority](docs/HOST-AUTHORITY.md).

Linux, Intel Mac, native Windows and WSL users should follow the [candidate installation and qualification guidance](docs/PLATFORMS.md). Native Windows and WSL are separate environments; Desktop is a separate host surface. A helper/installer success does not establish protection of model inputs.

## Use it

After launch, run `/redacton` and confirm **Protect ready** before your first task.

New, resumed and branched CLI sessions start with protection requested **ON**. Readiness is shown separately as loading, ready or unavailable.

| Command | Effect |
| --- | --- |
| `/redacton` | Request protection and make one bounded recovery attempt after a local failure. |
| `/redactoff` | From the local terminal, bypass scans for subsequent operations in this session. |
| `/redact:status` | Show cached readiness, coverage, rules and recent outcomes. |
| `/redact:config`, `/redact:add-rule`, `/redact:remove-rule` | Manage custom formats through local forms. |
| `/redactconfig` | Open the same local configuration form immediately during an active turn. |

**Commands take no arguments. Never paste secrets, patterns or test text into slash-command arguments; the host can store them before local rejection.** Running operations keep the policy they started with. OFF displays a prompt-area warning: **⚠ Redacton OFF — credential protection disabled**.

Disabling protection and opening configuration require the host's local composer origin. SDK, plugin, bridge and other origins cannot authorize these actions; `/redacton` recovery and cached status remain usable. After a transient settings/helper fault, remove its local cause and run `/redacton` in the same session. Corrupt settings require explicit local repair or scope reset. During recovery selected ON content is withheld and approved rules are retained. See [recovery and refusal scope](docs/RECOVERY.md) and [settings ownership/environment](docs/STORAGE-ENVIRONMENT.md).

Custom rules use guided token formats or assignment names. Validate, inspect synthetic sample outcomes, then explicitly Apply session; personal/project saving and portable import/export are separate actions. **Confirm the form has keyboard focus before typing, and close it before ordinary chat. Never enter actual credential values as rule definitions.** See [configuration and scope](docs/CONFIGURATION.md).

## Know the boundaries

Protection depends on the functioning host and outer guard. Unsupported selected results and scanner failures withhold content under those guard conditions; a host that bypasses all guards can expose it.

**Original prompts and tool arguments can remain in host storage. Encoded/base64 credentials can be missed, and zero findings does not mean safe content.** Grep text, Glob paths, WebFetch, Write arguments and effects, MCP, other tools, binary/image/audio content, PII and existing history are outside coverage. Withholding output does not undo a tool's effects. The [route audit](docs/COVERAGE.md) distinguishes these boundaries and links their existing adapter owners.

See [compatibility and evidence](docs/COMPATIBILITY.md) and the [threat model](docs/THREAT_MODEL.md) for exact limits. For vulnerabilities, use [private security reporting](https://github.com/milocosmopolitan/redacton/security/advisories/new); public issues are not confidential.

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Dependency notices](THIRD_PARTY_NOTICES.md) · [MIT license](LICENSE)
