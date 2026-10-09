"""Actual terminal policy races, with synthetic loopback model delivery only."""
import codecs
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

def interrupted(_signal, _frame):
    raise SystemExit(143)

signal.signal(signal.SIGTERM, interrupted)

if os.environ.get('REDACTON_PYTE_PATH'):
    sys.path.insert(0, os.environ['REDACTON_PYTE_PATH'])
import pyte

SYNTHETIC = 'ghp_SYNTHETICREVOKED00000000000000000000'
SYNTHETIC_SECOND = 'ghp_SYNTHETICREVOKED00000000000000000001'
HERE = os.path.dirname(os.path.abspath(__file__))


class Terminal:
    def __init__(self, executable, arguments, folder, env):
        self.windows = None
        self.exit_code = None
        self.reaped = False
        if os.name == 'nt':
            spec = importlib.util.spec_from_file_location('race_windows_pty', os.path.join(HERE, 'windows-pty.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.windows = module.WindowsPty(executable, arguments, folder, env, 140)
        else:
            import fcntl
            import pty
            import struct
            import termios
            self.pid, self.master = pty.fork()
            if self.pid == 0:
                try:
                    os.chdir(folder)
                    os.execvpe(executable, [executable, *arguments], env)
                except Exception:
                    os.write(1, b'RACE_CHILD_EXEC_FAILED\n')
                    os._exit(1)
            os.set_blocking(self.master, False)
            fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))

    def read(self):
        if self.windows:
            return self.windows.read(.05)
        import select
        if select.select([self.master], [], [], .05)[0]:
            try:
                return os.read(self.master, 65536)
            except OSError:
                return b''
        return None

    def write(self, value):
        if self.windows:
            self.windows.write(value)
        else:
            os.write(self.master, value)

    def poll(self):
        if self.windows:
            return self.windows.poll()
        if self.exit_code is None:
            status = os.waitid(os.P_PID, self.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            if status:
                self.exit_code = status.si_status if status.si_code == os.CLD_EXITED else -status.si_status
        return self.exit_code

    def close(self):
        if self.reaped:
            return
        if self.windows:
            self.windows.close()
        else:
            # The PTY child owns this process group, including its Bash children.
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except PermissionError:
                if self.poll() is None:
                    raise RuntimeError('RACE_PTY_CLEANUP_FAILED')
            # poll deliberately keeps the direct child unreaped, so its PID and
            # original process-group ID cannot be reused before this cleanup.
            if self.poll() is None:
                try:
                    os.kill(self.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            os.close(self.master)
            deadline = time.monotonic() + 5
            while self.poll() is None and time.monotonic() < deadline:
                time.sleep(.01)
            if self.exit_code is None:
                raise RuntimeError('RACE_PTY_CLEANUP_FAILED')
            os.waitpid(self.pid, 0)
            self.reaped = True


def run_direction(binary, root, direction):
    folder = tempfile.mkdtemp(prefix='redacton-interactive-race-', dir=os.environ.get('REDACTON_PROBE_TEMP'))
    terminal = None
    server = None
    captures = []
    auxiliary_requests = 0
    phase = 'startup'
    phase_verified = False
    toggle_observed = False
    scans = []
    trust_answered = False
    key_answered = False
    release = os.path.join(folder, 'release')
    started = os.path.join(folder, 'started')
    control = os.path.join(folder, 'control.mjs')
    protected_marker = SYNTHETIC if direction == 'on-to-off' else SYNTHETIC_SECOND
    try:
        companion = os.path.join(folder, 'companion')
        shutil.copytree(os.path.join(HERE, 'race-companion'), companion)
        with open(control, 'w') as stream:
            stream.write("import {existsSync,writeFileSync,appendFileSync} from 'node:fs';\n"
                         "const start=new URL('./started',import.meta.url),release=new URL('./release',import.meta.url),counter=new URL('./executions',import.meta.url);\n"
                         "appendFileSync(counter,'x');if(process.argv[2]==='hold'){writeFileSync(start,'1');const deadline=Date.now()+12000;while(!existsSync(release)){if(Date.now()>deadline)process.exit(1);await new Promise(r=>setTimeout(r,10));}}\n"
                         f"process.stdout.write((process.argv[2]==='hold'?{json.dumps(SYNTHETIC)}:{json.dumps(SYNTHETIC_SECOND)})+'\\n');\n")

        class Endpoint(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                nonlocal auxiliary_requests
                self.connection.settimeout(5)
                length = int(self.headers.get('Content-Length', '0'))
                if length > 2097152:
                    self.send_error(413)
                    return
                request = json.loads(self.rfile.read(length))
                if protected_marker in json.dumps(request):
                    server.privacy_failed = True
                if 'count_tokens' in self.path:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"input_tokens":1}')
                    return
                has_bash = any(tool.get('name') == 'Bash' for tool in request.get('tools', []))
                main = has_bash and request.get('model') == 'claude-sonnet-4-6' and 'Run the supplied local synthetic tool once.' in json.dumps(request.get('messages', []))
                if not main:
                    auxiliary_requests += 1
                    if has_bash or auxiliary_requests > 4:
                        server.failed = True
                        self.send_error(503)
                        return
                    message = {'id': 'msg_race_auxiliary', 'type': 'message', 'role': 'assistant', 'model': request.get('model'),
                               'content': [{'type': 'text', 'text': 'Synthetic local race'}], 'stop_reason': 'end_turn', 'stop_sequence': None,
                               'usage': {'input_tokens': 1, 'output_tokens': 1}}
                    self.send_response(200)
                    self.send_header('content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(message).encode())
                    return
                if len(captures) >= 4:
                    server.failed = True
                    self.send_error(503)
                    return
                last_user = next((message for message in reversed(request['messages']) if message.get('role') == 'user'), {})
                last_content = last_user.get('content', [])
                tool_ids = [block.get('tool_use_id') for block in last_content if isinstance(block, dict) and block.get('type') == 'tool_result'] if isinstance(last_content, list) else []
                if 'race_tool_1' in tool_ids:
                    stage = 3
                elif 'race_tool_0' in tool_ids:
                    stage = 1
                elif 'Run the second supplied local synthetic tool once.' in json.dumps(last_content):
                    stage = 2
                elif 'Run the supplied local synthetic tool once.' in json.dumps(last_content):
                    stage = 0
                else:
                    stage = -1
                if stage != len(captures):
                    server.failed = True
                    self.send_error(503)
                    return
                index = stage // 2
                tool = stage % 2 == 0
                captures.append(request)
                def shell_path(value):
                    return "'" + value.replace('\\', '/').replace("'", "'\\''") + "'"
                quoted = shell_path(control)
                node = shell_path(os.environ.get('REDACTON_NODE_BINARY') or shutil.which('node'))
                content = [{'type': 'tool_use', 'id': f'race_tool_{index}', 'name': 'Bash',
                            'input': {'command': f'{node} {quoted} ' + ('hold' if index == 0 else 'output')}}] if tool else [{'type': 'text', 'text': f'RACE_DONE_{index}'}]
                message = {'id': f'msg_race_{len(captures)}', 'type': 'message', 'role': 'assistant', 'model': 'claude-sonnet-4-6',
                           'content': content, 'stop_reason': 'tool_use' if tool else 'end_turn', 'stop_sequence': None,
                           'usage': {'input_tokens': 1, 'output_tokens': 1}}
                self.send_response(200)
                self.send_header('content-type', 'text/event-stream' if request.get('stream') else 'application/json')
                self.end_headers()
                if not request.get('stream'):
                    self.wfile.write(json.dumps(message).encode())
                    return
                def send(kind, value):
                    self.wfile.write(f'event: {kind}\ndata: {json.dumps({"type": kind, **value})}\n\n'.encode())
                    self.wfile.flush()
                send('message_start', {'message': {**message, 'content': [], 'stop_reason': None}})
                send('content_block_start', {'index': 0, 'content_block': {**content[0], 'input': {}} if tool else {'type': 'text', 'text': ''}})
                send('content_block_delta', {'index': 0, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(content[0]['input'])} if tool else {'type': 'text_delta', 'text': content[0]['text']}})
                send('content_block_stop', {'index': 0})
                send('message_delta', {'delta': {'stop_reason': message['stop_reason'], 'stop_sequence': None}, 'usage': {'output_tokens': 1}})
                send('message_stop', {})

        class BoundedServer(HTTPServer):
            def handle_error(self, *_args):
                self.failed = True
        server = BoundedServer(('127.0.0.1', 0), Endpoint)
        server.failed = False
        server.privacy_failed = False
        threading.Thread(target=server.serve_forever, daemon=True).start()
        config = os.path.join(folder, 'config')
        os.mkdir(config)
        with open(os.path.join(config, '.claude.json'), 'w') as stream:
            json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'projects': {folder: {'hasTrustDialogAccepted': True}}}, stream)
        env = {'PATH': os.environ['PATH'], 'HOME': folder, 'TERM': 'xterm-256color', 'DISABLE_AUTOUPDATER': '1',
               'USERPROFILE': folder, 'APPDATA': os.path.join(folder, 'appdata'), 'LOCALAPPDATA': os.path.join(folder, 'localappdata'), 'TEMP': folder, 'TMP': folder,
               'CLAUDE_CONFIG_DIR': config, 'REDACTON_SETTINGS_ROOT': os.path.join(folder, 'settings'),
               'ANTHROPIC_API_KEY': 'synthetic-local-only', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{server.server_port}',
               'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
        if os.name == 'nt':
            for name in ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']:
                if name in os.environ:
                    env[name] = os.environ[name]
        terminal = Terminal(binary, ['--plugin-dir', root, '--plugin-dir', companion, '--setting-sources', '',
                                     '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk',
                                     '--allowedTools', 'Bash', '--model', 'claude-sonnet-4-6'], folder, env)
        screen = pyte.Screen(140, 40)
        emulator = pyte.Stream(screen)
        decoder = codecs.getincrementaldecoder('utf8')(errors='replace')
        deadline = time.monotonic() + 20
        toggle_deadline = None
        receipt_buffer = ''
        initial_receipts = 0
        toggle_receipts = 0
        receipt_kind = 'none'
        on_label = 'Redacton ON · Protect ready · Partial coverage'
        off_label = 'Redacton OFF — credential protection disabled'
        target_label = off_label if direction == 'on-to-off' else on_label
        old_label = on_label if direction == 'on-to-off' else off_label
        target_labels_before = 0
        def receipt_count(receipt):
            pattern = r'[\s│┃]*'.join(re.escape(char) for char in receipt if not char.isspace())
            return len(re.findall(pattern, '\n'.join(screen.display)))
        def send(value):
            terminal.write(value.encode())
            time.sleep(.2)
            terminal.write(b'\r')
        while time.monotonic() < deadline:
            chunk = terminal.read()
            if chunk == b'':
                break
            if chunk is None and terminal.poll() is not None:
                break
            if chunk:
                text = decoder.decode(chunk)
                emulator.feed(text)
                receipt_buffer = (receipt_buffer + text)[-65536:]
                if '\x1b[6n' in text:
                    terminal.write(f'\x1b[{screen.cursor.y+1};{screen.cursor.x+1}R'.encode())
                if '\x1b[c' in text:
                    terminal.write(b'\x1b[?1;2c')
                if '\x1b[>c' in text:
                    terminal.write(b'\x1b[>0;95;0c')
            view = ' '.join('\n'.join(screen.display).split())
            if phase == 'startup':
                if not trust_answered and any(question in view for question in ['Do you trust the files in this folder?', 'Is this a project you created or one you trust?']):
                    time.sleep(1)
                    send('\x1b[B')
                    trust_answered = True
                elif not key_answered and 'Do you want to use this API key?' in view:
                    time.sleep(1)
                    send('\x1b[A')
                    key_answered = True
                elif 'Protect ready' in view:
                    initial_receipts = receipt_count('Redacton ON.' if direction == 'on-to-off' else 'Warning: Redacton is OFF.')
                    send('/redacton' if direction == 'on-to-off' else '/redactoff')
                    receipt_buffer = ''
                    phase = 'initial'
            elif phase == 'initial' and receipt_count('Redacton ON.' if direction == 'on-to-off' else 'Warning: Redacton is OFF.') > initial_receipts:
                send('Run the supplied local synthetic tool once.')
                receipt_buffer = ''
                phase = 'hold'
            elif phase == 'hold' and os.path.exists(started):
                if len(captures) != 1 or os.path.exists(release):
                    break
                toggle_receipts = receipt_count('Warning: Redacton is OFF.' if direction == 'on-to-off' else 'Redacton ON.')
                target_labels_before = receipt_count(target_label)
                if target_labels_before != 0 or receipt_count(old_label) != 1:
                    break
                send('/redactoff' if direction == 'on-to-off' else '/redacton')
                receipt_buffer = ''
                toggle_deadline = time.monotonic() + 4
                phase = 'toggle'
            elif phase == 'toggle':
                receipt = 'Warning: Redacton is OFF.' if direction == 'on-to-off' else 'Redacton ON.'
                # Composer drafts echo the slash name, never this full handler receipt.
                handler_receipt = receipt_count(receipt) > toggle_receipts
                status_receipt = receipt_count(target_label) == 1 and receipt_count(old_label) == 0 and target_labels_before == 0
                if handler_receipt or status_receipt:
                    toggle_observed = True
                    receipt_kind = 'handler' if handler_receipt else 'prompt-policy'
                    phase_verified = len(captures) == 1 and not os.path.exists(release)
                    if not phase_verified:
                        break
                    with open(release, 'w') as stream:
                        stream.write('1')
                    phase = 'first'
                elif time.monotonic() > toggle_deadline:
                    break
            elif phase == 'first' and 'RACE_DONE_0' in view:
                send('/race-report')
                receipt_buffer = ''
                phase = 'first-report'
            elif phase == 'first-report' and re.search(r'RACE_REPORT_(\d+)_1\b', receipt_buffer):
                scans.append(int(re.findall(r'RACE_REPORT_(\d+)_1\b', receipt_buffer)[-1]))
                send('Run the second supplied local synthetic tool once.')
                receipt_buffer = ''
                phase = 'second'
            elif phase == 'second' and 'RACE_DONE_1' in view:
                send('/race-report')
                receipt_buffer = ''
                phase = 'second-report'
            elif phase == 'second-report' and re.search(r'RACE_REPORT_(\d+)_2\b', receipt_buffer):
                scans.append(int(re.findall(r'RACE_REPORT_(\d+)_2\b', receipt_buffer)[-1]))
                phase = 'complete'
                break
        results = {}
        for request in captures:
            for message in request.get('messages', []):
                content = message.get('content', [])
                for block in content if isinstance(content, list) else []:
                    if block.get('type') == 'tool_result':
                        results[block.get('tool_use_id')] = block
        first = json.dumps(results.get('race_tool_0'))
        second = json.dumps(results.get('race_tool_1'))
        executions = os.path.getsize(os.path.join(folder, 'executions')) if os.path.isfile(os.path.join(folder, 'executions')) else 0
        correct = ((scans == [1, 1] and SYNTHETIC not in first and '<SECRET_1>' in first and SYNTHETIC_SECOND in second)
                   if direction == 'on-to-off' else
                   (scans == [0, 1] and SYNTHETIC in first and SYNTHETIC_SECOND not in second and '<SECRET_1>' in second))
        passed = phase == 'complete' and phase_verified and len(captures) == 4 and executions == 2 and correct and not server.failed
        unavailable = not phase_verified and phase == 'toggle' and not server.failed and terminal.poll() is None
        outcome = {'direction': direction, 'status': 'passed' if passed else 'blocked' if unavailable else 'failed',
                'code': 'RACE_PASSED' if passed else 'RACE_PHASE_UNAVAILABLE' if unavailable else 'RACE_BOUNDARY_FAILED',
                'phaseVerified': phase_verified, 'toggleObserved': toggle_observed, 'executions': executions,
                'receiptKind': receipt_kind,
                'firstScans': scans[0] if scans else -1, 'finalScans': scans[-1] if len(scans) == 2 else -1,
                'modelRequests': len(captures), 'auxiliaryRequests': auxiliary_requests, 'finalStage': phase, 'childExitCode': terminal.poll(), 'terminalBytes': len(receipt_buffer),
                'firstResultError': results.get('race_tool_0', {}).get('is_error') is True,
                'firstResultPresent': 'race_tool_0' in results,
                'toolResultCount': len(results),
                'toggleDiagnostics': {'onIndicator': 'Redacton ON' in view, 'offIndicator': 'Redacton OFF' in view, 'queued': 'queued' in view.lower(),
                                      'offReceiptCount': receipt_count('Warning: Redacton is OFF.'), 'onReceiptCount': receipt_count('Redacton ON.'),
                                      'receiptBaseline': toggle_receipts, 'targetLabelsBefore': target_labels_before, 'onPolicyLabels': receipt_count(on_label), 'offPolicyLabels': receipt_count(off_label),
                                      'slashDraftVisible': ('/redactoff' if direction == 'on-to-off' else '/redacton') in view},
                'toolDiagnostics': [value for value in ['permission', 'denied', 'not allowed', 'not found', 'No such', 'outside', 'not authorized', 'policy', 'REDACTON_', 'Exit code', 'SyntaxError'] if value.lower() in first.lower()],
                'startupDiagnostics': [value for value in ['RACE_CHILD_EXEC_FAILED', 'unknown option', 'only works', 'only supported', 'permission-mode', 'setting-sources', 'plugin-dir', 'no-session-persistence', 'ENOENT', 'EACCES', 'error:', 'requires', 'must be', 'Cannot', 'non-interactive', 'Bun', 'panic', 'assert', 'Segmentation', 'Illegal', 'dyld', 'Permission', 'spawn', 'EPERM', 'Using', 'auth', 'API', 'Welcome', 'trust', 'Error', 'TypeError', 'ReferenceError'] if value in receipt_buffer] if phase == 'startup' else []}
        if phase == 'startup' and terminal.windows:
            terminal.windows.startup_diagnostic(receipt_buffer)
        outcome['startupState'] = {'trustAnswered': trust_answered, 'keyAnswered': key_answered,
                                   'trustQuestion': any(value in view for value in ['Do you trust the files in this folder?', 'Is this a project you created or one you trust?']),
                                   'keyQuestion': 'Do you want to use this API key?' in view,
                                   'ready': 'Protect ready' in view, 'loading': 'loading' in view, 'unavailable': 'unavailable' in view,
                                   'trustChoiceYes': 'Yes, I trust' in view, 'keyChoiceYes': 'Yes' in view}
    finally:
        try:
            if terminal:
                terminal.close()
        finally:
            if server:
                server.shutdown()
                server.server_close()
            shutil.rmtree(folder)
    # Include auxiliary/title payloads through shutdown, while permitting the
    # distinct marker from the intentionally OFF operation's earlier history.
    outcome['protectedMarkerAbsentEveryRequest'] = not server.privacy_failed
    if server.privacy_failed:
        outcome['status'] = 'failed'
        outcome['code'] = 'RACE_BOUNDARY_FAILED'
    return outcome


def main():
    binary = os.path.abspath(os.environ.get('CLAUDE_BINARY', shutil.which('claude') or 'claude'))
    version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=10)
    if version.returncode or not version.stdout.startswith('2.1.294 '):
        raise RuntimeError('HOST_VERSION_UNAVAILABLE')
    root = os.path.abspath(sys.argv[sys.argv.index('--plugin-root')+1])
    results = [run_direction(binary, root, direction) for direction in ['on-to-off', 'off-to-on']]
    with open(os.path.join(root, 'mod/index.tsx'), 'rb') as source:
        source_digest = hashlib.sha256(source.read()).hexdigest()
    report = {'hostVersion': '2.1.294', 'modSourceSha256': source_digest, 'results': results}
    if '--report' in sys.argv:
        with open(sys.argv[sys.argv.index('--report')+1], 'w') as stream:
            json.dump(report, stream)
    print(json.dumps(report))
    return 1 if any(row['status'] == 'failed' for row in results) else 2 if any(row['status'] == 'blocked' for row in results) else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        frame = error.__traceback__
        line = 0
        while frame:
            if frame.tb_frame.f_code.co_filename == __file__:
                line = frame.tb_lineno
            frame = frame.tb_next
        print(json.dumps({'code': 'RACE_PROBE_FAILED', 'sourceLine': line}))
        sys.exit(1)
