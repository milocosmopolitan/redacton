export type Readiness = 'loading' | 'ready' | 'unavailable';

export interface RecentEvent {
  errorCode: string;
  count: number;
}
export interface SessionState {
  sessionId: string;
  requestedProtection: boolean;
  readiness: Readiness;
  policyEpoch: number;
  recent: Readonly<RecentEvent>[];
}
export type OperationSnapshot = Readonly<Omit<SessionState, 'recent'>>;

const readinessValues = new Set(['loading', 'ready', 'unavailable']);
const errorCodes = new Set([
  'SCANNED',
  'FAILED',
  'UNSUPPORTED_SHAPE',
  'INVALID_RESPONSE',
  'INVALID_REQUEST',
  'INPUT_LIMIT',
  'OUTPUT_LIMIT',
  'FINDING_LIMIT',
  'TIMEOUT',
  'ENGINE_VERSION',
  'ENGINE_UNAVAILABLE',
  'ENGINE_RESPONSE',
  'ENGINE_FAILURE',
  'POLICY_FAILURE',
  'PRIVATE_KEY_BLOCKED',
  'HELPER_UNAVAILABLE',
  'CANCELLED',
  'QUEUE_LIMIT',
  'QUEUE_SATURATED',
  'RULE_BLOCKED',
  'INVALID_CONFIG',
  'NAMES_ACTION_CONFLICT',
  'INVALID_JSON',
  'INPUT_FAILURE',
  'INVALID_HELPER_RESPONSE',
]);

export function createSessionState(sessionId: string): SessionState {
  if (typeof sessionId !== 'string' || !sessionId.length)
    throw new Error('INVALID_SESSION');
  return {
    sessionId,
    requestedProtection: true,
    readiness: 'loading',
    policyEpoch: 0,
    recent: [],
  };
}

export function snapshot(state: SessionState): OperationSnapshot {
  return Object.freeze({
    sessionId: state.sessionId,
    requestedProtection: state.requestedProtection,
    readiness: state.readiness,
    policyEpoch: state.policyEpoch,
  });
}

export function requestProtection(
  state: SessionState,
  enabled: boolean,
): OperationSnapshot {
  if (typeof enabled !== 'boolean') throw new Error('INVALID_STATE');
  if (state.requestedProtection !== enabled) {
    state.requestedProtection = enabled;
    state.policyEpoch += 1;
  }
  return snapshot(state);
}

export function setReadiness(
  state: SessionState,
  readiness: Readiness,
): OperationSnapshot {
  if (!readinessValues.has(readiness)) throw new Error('INVALID_READINESS');
  if (state.readiness !== readiness) {
    state.readiness = readiness;
    state.policyEpoch += 1;
  }
  return snapshot(state);
}

export function record(
  state: SessionState,
  event: RecentEvent,
): Readonly<RecentEvent> {
  if (
    !event ||
    !errorCodes.has(event.errorCode) ||
    !Number.isSafeInteger(event.count) ||
    event.count < 0
  ) {
    throw new Error('INVALID_RECORD');
  }
  // Project fixed metadata; never copy arbitrary diagnostic or input fields.
  const safe = Object.freeze({
    errorCode: event.errorCode,
    count: event.count,
  });
  state.recent.push(safe);
  if (state.recent.length > 100)
    state.recent.splice(0, state.recent.length - 100);
  return safe;
}
