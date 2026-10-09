import type { ActiveConfiguration } from './config.ts';
import type { SessionState } from './state.ts';

export interface StatusView {
  readonly protection: 'ON' | 'OFF';
  readonly readiness: 'loading' | 'ready' | 'unavailable';
  readonly observedAt: number | null;
  readonly readinessNote: 'CACHED_OBSERVATION_NOT_HEALTH_CHECK';
  readonly customRuleCount: number;
  readonly ruleIds: readonly string[];
  readonly source: ActiveConfiguration['source'];
  readonly scope: ActiveConfiguration['scope'];
  readonly revision: string;
  readonly supported: readonly string[];
  readonly excluded: readonly string[];
  readonly recent: readonly Readonly<{ code: string; count: number }>[];
  readonly zeroFindingsNote: 'ZERO_FINDINGS_NOT_SAFE_CONTENT';
}
export function statusView(
  state: SessionState,
  config: ActiveConfiguration,
  observedAt: number | null,
): StatusView {
  return Object.freeze({
    protection: state.requestedProtection ? 'ON' : 'OFF',
    readiness: state.readiness,
    observedAt:
      observedAt !== null && Number.isSafeInteger(observedAt) && observedAt >= 0
        ? observedAt
        : null,
    readinessNote: 'CACHED_OBSERVATION_NOT_HEALTH_CHECK',
    customRuleCount: config.rules.length,
    ruleIds: Object.freeze(config.rules.map((rule) => rule.id)),
    source: config.source,
    scope: config.scope,
    revision: config.revision,
    supported: Object.freeze([
      'PROMPT_TEXT_CONTEXT',
      'READ_TEXT',
      'BASH_STDOUT_STDERR',
    ]),
    excluded: Object.freeze([
      'MCP_OTHER_TOOLS',
      'TOOL_ARGUMENTS',
      'BINARY_IMAGE_AUDIO',
      'PII',
      'EXISTING_HISTORY',
    ]),
    recent: Object.freeze(
      state.recent
        .slice(-100)
        .map((event) =>
          Object.freeze({ code: event.errorCode, count: event.count }),
        ),
    ),
    zeroFindingsNote: 'ZERO_FINDINGS_NOT_SAFE_CONTENT',
  });
}
export function removalView(
  config: ActiveConfiguration,
  id: string,
): Readonly<{
  id: string;
  source: ActiveConfiguration['source'];
  scope: ActiveConfiguration['scope'];
  removable: boolean;
  impact: string;
}> | null {
  if (!config.rules.some((rule) => rule.id === id)) return null;
  return Object.freeze({
    id,
    source: config.source,
    scope: config.scope,
    removable: config.scope === 'session',
    impact: 'REMOVES_ADDITIONAL_RULE_BUILTINS_MAY_STILL_MATCH',
  });
}
