# Redacton

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](ARCHITECTURE.md)
[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.294-D97757)](docs/COMPATIBILITY.md)
[![Powered by Redact Secret](https://img.shields.io/badge/Powered_by-Redact_Secret-6D28D9)](https://github.com/redact-secret/redact-secret)

Keep recognized credentials out of supported Claude Code model inputs. Redacton scans prompt text/context, Read text, and Bash stdout/stderr, replacing detected credentials with placeholders. Recognized private keys block the entire event.

Powered by **[Redact Secret](https://github.com/redact-secret/redact-secret)**, a deterministic Rust detection engine with native and WebAssembly runtimes. Scanning runs locally, without sending content to a detection service. Explore [Redact Secret](https://www.redactsecret.com) for local redaction in your own apps, and [star the project](https://github.com/redact-secret/redact-secret) to support it.

## Install in two minutes

Have **Claude Code and Node.js 22** installed on **macOS Apple Silicon**. The verified combination is Claude Code **2.1.294** and Node **22.16.0**; other platforms, host versions and Desktop have not been qualified. Required follow-on support targets macOS x64, Linux x64/ARM64 and Windows x64/WSL; those targets are not supported by this installer.

```bash
curl -fsSL https://raw.githubusercontent.com/milocosmopolitan/redacton/main/scripts/install.sh | bash
claude --plugin-dir "$HOME/.local/share/redacton/current"
```

The installer downloads the published package, verifies its pinned checksum, and installs it without npm or a build step. You can [inspect the installer](scripts/install.sh) or download packages from [Releases](https://github.com/milocosmopolitan/redacton/releases).

The `--plugin-dir` option loads Redacton for that Claude Code launch. Use the same launch command for future sessions.

## Use it

After launch, run `/redacton` and confirm **Protect ready** before your first task.

New, resumed and branched CLI sessions start with protection requested **ON**. Readiness is shown separately as loading, ready or unavailable.

| Command | Effect |
| --- | --- |
| `/redacton` | Request protection for subsequent supported operations. |
| `/redactoff` | Bypass scans for subsequent operations in this session. |
| `/redact:status` | Show cached readiness, coverage, rules and recent outcomes. |
| `/redact:config`, `/redact:add-rule`, `/redact:remove-rule` | Manage custom formats through local forms. |

**Commands take no arguments. Never paste secrets, patterns or test text into slash-command arguments; the host can store them before local rejection.** Running operations keep the policy they started with. OFF displays a prompt-area warning: **⚠ Redacton OFF — credential protection disabled**.

Custom rules use guided token formats or assignment names. Validate, inspect synthetic sample outcomes, then explicitly Apply session; personal/project saving and portable import/export are separate actions. **Confirm the form has keyboard focus before typing, and close it before ordinary chat. Never enter actual credential values as rule definitions.** See [configuration and scope](docs/CONFIGURATION.md).

## Know the boundaries

Protection depends on the functioning host and outer guard. Unsupported selected results and scanner failures withhold content under those guard conditions; a host that bypasses all guards can expose it.

**Original prompts and tool arguments can remain in host storage. Encoded credentials can be missed, and zero findings does not mean safe content.** MCP, other tools, tool arguments, binary/image/audio content, PII and existing history are outside coverage. Withholding output does not undo a tool's effects.

See [compatibility and evidence](docs/COMPATIBILITY.md) and the [threat model](docs/THREAT_MODEL.md) for exact limits. For vulnerabilities, use [private security reporting](https://github.com/milocosmopolitan/redacton/security/advisories/new); public issues are not confidential.

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Dependency notices](THIRD_PARTY_NOTICES.md) · [MIT license](LICENSE)
