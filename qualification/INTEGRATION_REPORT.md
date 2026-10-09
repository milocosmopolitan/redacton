# Experimental product integration qualification

Evaluated October 8, 2026 with Claude Code 2.1.294, generated host SDK 2.1.294, macOS Darwin 25.5.0 ARM64, and Node v22.16.0. These results qualify specific experimental behavior, not a release or Desktop support.

## Reproduce

```sh
rtk npm run build:helper
rtk npm run test:mod
rtk proxy node qualification/integration-host.mjs prompt
rtk proxy node qualification/integration-host.mjs read
rtk proxy node qualification/integration-host.mjs bash
rtk proxy node qualification/integration-host.mjs off
rtk proxy python3 qualification/terminal-ui-alternative.py
```

Each payload probe first executes the product's local `/redacton` command and requires its fixed local response with zero model requests. A failed module load therefore fails the probe before supplying the synthetic credential. The test then uses an isolated temporary host configuration, a synthetic API key, a loopback Anthropic-format streaming endpoint, the actual product Mod and actual pinned scanner helper. No paid model call, provider credential validation, or real credential is used. Child runs have a 30-second bound and temporary files are removed in `finally`. Only safe booleans, counts and logical JSON schema-field locations are printed.

## Actual model-payload and storage results

All evaluated modes had `pluginLoaded: true` and exit code 0. The prompt probe completed one model request; Read and Bash each completed two requests with one tool result. The OFF command completed locally with zero model requests.

| Surface | Actual model request | Persisted host storage |
| --- | --- | --- |
| Prompt | Original synthetic token absent; exact engine placeholder `<SECRET_1>` present | Original token remains in a `queue-operation` row's `content` field. Final user-message text is sanitized. |
| Text Read | Original token absent; `<SECRET_1>` present; result is not an error or fixed denial | No original token found in the evaluated transcript rows. This is one synthetic fixture, not an absence-of-plaintext guarantee. |
| Bash stdout and stderr | Original token absent; `<SECRET_1>` present; result is not an error or fixed denial | The excluded original Bash command arguments remain in assistant `tool_use.input.command`. Original token absent from evaluated persisted `tool_result` blocks. |
| `/redactoff` | No model request | Immediate fixed OFF warning observed in local command output. |

Read/Bash use an ordinary prompt, so storage observations can distinguish the original tool output from prompt retention. Tool arguments deliberately contain the synthetic token and are outside the protection boundary. The payload probe examines tool-result blocks independently from tool-use inputs. Transcript findings separately examine user text, tool-use arguments, tool results, and all other row fields; the logical field locations contain no input values or filesystem paths.

## Actual Bash schema adjustment

A plugin-origin `$.tool.call` omits optional undefined fields, while a model-origin Bash result includes them as own keys. A qualification-only shape probe established exact key names, value types and safe boolean flags without printing output content.

Supported normal synchronous Bash results contain stdout/stderr strings, interrupted boolean, `isImage: false`, and optional `noOutputExpected` boolean. The adapter recognizes the inspected installed optional field names only when their values are undefined, then discards them. Any populated raw/persisted path, background data, binary/image flag, structured content, unsupported hint, or unknown key is withheld. The rebuilt model result contains only sanitized stdout/stderr and interrupted. No raw alias or original ref is returned.

`rtk proxy node qualification/integration-host.mjs bash shape-only` inspects a separate synthetic shape fixture, **not the product Mod**, and must not be counted as product qualification.

## SDK event-chain tests

The product SDK test runner passed 22 tests across two files at this checkpoint. These use host event chains with stubbed process/core results; they do not establish real child failures or permission dialogs.

Covered behaviors include prompt replacement before submission; OFF helper bypass and immediate warning; denied/malformed/truncated/mismatched helper responses; duplicate/missing segments and unknown status/count types; failed readiness checks; a four-helper concurrency bound; same tool invocation ID in different agents; both mid-flight ON/OFF toggle directions using a paused core operation; preservation of a host refusal without scanner dispatch; no tool reexecution after failed helper responses; and ON reset/readiness recheck after session start, clear and resume boundaries. The terminal AbovePrompt render tree contains the persistent OFF warning.

The SDK test kit does not automatically supply actual prompt `wait` and `origin` fields. Tests explicitly provide a normalized host event to verify the strict adapter; this avoids weakening the production schema for an incomplete test fixture.

## Actual UI, sessions, and interruption

The first PTY attempt stalled at onboarding. Subsequent actual normal-terminal qualification passed: the OFF warning remained on a decoded 40×140 screen after typing and an actual core Bash call while OFF, disappeared on ON, and returned on repeated OFF. Tool activity used a qualification-only companion local SDK command; it is not part of the shipped product. Separate screen-reader qualification proved visible next-prompt output. See [UI evidence](ui-report.md) and its reproduction instructions; Desktop, Linux and Windows remain unevaluated.

Actual resume and fork-session CLI runs requested ON and sanitized new prompts. A same-process streaming OFF test observed helper dispatch count unchanged at one initial readiness call and the explicit raw OFF behavior. Actual SIGINT before/after helper dispatch issued no subsequent model requests or tool-result delivery; the delayed child was gone after 2,200 ms. These are CLI process observations, not an interactive resume menu, Esc gesture, or immediate child-termination guarantee. See [session/interruption evidence](SESSION_REPORT.md).

The current-source print-stream reload probe made a functional edit to a temporary Mod copy, but no reload occurred: helper dispatch count stayed one, no reload notice appeared, and the existing OFF state remained OFF. Fresh module registration/session.start reset behavior is SDK-tested; this probe does not qualify an interactive file watcher. See [exact reload observations](hot-reload-host-report.json).

Nine actual helper/tool faults and one prompt fault withheld selected content, including timeout, missing helper, malformed/mismatched/duplicate/missing protocol fields, policy failure and oversized stdout. Executed Bash ran once. See [fault evidence](failure-host-report.md). The SDK test API provides no declared AbortSignal injection; real subprocess SIGINT is recorded separately from SDK races/concurrency tests.

## Remaining release conditions

An actual missing-Node executable fault reported unavailable and generated zero model requests/tools. [Actual automatic Bash refusal](permission-denied-host-report.json) under dontAsk without an allow rule executed zero times, preserved arguments and returned an errored fixed denial. This is not a live permission dialog. Twenty-five Node tests passed on Node 22.16.0 and verified Node 24.21.0; Node 24 qualifies helper/protocol/state/adapters only.

The clean extracted artifact passed strict validation, `npm ci --ignore-scripts`, native helper execution, and native-free WASM fallback. Its runtime manifest omits development scripts. Final archive identifiers must be regenerated after documentation freezes and accompany publication; exact installation checks and closure conditions are in [the acceptance ledger](ACCEPTANCE.md). The print-stream no-reload result is a documented scope limit; unrelated platforms remain excluded.

The extracted candidate artifact additionally passed four actual host modes: prompt, Read, Bash and local OFF. [Packaged-host evidence](packaged-host-report.md) records its archive identity and 86 verified runtime/dependency file hashes. A final rebuild may change documentation/archive identity; runtime equivalence must be checked against those evaluated hashes rather than silently treating a different archive as the tested one.

The earlier single-layer deliberate catch failure and successful layered follow-up remain documented in their own reports. Production guards use static fixed fallback responses and trusted reconstructed outputs. The host can still skip a guard if the outer handler and its catch both fail or the plugin is disabled; no arbitrary-host-failure guarantee is made.

Publication requires the final artifact checks and identifiers with the acceptance ledger satisfied. Original prompt persistence in host queue-operation storage is a confirmed limitation and must accompany the model-context protection claim. Three independent installations and seven-day follow-up remain separate uncollected pilot evidence.
