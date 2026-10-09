---
scope: workspace
status: accepted
---

# Continue integration with an independent trusted-result guard

## Context

The first single-layer spike exposed original Bash output when both its handler and catch threw. Decision 0001 stopped dependent implementation pending a solution. Further research and actual host testing established that an independent outer hook can block this inner failure.

## Decision

Supersede 0001's blanket integration stop with the qualified layered design. The outer hook captures operation policy and associates an operation slot by immutable agent/tool/invocation identity, scoped to the registration. Inner processing publishes only a completely validated, allowlisted sanitized envelope or fixed denial. The outer hook ignores next's ON result and returns only its trusted slot, otherwise a fixed denial. Both catch handlers are constant responses without SDK/helper calls, awaits, or input inspection.

Captured OFF operations bypass scanning and retain original behavior; changing the current toggle cannot reinterpret an in-flight operation. Actual resumed/branched CLI processes request ON. Fresh registration/session-start and in-process clear/resume reset are defined and SDK-tested. A functional module edit did not reload the evaluated print-stream process; its existing OFF state remained OFF. Interactive watch/reload is not qualified. Bound scanner work and preserve host permissions without tool retries.

## Assurance boundary

The host skips invalid, thrown, or timed-out hooks and can bypass a failing catch. No host-enforced fail-closed primitive exists in the evaluated SDK. This design qualifies tested scanner/protocol/adapter/inner-handler failures under a functioning host and static outer catch. It cannot guarantee simultaneous failure of all guards, plugin disablement, or a compromised host/runtime. These exclusions must remain prominent in onboarding and release evidence.

Keep model payload, UI, and transcript/storage results separate. Publish only the actually qualified scope. Independent pilots remain external evidence requiring real users and elapsed time.
