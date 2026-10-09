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
]);

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
      keys === 'code,columns,completed,missing' &&
      value.code === 'TERMINAL_UI_ROW' &&
      [140, 80].includes(value.columns) &&
      typeof value.completed === 'boolean' &&
      Array.isArray(value.missing) &&
      value.missing.length <= terminalUiChecks.length &&
      new Set(value.missing).size === value.missing.length &&
      value.missing.every((key) => terminalUiChecks.includes(key))
    ) {
      output.push({
        code: value.code,
        columns: value.columns,
        completed: value.completed,
        missing: value.missing,
      });
    }
    if (output.length === 8) break;
  }
  return output;
}
