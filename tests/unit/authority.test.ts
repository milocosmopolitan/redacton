import assert from 'node:assert/strict';
import test from 'node:test';
import { isExplicitLocalUser } from '../../mod/authority.ts';

test('only attested composer origin permits reducing protection', () => {
  assert.equal(isExplicitLocalUser({ kind: 'composer' }), true);
  for (const origin of [
    undefined,
    null,
    '/redactoff',
    { kind: 'sdk' },
    { kind: 'bridge' },
    { kind: 'plugin', name: 'synthetic-plugin' },
    { kind: 'unclassified' },
    { kind: 'scheduled-trigger' },
    { kind: 'channel', server: 'synthetic-mcp' },
    { kind: 'composer', name: 'synthetic-plugin' },
    { kind: 'model' },
    Object.create({ kind: 'composer' }),
  ]) {
    assert.equal(isExplicitLocalUser(origin), false);
  }
  const accessor = Object.defineProperty({}, 'kind', {
    get() {
      throw new Error('ORIGIN_ACCESSOR_MUST_NOT_RUN');
    },
    enumerable: true,
  });
  assert.equal(isExplicitLocalUser(accessor), false);
});
