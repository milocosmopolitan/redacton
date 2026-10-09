"""ConPTY framing and owned process-tree cleanup, without a Claude/model call."""
import ctypes
import contextlib
import io
import importlib.util
import json
import os
import pathlib
import queue
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('windows_pty', pathlib.Path(__file__).with_name('windows-pty.py'))
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class WindowsPtyTest(unittest.TestCase):
    def test_startup_diagnostic_keeps_only_bounded_categories(self):
        observation = backend.startup_observation('\x1b[?25l\x1b[2J\r\n', 1)
        self.assertEqual(observation['category'], 'CONTROL_ONLY')
        self.assertEqual(observation['visibleCharacters'], 0)
        self.assertEqual(observation['controlSequences'], 2)
        self.assertEqual(backend.startup_observation('', 1)['category'], 'NO_OUTPUT')
        diagnostic = backend.startup_observation('ERROR: Unknown Option --setting-sources /private/synthetic-secret', 1)
        self.assertEqual(diagnostic['category'], 'COMMAND_LINE')
        self.assertEqual(diagnostic['tokens'], ['setting-sources'])
        self.assertNotIn('private', json.dumps(diagnostic))
        self.assertEqual(backend.startup_observation('failed to load plugin', 1)['category'], 'PLUGIN')

    def test_output_overflow_is_a_failure(self):
        instance = object.__new__(backend.WindowsPty)
        import threading
        instance.overflow = threading.Event()
        instance.output = queue.Queue()
        instance.overflow.set()
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, '^WINDOWS_PTY_FAILED$'):
            instance.read(0)

    @unittest.skipUnless(os.name == 'nt', 'Actual Windows API required')
    def test_dimensions_input_and_owned_descendant_cleanup(self):
        self.assertEqual(ctypes.sizeof(backend.STARTUPINFOEX), 112)
        self.assertEqual(ctypes.sizeof(backend.EXTENDED_LIMIT), 144)
        code = "import os,subprocess,sys,json; assert sys.argv[1:]==['','{\"mcpServers\":{}}','synthetic spaces']; print('PTY_ARGV_OK',flush=True); print('PTY_IO_'+json.dumps([os.isatty(0),os.isatty(1),os.isatty(2)]),flush=True); print('PTY_STDERR_OK',file=sys.stderr,flush=True); p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']); s=os.get_terminal_size(); print('PTY_READY_'+json.dumps([s.columns,s.lines,p.pid]),flush=True); input(); print('PTY_ACK',flush=True); import time;time.sleep(120)"
        for columns in [140, 80]:
            with tempfile.TemporaryDirectory(prefix='redacton-conpty-test-') as folder:
                env = {key: os.environ[key] for key in ['SystemRoot', 'WINDIR', 'PATH'] if key in os.environ}
                env.update({'TEMP': folder, 'TMP': folder, 'USERPROFILE': folder})
                child = backend.WindowsPty(sys.executable, ['-c', code, '', '{"mcpServers":{}}', 'synthetic spaces'], folder, env, columns)
                output = b''
                descendant = None
                checks = {'code':'WINDOWS_PTY_SELFTEST','columns':columns,'argvCorrect':False,'stdinTty':None,'stdoutTty':None,'stderrTty':None,'stderrCaptured':False,'dimensionsCorrect':False,'inputEcho':False}
                try:
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        output += child.read(.1) or b''
                        text = output.decode('utf8', errors='replace')
                        import re
                        checks['argvCorrect'] = 'PTY_ARGV_OK' in text
                        io_match = re.search(r'PTY_IO_(\[(?:true|false), (?:true|false), (?:true|false)\])', text)
                        if io_match:
                            checks['stdinTty'],checks['stdoutTty'],checks['stderrTty'] = json.loads(io_match.group(1))
                        checks['stderrCaptured'] = 'PTY_STDERR_OK' in text
                        match = re.search(r'PTY_READY_(\[[0-9, ]+\])', text)
                        if match:
                            width, height, descendant = json.loads(match.group(1))
                            checks['dimensionsCorrect'] = (width, height) == (columns,40)
                            self.assertEqual((width, height), (columns, 40))
                            break
                    if descendant is None:
                        child.startup_diagnostic(output.decode('utf8', errors='replace'))
                    self.assertIsNotNone(descendant)
                    self.assertTrue(checks['argvCorrect'])
                    self.assertTrue(checks['stdinTty'])
                    self.assertTrue(checks['stdoutTty'])
                    self.assertTrue(checks['stderrTty'])
                    self.assertTrue(checks['stderrCaptured'])
                    child.write(b'synthetic-input\r')
                    deadline = time.monotonic() + 10
                    while b'PTY_ACK' not in output and time.monotonic() < deadline:
                        output += child.read(.1) or b''
                    if b'PTY_ACK' not in output:
                        child.startup_diagnostic(output.decode('utf8', errors='replace'))
                    checks['inputEcho'] = b'PTY_ACK' in output
                    self.assertIn(b'PTY_ACK', output)
                finally:
                    child.close()
                    print(json.dumps(checks),flush=True)
                api = ctypes.WinDLL('kernel32', use_last_error=True)
                api.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
                api.OpenProcess.restype = ctypes.c_void_p
                api.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
                api.WaitForSingleObject.restype = ctypes.c_ulong
                api.CloseHandle.argtypes = [ctypes.c_void_p]
                handle = api.OpenProcess(0x00100000, False, descendant)
                if handle:
                    try:
                        self.assertEqual(api.WaitForSingleObject(handle, 5000), 0)
                    finally:
                        api.CloseHandle(handle)


class SafeResult(unittest.TextTestResult):
    def addFailure(self, test, err):
        print(json.dumps({'code':'WINDOWS_PTY_STATE','phase':'TEST','win32':None,'hresult':None}),flush=True)
        super().addFailure(test, err)

    def addError(self, test, err):
        if not isinstance(err[1], backend.WindowsPtyFailure):
            print(json.dumps({'code':'WINDOWS_PTY_STATE','phase':'TEST','win32':None,'hresult':None}),flush=True)
        super().addError(test, err)


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(resultclass=SafeResult))
