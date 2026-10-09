# Redacton

Experimental local credential protection for Claude Code prompt text/context, Read text, and Bash stdout/stderr, using Redact Secret. `/redacton` requests ON; `/redactoff` bypasses scans for future operations in the current session.

**Protection is conditional on the functioning host and outer guard. Original prompts/tool arguments can remain in host storage, and encoded credentials can be missed. This is not production-ready.** [Compatibility and exact historical evidence](docs/COMPATIBILITY.md) explain the qualified scope and exclusions.

## Try the published alpha

Download the artifact and `SHA256SUMS` from [v0.1.0-alpha.1](https://github.com/milocosmopolitan/redacton/releases/tag/v0.1.0-alpha.1), verify the checksum, extract it, and run `claude --plugin-dir <extracted-directory>`. The release was qualified on Claude Code 2.1.294, macOS ARM64, Node 22.16.0. Other platforms/hosts and Desktop are not advertised as supported. Current source changes do not silently replace the published artifact.

Requested ON is distinct from loading/ready/unavailable. Unsupported selected envelopes, invalid helper replies and scanner/process failures withhold selected content under the qualified guard conditions. Running operations retain their captured policy. Recognized private keys block the entire event; zero findings means no recognized findings, not safe content.

OFF displays both immediate feedback and this prompt-area warning:

> ⚠ Redacton OFF — credential protection disabled

Commands take no arguments. New/resumed/branched CLI sessions request ON; there is no saved global OFF preference. MCP, other tools, authentication/tool arguments, binary/audio/images, PII, vault/restore and old history are outside coverage. Blocking returned output does not undo tool effects.

## Develop

See [CONTRIBUTING](CONTRIBUTING.md) for build, type/lint and test commands, and [ARCHITECTURE](ARCHITECTURE.md) for runtime boundaries.

- `mod/`: typed host registration, state, protocol and pure adapters.
- `helper/src/`: typed Node helper; generated distribution output stays separate.
- `tests/`: unit and host SDK regressions.
- `qualification/`: reusable actual-host regressions and the independent pilot plan.
- `benchmarks/`: synthetic corpus and source/license provenance.

Use [private GitHub reporting](https://github.com/milocosmopolitan/redacton/security/advisories/new) for vulnerabilities and the existing maintainer email in [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) for conduct concerns. Public issues are not confidential. [MIT](LICENSE), [dependency notices](THIRD_PARTY_NOTICES.md), [security policy](SECURITY.md), and [agent rules](AGENT.md) apply.
