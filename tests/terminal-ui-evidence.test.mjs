import assert from 'node:assert/strict';
import test from 'node:test';
import {
  terminalUiBootstrap,
  terminalUiDiagnostics,
  terminalUiFrame,
  terminalUiState,
  windowsPtyChild,
  windowsPtyChildState,
  windowsPtyDiagnostics,
  windowsPtySelftest,
  windowsPtyState,
} from '../scripts/terminal-ui-evidence.mjs';

test('owned child checkpoints reject paths, argv, arbitrary phases and exception text', () => {
  const row = {
    code: 'WINDOWS_PTY_CHILD_STATE',
    columns: 140,
    sidechannelValid: true,
    startupReached: true,
    exactArgv: true,
    stdinStream: true,
    stdoutStream: true,
    stderrStream: true,
    stdinTty: false,
    stdoutTty: false,
    stderrTty: false,
    phase: 'STDIO',
    exceptionPhase: 'STDIO',
    errno: null,
  };
  assert.deepEqual(windowsPtyChildState(row), row);
  assert.deepEqual(windowsPtyDiagnostics(JSON.stringify(row)), [row]);
  assert.deepEqual(terminalUiDiagnostics(JSON.stringify(row)), [row]);
  for (const invalid of [
    { ...row, argv: ['secret'] },
    { ...row, phase: 'private path' },
    { ...row, exceptionPhase: 'raw exception' },
    { ...row, errno: true },
    { ...row, errno: -1 },
    { ...row, stdinStream: 'private' },
    { ...row, sidechannelValid: 1 },
  ])
    assert.equal(windowsPtyChildState(invalid), null);
});

test('startup child diagnostics forward finite categories and reject text or oversized counters', () => {
  const row = {
    code: 'WINDOWS_PTY_CHILD',
    exitCode: 1,
    bytes: 49,
    visibleCharacters: 0,
    controlSequences: 5,
    category: 'CONTROL_ONLY',
    tokens: [],
  };
  assert.deepEqual(windowsPtyChild(row), row);
  assert.deepEqual(windowsPtyDiagnostics(JSON.stringify(row)), [row]);
  assert.deepEqual(terminalUiDiagnostics(JSON.stringify(row)), [row]);
  for (const invalid of [
    { ...row, category: 'private payload' },
    { ...row, tokens: ['/private/path'] },
    { ...row, tokens: ['bash.exe', 'bash.exe'] },
    { ...row, bytes: 65537 },
    { ...row, exitCode: 0x100000000 },
    { ...row, raw: 'secret' },
  ]) {
    assert.equal(windowsPtyChild(invalid), null);
    assert.deepEqual(windowsPtyDiagnostics(JSON.stringify(invalid)), []);
  }
});

test('bootstrap phases and actual ConPTY selftests keep only fixed exception and boolean evidence', () => {
  const row = {
    code: 'TERMINAL_UI_BOOTSTRAP',
    phase: 'observer',
    passed: false,
    exitCode: 1,
    timedOut: false,
    exception: 'ASSERTION',
  };
  assert.deepEqual(terminalUiBootstrap(row), row);
  assert.deepEqual(terminalUiDiagnostics(JSON.stringify(row)), [row]);
  for (const invalid of [
    { ...row, phase: 'private filename' },
    { ...row, exception: 'raw traceback' },
    { ...row, exitCode: NaN },
    { ...row, passed: 'yes' },
    { ...row, stderr: 'secret' },
  ])
    assert.equal(terminalUiBootstrap(invalid), null);
  const selftest = {
    code: 'WINDOWS_PTY_SELFTEST',
    columns: 140,
    argvCorrect: true,
    stdinTty: true,
    stdoutTty: true,
    stderrTty: true,
    stderrCaptured: true,
    dimensionsCorrect: true,
    inputEcho: true,
  };
  assert.deepEqual(windowsPtySelftest(selftest), selftest);
  assert.deepEqual(windowsPtyDiagnostics(JSON.stringify(selftest)), [selftest]);
  assert.deepEqual(terminalUiDiagnostics(JSON.stringify(selftest)), [selftest]);
  assert.equal(
    windowsPtySelftest({ ...selftest, stdoutTty: 'private text' }),
    null,
  );
  assert.equal(windowsPtySelftest({ ...selftest, columns: 123 }), null);
  assert.equal(windowsPtySelftest({ ...selftest, pid: 123 }), null);
  assert.equal(windowsPtySelftest({ ...selftest, stderrTty: 'raw' }), null);
  assert.equal(
    windowsPtySelftest({ ...selftest, stderrCaptured: 'payload' }),
    null,
  );
});

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

test('Windows PTY diagnostics retain only fixed phases and unsigned API numbers', () => {
  const state = {
    code: 'WINDOWS_PTY_STATE',
    phase: 'CREATE_CONSOLE',
    win32: 5,
    hresult: 0x80070005,
  };
  assert.deepEqual(windowsPtyState(state), state);
  assert.deepEqual(terminalUiDiagnostics(JSON.stringify(state)), [state]);
  for (const patch of [
    { phase: 'private' },
    { win32: -1 },
    { hresult: 0x100000000 },
    { error: 'private' },
    { win32: 'private' },
  ]) {
    assert.equal(windowsPtyState({ ...state, ...patch }), null);
    assert.deepEqual(
      windowsPtyDiagnostics(JSON.stringify({ ...state, ...patch })),
      [],
    );
  }
  const value = frame();
  value.state.alive = false;
  value.state.exitCode = 0xc0000005;
  assert.deepEqual(terminalUiFrame(value), value);
  for (const code of [-2, 0x100000000, 1.5]) {
    value.state.exitCode = code;
    assert.equal(terminalUiFrame(value), null);
  }
});
