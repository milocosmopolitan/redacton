"""Check rendered focus without launching a host or importing terminal dependencies."""
import ast
import pathlib
import re
import types
import unittest

source = ast.parse(pathlib.Path(__file__).with_name('normal-ui.py').read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ['focused', 'visible_words', 'control_geometry', 'startup_dialog']]
scope = {'re': re}
exec(compile(ast.Module(body=functions, type_ignores=[]), 'terminal-observation', 'exec'), scope)

class TerminalObservationTest(unittest.TestCase):
    def screen(self, lines):
        buffer = {row: {column: types.SimpleNamespace(reverse=not char.isspace(), bold=False, fg="default") for column, char in enumerate(line)} for row, line in enumerate(lines)}
        scope['screen'] = types.SimpleNamespace(display=lines, buffer=buffer)
        return buffer

    def test_wrapped_focus_requires_every_label_cell(self):
        buffer = self.screen(['Create   ', 'draft    '])
        self.assertTrue(scope['focused']('Create draft'))
        buffer[1][0].reverse = False
        self.assertFalse(scope['focused']('Create draft'))
        self.assertFalse(scope['focused']('Validate'))

    def test_onboarding_never_consumes_configuration_form_input(self):
        form = 'Local panel has keyboard focus. Never enter a credential. Project patterns require explicit load and trust. Press Enter to select.'
        self.assertTrue('trust' in form.lower() and 'Enter' in form)
        self.assertFalse(scope['startup_dialog']('trust', 'off-form', form))
        self.assertFalse(scope['startup_dialog']('trust', 'startup', form))
        trust = 'Is this a project you created or one you trust? Enter to confirm'
        self.assertTrue(scope['startup_dialog']('trust', 'startup', trust))
        self.assertFalse(scope['startup_dialog']('trust', 'off-form', trust))
        key = 'Do you want to use this API key? Enter to confirm'
        self.assertTrue(scope['startup_dialog']('api-key', 'startup', key))
        self.assertFalse(scope['startup_dialog']('api-key', 'off-form', key))

    def test_geometry_keeps_only_known_label_cells(self):
        self.screen(['Create   ', 'draft    '])
        self.assertEqual(scope['control_geometry']('Create draft'), {'row': 0, 'column': 0, 'endRow': 1, 'endColumn': 4, 'characters': 11, 'reverse': 11, 'bold': 0, 'colored': 0})
        self.assertIsNone(scope['control_geometry']('Validate'))

    def test_exact_focus_and_receipt(self):
        self.screen(['Create draft'])
        self.assertTrue(scope['focused']('Create draft'))
        self.assertTrue(scope['visible_words']('TURN_ON_TO_VALIDATE', 'TURN_ON_TO_VAL │ IDATE'))
        self.assertFalse(scope['visible_words']('TURN_ON_TO_VALIDATE', 'TURN_ON_TO_SAVE'))

if __name__ == '__main__':
    unittest.main()
