# Redacton 0.1.0-alpha.1

Experimental local credential protection for supported Claude Code prompt text/context, Read text, and Bash stdout/stderr. `/redacton` requests ON with explicit readiness; `/redactoff` bypasses new operations and shows immediate and prompt-area warnings. Operations retain their captured state. Recognized private keys block the whole selected event.

Qualified host scope: **Claude Code/SDK 2.1.294, macOS ARM64, Node 22.16.0**. Node 24.21.0 passed the 25 helper/protocol/state/adapter tests separately; it does not qualify a Node 24 host. Linux, Windows, Desktop, other versions/architectures and interactive watch/reload are excluded.

Actual host evidence separates model payload, transcript/storage and terminal UI. ON prompt/Read/Bash markers were absent from supported model payloads. OFF scanning bypass, both policy races, strict protocol, 11 fault modes, actual automatic permission refusal, resumed/branched sessions, and SIGINT before/after helper dispatch are recorded. The normal terminal OFF warning remained after typing and actual core Bash activity. Companion probes are explicitly distinguished from the shipped product.

**Limits:** the host can bypass every failing guard; layered protection is conditional on the functioning host and outer guard. Original prompts and tool arguments can remain in host storage. Plaintext exists temporarily in memory; inherited process environment is not cleaned. The 29-case curated assessment has one base64 credential miss and is not production-accuracy proof. No production-readiness, all-tools, MCP, PII, vault/restore, live validation or telemetry claim is made.

Download `redacton-alpha-1-evaluation.tar.gz` with its accompanying `SHA256SUMS` and verify `shasum -a 256 -c SHA256SUMS` before extraction. Load the extracted plugin directory with `claude --plugin-dir <directory>`. It contains the prebuilt helper, exact pinned dependencies, project license and dependency notices; lifecycle-script compilation is unnecessary. Artifact-specific identifiers and clean-install evidence accompany the release.

Report vulnerabilities through [private GitHub reporting](https://github.com/milocosmopolitan/redacton/security/advisories/new). The maintainer conduct address and conflict-review policy are in CODE_OF_CONDUCT.md; address provenance does not guarantee response or confidentiality.

Three independent installations and seven-day follow-up remain a planned pilot. No simulated users, maintainer demonstrations, CI or downloads are counted as adoption. This file prepares release communication; publication occurs only when the root orchestration creates the prerelease with its verified artifact.
