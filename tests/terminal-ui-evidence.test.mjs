import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalUiDiagnostics } from '../scripts/terminal-ui-evidence.mjs';

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
