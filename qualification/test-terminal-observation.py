"""Check rendered focus without launching a host or importing terminal dependencies."""
import ast
import pathlib
import re
import types
import unittest

source = ast.parse(pathlib.Path(__file__).with_name('normal-ui.py').read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ['focused', 'visible_words']]
scope = {'re': re}
exec(compile(ast.Module(body=functions, type_ignores=[]), 'terminal-observation', 'exec'), scope)

class TerminalObservationTest(unittest.TestCase):
    def screen(self, lines):
        buffer = {row: {column: types.SimpleNamespace(reverse=not char.isspace()) for column, char in enumerate(line)} for row, line in enumerate(lines)}
        scope['screen'] = types.SimpleNamespace(display=lines, buffer=buffer)
        return buffer

    def test_wrapped_focus_requires_every_label_cell(self):
        buffer = self.screen(['Create   ', 'draft    '])
        self.assertTrue(scope['focused']('Create draft'))
        buffer[1][0].reverse = False
        self.assertFalse(scope['focused']('Create draft'))
        self.assertFalse(scope['focused']('Validate'))

    def test_exact_focus_and_receipt(self):
        self.screen(['Create draft'])
        self.assertTrue(scope['focused']('Create draft'))
        self.assertTrue(scope['visible_words']('TURN_ON_TO_VALIDATE', 'TURN_ON_TO_VAL │ IDATE'))
        self.assertFalse(scope['visible_words']('TURN_ON_TO_VALIDATE', 'TURN_ON_TO_SAVE'))

if __name__ == '__main__':
    unittest.main()
