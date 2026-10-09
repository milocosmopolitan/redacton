# Local recovery and refusal scope

`/redacton` performs one explicit recovery attempt: if personal settings failed to load, load that scope once, then self-check the exact active configuration. Concurrent commands share the attempt. There is no background retry loop, sleep or empty/default fallback after a failed load. Selected ON operations started during explicit recovery are withheld. Cached status never invokes a helper.

A successful load restores approved custom rules. A later session Apply takes precedence over a pending personal load. OFF cancels pending activation/readiness writes, remains session-only, and bypasses helper dispatch. Session reset invalidates old loads and checks. Scanner health observations are bound to session generation, exact active revision and health epoch; a successful concurrent scan cannot clear a systemic failure, and an old failure cannot overwrite a newer recovery.

`SETTINGS_BUSY`, `TIMEOUT`, process refusal and unavailable/invalid settings responses remain unavailable until the local cause is resolved and `/redacton` is run. `SETTINGS_CORRUPT`, `INVALID_CONFIG` and `NAMES_ACTION_CONFLICT` show local repair guidance: restore valid approved personal settings, or explicitly remove that scope file to reset its custom rules, then retry. This is a deliberate local user action, not automatic deletion or silent loss of rules. Invalid engine/protocol replies never activate a configuration.

## Closed scan failure taxonomy

Only validated fixed codes from a sanitize operation have event-local semantics: `INPUT_LIMIT`, `OUTPUT_LIMIT`, `FINDING_LIMIT`, `PRIVATE_KEY_BLOCKED`, `RULE_BLOCKED`, `CANCELLED`, `QUEUE_SATURATED` and local `UNSUPPORTED_SHAPE`. The event is withheld in full. They do not assert scanner failure and the next supported event can scan using the same configuration. Cancellation of a dispatched child cannot terminate it with the installed API; it may continue until the configured timeout. Queue refusal dispatches no new child. Extraction refusal supplies no partial output.

All other sanitize failures, including `ENGINE_VERSION`, `ENGINE_UNAVAILABLE`, `ENGINE_RESPONSE`, `ENGINE_FAILURE`, `POLICY_FAILURE`, invalid configuration, invalid request/protocol/JSON, `INPUT_FAILURE`, `TIMEOUT`, and process failure, invalidate matching current scanner health. Timeout/process failure is not presumed event-local. Subsequent selected ON content is withheld until a successful explicit bounded self-check. No arbitrary exception text is classified, displayed or recorded.

Readiness and the last refused operation are separate: status shows cached scanner health and fixed-code recent outcomes; the prompt indicator shows the most recent refusal code. An operation failure returns no original or partial content. Configuration validation/preview failures stay in the local draft workflow and do not disable a different active approved revision.

## Evidence and limits

Current SDK regressions inject first-load lock, timeout and process faults; verify same-session recovery with exact approved rules/revision; hold concurrent retry/OFF/reset races; and test event-local refusals plus systemic failure/recovery and concurrent scanner outcomes. Existing resource tests exercise saturation, malformed envelopes, cancellation-related guards, and session reset. These synthetic SDK-chain tests do not prove actual model/transcript/UI interception on every host, Desktop or other platforms. Historical qualification remains unchanged.
