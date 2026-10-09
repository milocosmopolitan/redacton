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
    if (keys === 'code' && codes.has(value.code)) {
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
    if (output.length === 8) break;
  }
  return output;
}
