---
scope: workspace
status: accepted
---

# Recover protection without widening its authority or delivery boundary

Failed settings loading must be recoverable within the session, while selected ON
content remains withheld until approved settings and scanner readiness are valid.
Use one explicit, coalesced `/redacton` attempt, not an unbounded retry loop or
empty/default substitution. One narrow, amended exception covers a transient
scanner resource failure (helper `TIMEOUT` or process failure): the next selected
operation may run at most two bounded self-checks per failure episode, at least
3 s and then at least 10 s after the previous failure, before it snapshots
readiness. It never runs for OFF, settings failures or deterministic scanner
faults, uses the host clock (unreadable means no attempt), shares the explicit
recovery's coalescing, and operations between attempts stay withheld. Bind asynchronous activation and health observations
to session generation, immutable configuration revision and health epoch. OFF and
session reset invalidate stale activation; successful scans do not clear a
systemic failure. Invalid saved settings require deliberate local repair/reset.

Classify only validated fixed codes for a known operation. Sanitize limits,
private-key/custom-rule blocking, cancellation, queue saturation and unsupported
extraction refuse the affected event without poisoning scanner health. Engine,
configuration, helper, protocol and timeout failures require a bounded
self-check: explicit, or the limited automatic attempts above for transient
resource failures. An arbitrary exception string is never evidence of harmlessness.
Management validation errors remain separate from an already approved revision.

Disabling protection and opening mutation controls require the host-stamped local
composer origin. SDK/bridge/plugin invocations cannot authorize those actions;
enabling/recovery and read-only status remain available. Declarative changes still
require local validation, synthetic preview and explicit Apply. Origin checks do
not defend against a compromised host, arbitrary same-user filesystem access or a
trusted plugin bypassing every guard. Markdown stubs must announce inactive
protection, because an unloaded Mod cannot render its own warning.

Use versioned settings leases binding nonce, host/PID namespace and observed
process start, retaining atomic acquisition, revision/document CAS and identity
revalidation. Foreign, unreadable or legacy ownership stays busy; a TTL never
authorizes removal of a live lease. A separate private scope with reviewed rules
is the explicit indeterminate-recovery route. Non-Linux shared hosts and Windows
ACL privacy have documented unsupported/deployment boundaries.

Retain process-per-event helpers with four pending calls, 2,000 ms for scans and
self-checks, and 5,000 ms for settings/transfer operations. Actual cold Windows
ownership-probe failures justify the bounded settings split rather than a daemon
or prewarming-only gate. Stdin reading/parsing remains 2,000 ms; a strictly
validated settings request gains only the remaining absolute 5,000 ms deadline,
with the parent enforcing the entire launch. Failed recovery keeps active rules
and withholds selected ON content. Clear inherited Node startup options and search overrides, while disclosing
that the SDK environment is an overlay. Known undefined Bash metadata is removed
by trusted reconstruction; populated aliases and unknown fields remain withheld.
Cowork and additional tool routes require their existing independent evidence
gates rather than extrapolation from installation or CLI tests.
