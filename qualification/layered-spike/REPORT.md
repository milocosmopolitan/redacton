# Layered-boundary follow-up

This experiment qualifies a defense against failure of the inner hook and its catch handler on Claude Code 2.1.294. It does not erase the earlier single-layer failure or qualify Alpha 1 for release.

## Actual loopback evidence

```sh
rtk proxy claude plugin validate --strict qualification/layered-spike
rtk proxy node qualification/layered-spike/mock-host.mjs
rtk proxy node qualification/layered-spike/mock-host.mjs 'printf SPIKE_RAW # spike-catch-throw'
```

Strict validation passed. Both loopback runs completed with exit code 0, two requests and one tool result. Both reported `promptReplaced: true`, `rawInPromptMessages: false`, and `rawInToolResults: false`. Normal replacement reported `sanitizedInToolResults: true`; deliberate inner hook and catch failure reported `blockedInToolResults: true`. No paid model calls or real credentials were used. The same synthetic-only, bounded, isolated in-memory endpoint design as the original spike is used.

## Boundary design

The outer hook is registered first with matcher `{ tool: ['Read', 'Bash'] }`. The inner hook uses the distinct matcher `{ tool: 'Bash' }`, accepted by strict host validation. A shared operation map is keyed by immutable `e.tool_use_id`.

The inner hook publishes only a completely rebuilt synthetic sanitized envelope into the map. The outer hook ignores the envelope returned by `next`, and returns the trusted published envelope or a fixed denial if no envelope was published. It clears the map entry before dispatch and in `finally`. Its catch handler is a constant fixed denial with no SDK calls, helper calls, awaits, argument inspection, or throwable application code.

Ignoring the `next` answer is essential: merely checking a boolean completion flag and then returning `next` could accept an original envelope if the host rejects the inner replacement after the flag was set. A production implementation must publish only fully validated outputs, reject unknown operation identity, capture ON/OFF state at operation start, and bound outstanding operation records. This experiment has no scanner and intentionally replaces every supported result with a fixed synthetic value.

## What remains impossible and what can proceed

The installed SDK contract says thrown, timed-out and invalid hooks are skipped. A hook receives 10,000 ms of its own execution budget; its catch receives 1,000 ms. If that catch fails or exceeds its grace, the host continues as though it were absent. No mandatory host fail-closed mode or permanent withholding primitive was found in the installed generated types or official event/reference documentation. An arbitrary simultaneous failure of the outer handler and its static catch can still bypass all plugin guards. More wrapper layers do not change that host contract.

The initial experiment deliberately introduced application code that throws in catch. A production constant catch does not have that deliberate fault and can defensibly address scanner/helper/adapter errors under tested normal host execution. This is a meaningful narrower assurance, with a required explicit exclusion for host/runtime failure or plugin disablement. The original stronger absolute failure contract remains unresolved.

Recommendation: continue offline helper, adapters, state and isolated experimental integration under requested ON plus unavailable readiness. Use the layered boundary for experiments; keep release readiness false until product-specific fault injection, Read/stderr, permission, concurrency, cancellation, toggle and UI qualification pass and the supported failure scope is explicitly settled. Do not claim arbitrary host failure is fail closed.

Sources: [official events](https://code.claude.com/docs/en/plugins/mods/events), [official reference](https://code.claude.com/docs/en/plugins/mods/reference), and generated `claude-code/index.d.ts` for 2.1.294 (`EngineEventOf`, `HookBudget`, `Registration`, `Next`).
