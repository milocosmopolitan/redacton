"""Owned ConPTY child, using only Windows APIs and Python's standard library.

API lifecycle: https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session
"""
import ctypes
from ctypes import wintypes as w
import os
import queue
import json
import subprocess
import threading


class COORD(ctypes.Structure):
    _fields_ = [('X', w.SHORT), ('Y', w.SHORT)]


class STARTUPINFO(ctypes.Structure):
    _fields_ = [('cb', w.DWORD), ('lpReserved', w.LPWSTR), ('lpDesktop', w.LPWSTR),
                ('lpTitle', w.LPWSTR), ('dwX', w.DWORD), ('dwY', w.DWORD),
                ('dwXSize', w.DWORD), ('dwYSize', w.DWORD), ('dwXCountChars', w.DWORD),
                ('dwYCountChars', w.DWORD), ('dwFillAttribute', w.DWORD),
                ('dwFlags', w.DWORD), ('wShowWindow', w.WORD), ('cbReserved2', w.WORD),
                ('lpReserved2', ctypes.POINTER(w.BYTE)), ('hStdInput', w.HANDLE),
                ('hStdOutput', w.HANDLE), ('hStdError', w.HANDLE)]


class STARTUPINFOEX(ctypes.Structure):
    _fields_ = [('StartupInfo', STARTUPINFO), ('lpAttributeList', ctypes.c_void_p)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [('hProcess', w.HANDLE), ('hThread', w.HANDLE), ('dwProcessId', w.DWORD), ('dwThreadId', w.DWORD)]


class BASIC_LIMIT(ctypes.Structure):
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                ('LimitFlags', w.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', w.DWORD),
                ('Affinity', ctypes.c_size_t), ('PriorityClass', w.DWORD), ('SchedulingClass', w.DWORD)]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in ['ReadOperationCount', 'WriteOperationCount',
                'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]


class EXTENDED_LIMIT(ctypes.Structure):
    _fields_ = [('BasicLimitInformation', BASIC_LIMIT), ('IoInfo', IO_COUNTERS),
                ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]


class WindowsPtyFailure(RuntimeError):
    def __init__(self, phase, hresult=None):
        self.phase = phase
        self.win32 = ctypes.get_last_error() if os.name == 'nt' else 0
        self.hresult = None if hresult is None else int(hresult) & 0xffffffff
        print(json.dumps({'code': 'WINDOWS_PTY_STATE', 'phase': phase, 'win32': self.win32, 'hresult': self.hresult}), flush=True)
        super().__init__('WINDOWS_PTY_FAILED')


class WindowsPty:
    def __init__(self, executable, arguments, cwd, env, columns, rows=40):
        if os.name != 'nt' or not os.path.isabs(executable) or not 1 <= columns <= 32767 or not 1 <= rows <= 32767:
            raise WindowsPtyFailure('ARGUMENT')
        self.api = ctypes.WinDLL('kernel32', use_last_error=True)
        prototypes = {
            'CreatePipe': ([ctypes.POINTER(w.HANDLE), ctypes.POINTER(w.HANDLE), ctypes.c_void_p, w.DWORD], w.BOOL),
            'CloseHandle': ([w.HANDLE], w.BOOL),
            'CreatePseudoConsole': ([COORD, w.HANDLE, w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)], ctypes.c_long),
            'ClosePseudoConsole': ([w.HANDLE], None),
            'InitializeProcThreadAttributeList': ([ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t)], w.BOOL),
            'UpdateProcThreadAttribute': ([ctypes.c_void_p, w.DWORD, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p], w.BOOL),
            'DeleteProcThreadAttributeList': ([ctypes.c_void_p], None),
            'CreateProcessW': ([w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL, w.DWORD, ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(STARTUPINFOEX), ctypes.POINTER(PROCESS_INFORMATION)], w.BOOL),
            'CreateJobObjectW': ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
            'SetInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
            'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
            'TerminateProcess': ([w.HANDLE, w.UINT], w.BOOL),
            'ResumeThread': ([w.HANDLE], w.DWORD),
            'GetExitCodeProcess': ([w.HANDLE, ctypes.POINTER(w.DWORD)], w.BOOL),
            'WaitForSingleObject': ([w.HANDLE, w.DWORD], w.DWORD),
            'ReadFile': ([w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.c_void_p], w.BOOL),
            'WriteFile': ([w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.c_void_p], w.BOOL),
        }
        try:
            for name, (args, result) in prototypes.items():
                function = getattr(self.api, name)
                function.argtypes, function.restype = args, result
        except BaseException:
            raise WindowsPtyFailure('API_SETUP') from None
        self.handles = []
        self.console = w.HANDLE()
        self.process = PROCESS_INFORMATION()
        self.job = None
        self.reader = None
        self.output = queue.Queue(maxsize=32)
        self.eof = threading.Event()
        self.overflow = threading.Event()
        attributes = None
        self.phase = 'CREATE_PIPE'
        try:
            input_read, self.input_write = self.pipe()
            self.output_read, output_write = self.pipe()
            self.phase = 'CREATE_CONSOLE'
            hresult = self.api.CreatePseudoConsole(COORD(columns, rows), input_read, output_write, 0, ctypes.byref(self.console))
            if hresult != 0:
                raise WindowsPtyFailure('CREATE_CONSOLE', hresult)
            self.reader = threading.Thread(target=self.drain, daemon=True)
            self.reader.start()
            self.phase = 'ATTRIBUTE'
            size = ctypes.c_size_t()
            self.api.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
            if not 0 < size.value <= 65536:
                raise WindowsPtyFailure('ATTRIBUTE')
            attributes = ctypes.create_string_buffer(size.value)
            if not self.api.InitializeProcThreadAttributeList(attributes, 1, 0, ctypes.byref(size)):
                attributes = None
                raise WindowsPtyFailure('ATTRIBUTE')
            if not self.api.UpdateProcThreadAttribute(attributes, 0, 0x00020016, self.console, ctypes.sizeof(w.HANDLE), None, None):
                raise WindowsPtyFailure('ATTRIBUTE')
            startup = STARTUPINFOEX()
            startup.StartupInfo.cb = ctypes.sizeof(startup)
            startup.lpAttributeList = ctypes.cast(attributes, ctypes.c_void_p)
            command = ctypes.create_unicode_buffer(subprocess.list2cmdline([executable, *arguments]))
            block = ctypes.create_unicode_buffer('\0'.join(f'{key}={value}' for key, value in sorted(env.items(), key=lambda item: item[0].upper())) + '\0\0')
            self.phase = 'CREATE_JOB'
            self.job = self.api.CreateJobObjectW(None, None)
            limits = EXTENDED_LIMIT()
            limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
            if not self.job or not self.api.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise WindowsPtyFailure('CREATE_JOB')
            self.phase = 'CREATE_PROCESS'
            if not self.api.CreateProcessW(executable, command, None, None, False, 0x00080000 | 0x00000400 | 0x00000004,
                                           block, cwd, ctypes.byref(startup), ctypes.byref(self.process)):
                raise WindowsPtyFailure('CREATE_PROCESS')
            self.phase = 'ASSIGN_JOB'
            if not self.api.AssignProcessToJobObject(self.job, self.process.hProcess):
                raise WindowsPtyFailure('ASSIGN_JOB')
            self.phase = 'RESUME'
            if self.api.ResumeThread(self.process.hThread) == 0xffffffff:
                raise WindowsPtyFailure('RESUME')
            self.api.CloseHandle(self.process.hThread)
            self.process.hThread = None
            for handle in [input_read, output_write]:
                self.api.CloseHandle(handle)
                self.handles.remove(handle)
        except BaseException as error:
            self.close()
            if not isinstance(error, WindowsPtyFailure):
                raise WindowsPtyFailure(self.phase) from None
            raise
        finally:
            if attributes is not None:
                self.api.DeleteProcThreadAttributeList(attributes)

    def pipe(self):
        read, write = w.HANDLE(), w.HANDLE()
        if not self.api.CreatePipe(ctypes.byref(read), ctypes.byref(write), None, 0):
            raise WindowsPtyFailure('CREATE_PIPE')
        self.handles.extend([read, write])
        return read, write

    def drain(self):
        buffer = ctypes.create_string_buffer(65536)
        count = w.DWORD()
        try:
            while self.api.ReadFile(self.output_read, buffer, len(buffer), ctypes.byref(count), None) and count.value:
                try:
                    self.output.put_nowait(buffer.raw[:count.value])
                except queue.Full:
                    self.overflow.set()
                    # Continue draining even after failure, so console teardown cannot deadlock.
        finally:
            self.eof.set()

    def read(self, timeout=.1):
        if self.overflow.is_set():
            raise WindowsPtyFailure('OUTPUT_LIMIT')
        try:
            return self.output.get(timeout=timeout)
        except queue.Empty:
            return None

    def write(self, data):
        written = w.DWORD()
        buffer = ctypes.create_string_buffer(data)
        if not self.api.WriteFile(self.input_write, buffer, len(data), ctypes.byref(written), None) or written.value != len(data):
            raise WindowsPtyFailure('WRITE')

    def poll(self):
        code = w.DWORD()
        if not self.api.GetExitCodeProcess(self.process.hProcess, ctypes.byref(code)):
            raise WindowsPtyFailure('POLL')
        return None if code.value == 259 else code.value

    def close(self):
        failed = False
        if self.process.hProcess:
            self.api.TerminateProcess(self.process.hProcess, 1)
        if self.job:
            self.api.CloseHandle(self.job)
            self.job = None
        if self.process.hProcess:
            failed = self.api.WaitForSingleObject(self.process.hProcess, 5000) != 0
        if self.console:
            self.api.ClosePseudoConsole(self.console)
            self.console = w.HANDLE()
        for handle in self.handles:
            self.api.CloseHandle(handle)
        self.handles = []
        for handle in [self.process.hThread, self.process.hProcess]:
            if handle:
                self.api.CloseHandle(handle)
        self.process.hProcess = self.process.hThread = None
        if self.reader:
            self.reader.join(timeout=5)
            failed = failed or self.reader.is_alive()
        if failed:
            raise WindowsPtyFailure('CLEANUP')
