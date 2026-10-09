---
scope: workspace
status: accepted
---

# Stop Alpha 1 integration when the host falls back to original content

## Context

Epic #1 requires selected ON content to be withheld when protection fails. On Claude Code 2.1.294, the synthetic loopback qualification observed original Bash output in the model request when a post-execution hook and its catch handler both failed. Successful normal replacement and successful catch denial do not satisfy that failure contract.

## Decision

Record a NO-GO for this host and stop dependent implementation and release work. Preserve a reproducible minimal probe and safe evidence in [the qualification report](../../qualification/host-spike/REPORT.md). Keep incomplete issues open; do not count this investigation as a protection feature or shipped alpha.

Reopen the integration gate only after an actual host demonstrates safe withholding for handler failures, catch failures, and invalid envelopes across every promised surface. If a future design changes the interception boundary or coverage, document and qualify that change before implementation claims.

## Consequences

There is no installable protected product from this change. Engine and trust research remain useful preparatory evidence but do not bypass #2. Model payload, transcript/storage, and UI qualification remain separate. Independent pilots follow a qualified release and cannot be simulated by agents.
