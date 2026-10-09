import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionState,
  record,
  requestProtection,
  setReadiness,
  snapshot,
} from '../../mod/state.ts';

test('sessions including restored/branched identities start requested ON and loading', () => {
  for (const id of ['new', 'restored', 'branch']) {
    assert.deepEqual(snapshot(createSessionState(id)), {
      sessionId: id,
      requestedProtection: true,
      readiness: 'loading',
      policyEpoch: 0,
    });
  }
});

test('both toggle directions preserve immutable in-flight policy and isolate sessions', async () => {
  const first = createSessionState('first');
  const second = createSessionState('second');
  setReadiness(first, 'ready');
  const capturedOn = snapshot(first);
  requestProtection(first, false);
  const capturedOff = snapshot(first);
  requestProtection(first, true);
  setReadiness(first, 'unavailable');
  await Promise.resolve();
  assert.equal(capturedOn.requestedProtection, true);
  assert.equal(capturedOn.readiness, 'ready');
  assert.equal(capturedOff.requestedProtection, false);
  assert.equal(second.policyEpoch, 0);
  assert.equal(second.readiness, 'loading');
  assert.throws(() => {
    Object.defineProperty(capturedOn, 'requestedProtection', { value: false });
  }, TypeError);
  const epoch = first.policyEpoch;
  requestProtection(first, true);
  setReadiness(first, 'unavailable');
  assert.equal(first.policyEpoch, epoch);
});

test('recent records are bounded and never retain arbitrary input fields', () => {
  const state = createSessionState('s');
  for (let i = 0; i < 105; i++) {
    const event = {
      errorCode: 'SCANNED',
      count: i,
      text: 'private',
      path: '/private',
    };
    record(state, event);
  }
  assert.equal(state.recent.length, 100);
  assert.deepEqual(state.recent[0], { errorCode: 'SCANNED', count: 5 });
  assert.throws(() => record(state, { errorCode: 'raw exception!', count: 1 }));
  assert.throws(() =>
    record(state, { errorCode: 'SECRET_MATERIAL', count: 1 }),
  );
  assert.throws(() => record(state, { errorCode: 'FAILED', count: -1 }));
});
