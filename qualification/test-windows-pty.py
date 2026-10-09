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
        code = "import os,subprocess,sys,json; p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)']); s=os.get_terminal_size(); print('PTY_READY_'+json.dumps([s.columns,s.lines,p.pid]),flush=True); input(); print('PTY_ACK',flush=True); import time;time.sleep(120)"
        for columns in [140, 80]:
            with tempfile.TemporaryDirectory(prefix='redacton-conpty-test-') as folder:
                env = {key: os.environ[key] for key in ['SystemRoot', 'WINDIR', 'PATH'] if key in os.environ}
                env.update({'TEMP': folder, 'TMP': folder, 'USERPROFILE': folder})
                child = backend.WindowsPty(sys.executable, ['-c', code], folder, env, columns)
                output = b''
                descendant = None
                try:
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        output += child.read(.1) or b''
                        text = output.decode('utf8', errors='replace')
                        import re
                        match = re.search(r'PTY_READY_(\[[0-9, ]+\])', text)
                        if match:
                            width, height, descendant = json.loads(match.group(1))
                            self.assertEqual((width, height), (columns, 40))
                            break
                    self.assertIsNotNone(descendant)
                    child.write(b'synthetic-input\r')
                    deadline = time.monotonic() + 10
                    while b'PTY_ACK' not in output and time.monotonic() < deadline:
                        output += child.read(.1) or b''
                    self.assertIn(b'PTY_ACK', output)
                finally:
                    child.close()
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
