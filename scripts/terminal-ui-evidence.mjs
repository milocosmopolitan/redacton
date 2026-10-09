export const terminalUiChecks = [
  'completed',
  'previewOutcomesVisibleBeforeApply',
  'autocompleteExactNames',
  'localArgsRejected',
  'formOpened',
  'draftCreated',
  'validated',
  'previewed',
  'applied',
  'escapeClosed',
  'uiAppliedCustomEffect',
  'removed',
  'reverted',
  'offPanelWarning',
  'offValidationRejected',
  'offHelperCountUnchanged',
  'offToolOriginalPreserved',
  'warningBeforeTyping',
  'warningAfterTyping',
  'warningAfterActualBash',
];

const codes = new Set([
  'TERMINAL_UI_PREREQUISITE_UNAVAILABLE',
  'TERMINAL_UI_BOOTSTRAP_FAILED',
  'TERMINAL_UI_REPORT_INVALID',
  'TERMINAL_UI_CHECK_FAILED',
  'TERMINAL_UI_STATE_INVALID',
]);

const stages = new Set([
  'startup',
  'autocomplete',
  'invalid',
  'form',
  'id',
  'prefix',
  'length',
  'draft',
  'validate',
  'preview',
  'apply',
  'escape',
  'custom',
  'custom-diagnostic',
  'remove',
  'remove-draft',
  'remove-validate',
  'remove-preview',
  'remove-apply',
  'ready-revert',
  'revert',
  'final-escape',
  'verify-revert',
  'before-off-count',
  'ux-off',
  'off-form',
  'off-id',
  'off-prefix',
  'off-length',
  'off-draft',
  'off-validate',
  'off-close',
  'off-tool',
  'after-off-count',
  'complete',
]);
const buttons = new Set([
  null,
  'Create draft',
  'Validate',
  'Synthetic preview',
  'Apply session',
  'Revert',
  'Remove rule',
]);
function keys(value, expected) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === expected
  );
}
export function terminalUiState(value) {
  if (
    !keys(value, 'actions,focusedButton,receipts,stage') ||
    !stages.has(value.stage) ||
    !buttons.has(value.focusedButton) ||
    !keys(value.receipts, 'draftReady,editingDraft,rejected') ||
    !Object.values(value.receipts).every((item) => typeof item === 'boolean') ||
    !keys(value.actions, 'createDraft,focusTabs,validate') ||
    !Object.values(value.actions).every(
      (item) => Number.isSafeInteger(item) && item >= 0 && item <= 12,
    )
  )
    return null;
  return {
    stage: value.stage,
    focusedButton: value.focusedButton,
    receipts: {
      rejected: value.receipts.rejected,
      draftReady: value.receipts.draftReady,
      editingDraft: value.receipts.editingDraft,
    },
    actions: {
      createDraft: value.actions.createDraft,
      validate: value.actions.validate,
      focusTabs: value.actions.focusTabs,
    },
  };
}

export function terminalUiFrame(value) {
  if (
    !keys(value, 'code,columns,index,state') ||
    value.code !== 'TERMINAL_UI_FRAME' ||
    ![80, 140].includes(value.columns) ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0 ||
    value.index > 7
  )
    return null;
  const state = value.state;
  const bounded = (value, max) =>
    Number.isSafeInteger(value) && value >= 0 && value <= max;
  const flags = (value, names) =>
    keys(value, names) &&
    Object.values(value).every((item) => typeof item === 'boolean');
  if (
    !keys(
      state,
      'actions,alive,controls,cursor,cursorLabelRow,elapsedMs,exitCode,notices,pane,phase,stage',
    ) ||
    !stages.has(state.stage) ||
    !['entry', 'settled', 'final'].includes(state.phase) ||
    typeof state.alive !== 'boolean' ||
    !(
      state.exitCode === null ||
      (Number.isSafeInteger(state.exitCode) &&
        state.exitCode >= -1 &&
        state.exitCode <= 0xffffffff)
    ) ||
    state.alive !== (state.exitCode === null) ||
    !bounded(state.elapsedMs, 180000) ||
    !keys(state.cursor, 'column,row') ||
    !bounded(state.cursor.row, 39) ||
    !bounded(state.cursor.column, value.columns - 1) ||
    !['ruleId', 'prefix', 'length', 'unknown'].includes(state.cursorLabelRow) ||
    !flags(state.pane, 'focused,legacyFocused,unfocused') ||
    !flags(state.notices, 'draftReady,invalidCandidate,rejected') ||
    !keys(
      state.actions,
      'createDraft,focusTabs,lengthClears,lengthEntries,lengthSubmits,prefixEntries,ruleIdEntries,validate',
    ) ||
    !Object.values(state.actions).every((item) => bounded(item, 12)) ||
    !keys(state.controls, 'createDraft,length,prefix,ruleId,validate')
  )
    return null;
  for (const [key, characters] of Object.entries({
    ruleId: 6,
    prefix: 13,
    length: 10,
    createDraft: 11,
    validate: 8,
  })) {
    const control = state.controls[key];
    if (control === null) continue;
    if (
      !keys(
        control,
        'bold,characters,colored,column,endColumn,endRow,reverse,row',
      ) ||
      control.characters !== characters ||
      !bounded(control.row, 39) ||
      !bounded(control.endRow, 39) ||
      control.endRow < control.row ||
      !bounded(control.column, value.columns - 1) ||
      !bounded(control.endColumn, value.columns - 1) ||
      !['reverse', 'bold', 'colored'].every((key) =>
        bounded(control[key], characters),
      )
    )
      return null;
  }
  return value;
}

const ptyPhases = new Set([
  'API_SETUP',
  'ARGUMENT',
  'CREATE_PIPE',
  'CREATE_CONSOLE',
  'ATTRIBUTE',
  'CREATE_JOB',
  'CREATE_PROCESS',
  'ASSIGN_JOB',
  'RESUME',
  'OUTPUT_LIMIT',
  'WRITE',
  'POLL',
  'CLEANUP',
  'TEST',
]);
export function windowsPtyState(value) {
  const numeric = (value) =>
    value === null ||
    (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff);
  return keys(value, 'code,hresult,phase,win32') &&
    value.code === 'WINDOWS_PTY_STATE' &&
    ptyPhases.has(value.phase) &&
    numeric(value.win32) &&
    numeric(value.hresult)
    ? value
    : null;
}
export function windowsPtyDiagnostics(stdout) {
  const output = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 4096) continue;
    try {
      const value = windowsPtyState(JSON.parse(line));
      if (value) output.push(value);
    } catch {}
    if (output.length === 8) break;
  }
  return output;
}

export function terminalUiDiagnostics(stdout) {
  const output = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 4096) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const keys = Object.keys(value).sort().join(',');
    if (windowsPtyState(value)) {
      output.push(windowsPtyState(value));
    } else if (terminalUiFrame(value)) {
      output.push(terminalUiFrame(value));
    } else if (keys === 'code' && codes.has(value.code)) {
      output.push({ code: value.code });
    } else if (
      [
        'code,columns,completed,missing',
        'code,columns,completed,missing,state',
      ].includes(keys) &&
      value.code === 'TERMINAL_UI_ROW' &&
      [140, 80].includes(value.columns) &&
      typeof value.completed === 'boolean' &&
      Array.isArray(value.missing) &&
      value.missing.length <= terminalUiChecks.length &&
      new Set(value.missing).size === value.missing.length &&
      value.missing.every((key) => terminalUiChecks.includes(key)) &&
      (!('state' in value) || terminalUiState(value.state))
    ) {
      output.push({
        code: value.code,
        columns: value.columns,
        completed: value.completed,
        missing: value.missing,
        ...('state' in value ? { state: terminalUiState(value.state) } : {}),
      });
    }
    if (output.length === 22) break;
  }
  return output;
}
