"""Check rendered focus without launching a host or importing terminal dependencies."""
import ast
import os
import shutil
import subprocess
import tempfile
import json
import pathlib
import re
import types
import unittest
from unittest.mock import patch
import runpy
import sys
if os.environ.get("REDACTON_PYTE_PATH"):
    sys.path.insert(0, os.environ["REDACTON_PYTE_PATH"])

source = ast.parse(pathlib.Path(__file__).with_name('normal-ui.py').read_text(encoding='utf8'))
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ['focused', 'visible_words', 'control_geometry', 'startup_dialog', 'prepare_ui_companion']]
scope = {'re': re, 'os': os, 'shutil': shutil, 'json': json}
exec(compile(ast.Module(body=functions, type_ignores=[]), 'terminal-observation', 'exec'), scope)

class TerminalObservationTest(unittest.TestCase):
    def screen(self, lines):
        buffer = {row: {column: types.SimpleNamespace(reverse=not char.isspace(), bold=False, fg="default") for column, char in enumerate(line)} for row, line in enumerate(lines)}
        scope['screen'] = types.SimpleNamespace(display=lines, buffer=buffer)
        return buffer

    def test_observer_source_decoding_survives_windows_default(self):
        original = pathlib.Path.read_text
        def windows_default(path, encoding=None, errors=None):
            return original(path, encoding=encoding or 'cp1252', errors=errors)
        with patch.object(pathlib.Path, 'read_text', windows_default):
            loaded = runpy.run_path(str(pathlib.Path(__file__)))
        self.assertTrue(loaded['scope']['visible_words']('TURN_ON_TO_VALIDATE', 'TURN_ON_TO_VAL │ IDATE'))

    def test_wrapped_focus_requires_every_label_cell(self):
        buffer = self.screen(['Create   ', 'draft    '])
        self.assertTrue(scope['focused']('Create draft'))
        buffer[1][0].reverse = False
        self.assertFalse(scope['focused']('Create draft'))
        self.assertFalse(scope['focused']('Validate'))

    def test_portable_fixture_counter_is_independent_of_working_directory(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        with tempfile.TemporaryDirectory(prefix='redacton fixture 한글 ') as folder:
            workspace = str(pathlib.Path(__file__).resolve().parent.parent)
            companion = scope['prepare_ui_companion'](workspace, folder, node)
            counter_script = os.path.join(folder,'ui-counter.mjs')
            for _ in range(2):
                child = subprocess.run([node,counter_script],cwd=tempfile.gettempdir(),capture_output=True,timeout=10)
                self.assertEqual(child.returncode,0)
                self.assertEqual(child.stdout,b'syntheticcred_ABCDEF0123456789\n')
                self.assertEqual(child.stderr,child.stdout)
            self.assertEqual(pathlib.Path(folder,'ui-execution-counter').read_text(),'xx')
            self.assertNotIn('printf x >>',pathlib.Path(companion,'hooks/register.js').read_text())

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

class TerminalQueryTest(unittest.TestCase):
    def observer(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('terminal_observer_test', pathlib.Path(__file__).with_name('terminal-observer.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        replies = []
        screen, stream = module.make_observer(140, 40, replies.append)
        return screen, stream, replies

    def test_combined_query_uses_cursor_at_query_not_end_of_read(self):
        screen, stream, replies = self.observer()
        stream.feed('\x1b[4;7H\x1b[6n\x1b[20;33H')
        self.assertEqual(replies, [b'\x1b[4;7R'])
        self.assertEqual((screen.cursor.y, screen.cursor.x), (19, 32))
        self.assertNotEqual(replies[0], f'\x1b[{screen.cursor.y+1};{screen.cursor.x+1}R'.encode())

    def test_each_query_in_one_read_gets_its_own_cursor_reply(self):
        screen, stream, replies = self.observer()
        stream.feed('\x1b[2;3H\x1b[6n\x1b[9;11H\x1b[6n')
        self.assertEqual(replies, [b'\x1b[2;3R', b'\x1b[9;11R'])

    def test_split_queries_and_distinct_primary_secondary_attributes(self):
        for cut in range(1, 5):
            screen, stream, replies = self.observer()
            stream.feed('\x1b[8;12H')
            query = '\x1b[6n'
            stream.feed(query[:cut]); stream.feed(query[cut:])
            self.assertEqual(replies, [b'\x1b[8;12R'])
        screen, stream, replies = self.observer()
        for char in '\x1b[c\x1b[>c\x1b[0c\x1b[>0c\x1b[5n':
            stream.feed(char)
        self.assertEqual(replies, [b'\x1b[?1;2c', b'\x1b[>0;95;0c', b'\x1b[?1;2c', b'\x1b[>0;95;0c', b'\x1b[0n'])

if __name__ == '__main__':
    unittest.main()
