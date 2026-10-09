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
import builtins

spec = importlib.util.spec_from_file_location('windows_pty', pathlib.Path(__file__).with_name('windows-pty.py'))
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)

STATE_KEYS = {'startupReached','exactArgv','stdinStream','stdoutStream','stderrStream','stdinTty','stdoutTty','stderrTty','phase','exceptionPhase','errno'}
STATE_PHASES = {'STARTUP','ARGV','STDIO','DIMENSIONS','INPUT','COMPLETE'}


def read_child_state(path):
    try:
        with pathlib.Path(path).open('rb') as file:
            data = file.read(4097)
        if len(data) > 4096:
            return None
        value = json.loads(data)
        if not isinstance(value,dict) or set(value) != STATE_KEYS:
            return None
        flags = STATE_KEYS - {'phase','exceptionPhase','errno'}
        if not isinstance(value['startupReached'],bool):
            return None
        if any(value[key] is not None and not isinstance(value[key],bool) for key in flags):
            return None
        if value['phase'] not in STATE_PHASES or value['exceptionPhase'] not in STATE_PHASES | {'NONE'}:
            return None
        errno = value['errno']
        if errno is not None and (type(errno) is not int or not 0 <= errno <= 0xffffffff):
            return None
        return value
    except (OSError,ValueError,TypeError):
        return None


CHILD_SCRIPT = '''with open(STATE_PATH_LITERAL,'w',encoding='utf8') as file:
    file.write(INITIAL_STATE_LITERAL)
import json,os,sys
state={'startupReached':True,'exactArgv':None,'stdinStream':None,'stdoutStream':None,'stderrStream':None,'stdinTty':None,'stdoutTty':None,'stderrTty':None,'phase':'STARTUP','exceptionPhase':'NONE','errno':None}
def checkpoint():
    with open(os.environ['REDACTON_PTY_SELFTEST_STATE'],'w',encoding='utf8') as file:
        json.dump(state,file)
checkpoint()
try:
    state['phase']='ARGV'
    state['exactArgv']=sys.argv[1:]==['','{"mcpServers":{}}','synthetic spaces']
    checkpoint()
    assert state['exactArgv']
    state['phase']='STDIO'
    for name,fd in [('stdin',0),('stdout',1),('stderr',2)]:
        state[name+'Stream']=getattr(sys,name) is not None
        state[name+'Tty']=os.isatty(fd)
    checkpoint()
    assert all(state[name+'Stream'] and state[name+'Tty'] for name in ['stdin','stdout','stderr'])
    print('PTY_ARGV_OK',flush=True)
    print('PTY_IO_'+json.dumps([state['stdinTty'],state['stdoutTty'],state['stderrTty']]),flush=True)
    print('PTY_STDERR_OK',file=sys.stderr,flush=True)
    state['phase']='DIMENSIONS'
    checkpoint()
    import subprocess,time
    descendant=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'])
    size=os.get_terminal_size()
    print('PTY_READY_'+json.dumps([size.columns,size.lines,descendant.pid]),flush=True)
    state['phase']='INPUT'
    checkpoint()
    input()
    state['phase']='COMPLETE'
    checkpoint()
    print('PTY_ACK',flush=True)
    time.sleep(120)
except BaseException as error:
    state['exceptionPhase']=state['phase']
    number=getattr(error,'winerror',None)
    if number is None:number=getattr(error,'errno',None)
    state['errno']=number if type(number) is int and 0<=number<=0xffffffff else None
    checkpoint()
    raise
'''


class WindowsPtyTest(unittest.TestCase):
    def test_first_checkpoint_precedes_optional_imports_and_stdio(self):
        with tempfile.TemporaryDirectory(prefix='redacton-first-state-') as folder:
            state_path=pathlib.Path(folder,'state.json')
            initial={key:None for key in STATE_KEYS}
            initial.update(startupReached=True,phase='STARTUP',exceptionPhase='NONE')
            script=CHILD_SCRIPT.replace('STATE_PATH_LITERAL',repr(str(state_path))).replace('INITIAL_STATE_LITERAL',repr(json.dumps(initial)))
            def fail_import(*_args,**_kwargs):
                raise ImportError('synthetic import failure')
            restricted={**vars(builtins),'__import__':fail_import}
            with self.assertRaises(ImportError):
                exec(compile(script,'owned-child','exec'),{'__builtins__':restricted})
            self.assertEqual(read_child_state(state_path),initial)

    def test_child_sidechannel_rejects_unbounded_or_arbitrary_fields(self):
        value={key:None for key in STATE_KEYS}
        value.update(startupReached=True,phase='ARGV',exceptionPhase='NONE')
        with tempfile.TemporaryDirectory(prefix='redacton-state-test-') as folder:
            path=pathlib.Path(folder,'state.json')
            path.write_text(json.dumps(value),encoding='utf8')
            self.assertEqual(read_child_state(path),value)
            for invalid in [{**value,'raw':'private'},{**value,'phase':'private path'},{**value,'errno':-1},{**value,'exactArgv':'raw argv'},{**value,'errno':True}]:
                path.write_text(json.dumps(invalid),encoding='utf8')
                self.assertIsNone(read_child_state(path))
            path.write_text(' '*4097,encoding='utf8')
            self.assertIsNone(read_child_state(path))

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
        for columns in [140, 80]:
            with tempfile.TemporaryDirectory(prefix='redacton-conpty-test-') as folder:
                env = {key: os.environ[key] for key in ['SystemRoot', 'WINDIR', 'PATH'] if key in os.environ}
                env.update({'TEMP': folder, 'TMP': folder, 'USERPROFILE': folder})
                state_path=pathlib.Path(folder,'state.json')
                env['REDACTON_PTY_SELFTEST_STATE']=str(state_path)
                child_script=pathlib.Path(folder,'child.py')
                initial={key:None for key in STATE_KEYS}
                initial.update(startupReached=True,phase='STARTUP',exceptionPhase='NONE')
                script=CHILD_SCRIPT.replace('STATE_PATH_LITERAL',repr(str(state_path))).replace('INITIAL_STATE_LITERAL',repr(json.dumps(initial)))
                child_script.write_text(script,encoding='utf8')
                child = backend.WindowsPty(sys.executable, [str(child_script), '', '{"mcpServers":{}}', 'synthetic spaces'], folder, env, columns)
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
                    state=read_child_state(state_path)
                    fallback={key:None for key in STATE_KEYS}
                    fallback.update(startupReached=False,phase='UNOBSERVED',exceptionPhase='NONE')
                    print(json.dumps({'code':'WINDOWS_PTY_CHILD_STATE','columns':columns,'sidechannelValid':state is not None,**(state or fallback)}),flush=True)
                self.assertIsNotNone(state)
                self.assertTrue(state['startupReached'])
                self.assertEqual(state['exceptionPhase'],'NONE')
                self.assertEqual(state['phase'],'COMPLETE')
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
