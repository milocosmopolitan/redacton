import assert from 'node:assert/strict';
import test from 'node:test';
import {
  terminalUiDiagnostics,
  terminalUiFrame,
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
    actions: { createDraft: 1, validate: 0, focusTabs: 0 },
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
    { actions: { createDraft: 1, validate: 0, focusTabs: 13 } },
    { receipts: { rejected: 'private', draftReady: true, editingDraft: true } },
  ])
    assert.equal(terminalUiState({ ...state, ...patch }), null);
});

function frame(columns = 140, index = 0) {
  return {
    code: 'TERMINAL_UI_FRAME',
    columns,
    index,
    state: {
      stage: 'off-length',
      phase: 'settled',
      alive: true,
      exitCode: null,
      elapsedMs: 1000,
      cursor: { row: 20, column: 30 },
      cursorLabelRow: 'length',
      pane: { focused: true, legacyFocused: false, unfocused: false },
      notices: { draftReady: false, invalidCandidate: false, rejected: false },
      actions: {
        createDraft: 0,
        focusTabs: 0,
        lengthClears: 1,
        lengthEntries: 1,
        lengthSubmits: 1,
        prefixEntries: 1,
        ruleIdEntries: 1,
        validate: 0,
      },
      controls: {
        ruleId: null,
        prefix: null,
        validate: null,
        length: {
          row: 20,
          column: 2,
          endRow: 20,
          endColumn: 12,
          characters: 10,
          reverse: 0,
          bold: 0,
          colored: 0,
        },
        createDraft: {
          row: 23,
          column: 2,
          endRow: 24,
          endColumn: 6,
          characters: 11,
          reverse: 11,
          bold: 0,
          colored: 0,
        },
      },
    },
  };
}
test('complete UI frames retain geometry without allowing arbitrary screen content', () => {
  const value = frame();
  assert.deepEqual(terminalUiFrame(value), value);
  for (const mutate of [
    (v) => {
      v.state.screen = 'private';
    },
    (v) => {
      v.state.cursorLabelRow = 'private';
    },
    (v) => {
      v.state.controls.createDraft.text = 'private';
    },
    (v) => {
      v.state.controls.createDraft.reverse = 12;
    },
    (v) => {
      v.state.controls.length.row = 40;
    },
    (v) => {
      v.state.cursor.column = 140;
    },
    (v) => {
      v.state.exitCode = 0;
    },
    (v) => {
      v.state.actions.lengthSubmits = 13;
    },
    (v) => {
      v.index = 8;
    },
  ]) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.equal(terminalUiFrame(invalid), null);
    assert.deepEqual(terminalUiDiagnostics(JSON.stringify(invalid)), []);
  }
  const frames = [80, 140].flatMap((columns) =>
    Array.from({ length: 8 }, (_, index) => frame(columns, index)),
  );
  assert.deepEqual(
    terminalUiDiagnostics(frames.map(JSON.stringify).join('\n')),
    frames,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 4096);
});
