# Supported and unprotected routes

Redacton selects prompt text/context, Read text (including required result path)
and Bash stdout/stderr. Tool arguments/authentication and existing history are
outside interception. Encoded credentials, including base64, can be missed;
zero findings is not an accuracy or safety guarantee.

## Actual CLI audit

`node qualification/routes-host.mjs <grep|glob|write|webfetch|mcp>` runs isolated
synthetic fixtures and a loopback model, prints only counts/booleans/runtime
identity, and removes the temporary tree. On 2026-10-09, **Claude Code 2.1.295,
Node 22.16.0, macOS ARM64**, each route had a ready Mod preflight, an offered
tool, exit code 0, two model requests and one tool result:

| Route | Observed boundary | Result |
| --- | --- | --- |
| Grep / Glob | Grep content text / Glob file names | Synthetic marker reached model in both. Glob did not read the file body. |
| Write | Content argument and local filesystem side effect | Written file contained marker; result did not. Result scanning cannot undo this write. |
| MCP | Local synthetic stdio server text result | Marker reached model. This says nothing about remote-server authentication. |
| WebFetch | URL argument, network request and page result | Loopback URL was refused, result was an error, zero GETs. Successful page-result exposure remains unqualified. |

The marker was an unmistakably synthetic credential-shaped string, never a real
credential. The Grep fixture requests `output_mode: content`; its leak is content,
not just a count/path. Glob uses a credential-shaped filename with innocuous file
body, separating metadata exposure from file contents. Write checks the actual
file after execution, not the tool's success message. The MCP server is local and
requires no external authentication or network service. WebFetch's denied test
must not be described as proof of a successful content route or as protection.
Cowork, Desktop and other platforms are not qualified by this audit.

Original prompt/arguments and tool output may remain in host transcripts/storage.
This runner does not claim transcript cleanup or that absence from a model result
means absence from storage. Withholding after execution cannot reverse outbound
requests, local writes or other tool side effects.

## Expansion order and owners

Grep content is the next direct content-reading candidate, but requires its own
actual host result contract rather than the Bash/Read envelope. Glob deserves a
separate metadata/path decision. Write needs an argument/side-effect boundary,
not a return-value scanner; automatic argument/auth rewriting is not proposed.
WebFetch and MCP/API adapters stay with
[#51](https://github.com/milocosmopolitan/redacton/issues/51), and `@mention`/
attachment ingestion stays with
[#42](https://github.com/milocosmopolitan/redacton/issues/42). No adapter is added
by this audit, and those owners should incorporate these concrete findings.

Every expansion must qualify allowlisted result envelopes with no raw aliases,
permission denial, cancellation, helper/guard failures, actual model payload and
both ON/OFF race directions. Keep content-reading, metadata, outbound arguments,
side effects and history as separate claims. This review introduces no repository
history scanning, live provider credential validation or transcript cleanup.
