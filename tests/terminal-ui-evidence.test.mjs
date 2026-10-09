import assert from 'node:assert/strict';
import test from 'node:test';
import {
  terminalUiDiagnostics,
  terminalUiState,
} from '../scripts/terminal-ui-evidence.mjs';

test('terminal UI diagnostics forward only bounded whitelisted fields', () => {
  const row = {
    code: 'TERMINAL_UI_ROW',
    columns: 80,
    completed: false,
    missing: ['warningAfterTyping'],
  };
  const allowed = { code: 'TERMINAL_UI_REPORT_INVALID' };
  const values = [
    row,
    allowed,
    { ...row, transcript: 'private' },
    { ...row, missing: ['private'] },
    { ...row, columns: 100 },
    { code: 'private' },
    { ...row, missing: ['completed', 'completed'] },
  ];
  assert.deepEqual(
    terminalUiDiagnostics(values.map(JSON.stringify).join('\n')),
    [row, allowed],
  );
  assert.deepEqual(terminalUiDiagnostics(`private\n${'x'.repeat(5000)}`), []);
});
test('terminal UI state accepts only finite stages, focus, receipts and action counts', () => {
  const state = {
    stage: 'off-draft',
    focusedButton: 'Validate',
    receipts: { rejected: false, draftReady: true, editingDraft: true },
    actions: { createDraft: 1, validate: 0 },
  };
  assert.deepEqual(terminalUiState(state), state);
  const row = {
    code: 'TERMINAL_UI_ROW',
    columns: 140,
    completed: false,
    missing: ['completed'],
    state,
  };
  assert.deepEqual(terminalUiDiagnostics(JSON.stringify(row)), [row]);
  for (const patch of [
    { stage: 'private' },
    { focusedButton: 'private' },
    { screen: 'private' },
    { actions: { createDraft: 11, validate: 0 } },
    { receipts: { rejected: 'private', draftReady: true, editingDraft: true } },
  ])
    assert.equal(terminalUiState({ ...state, ...patch }), null);
});
