"""Actual local configuration Apply while a canonical candidate Bash is held."""
import codecs
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = pathlib.Path(__file__).resolve().parent
classifier_spec = importlib.util.spec_from_file_location('config_classifier', HERE / 'config-race-classifier.py')
classifier = importlib.util.module_from_spec(classifier_spec)
classifier_spec.loader.exec_module(classifier)
spec = importlib.util.spec_from_file_location('config_terminal', HERE / 'interactive-races.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
observer_spec = importlib.util.spec_from_file_location('config_terminal_observer', HERE / 'terminal-observer.py')
observer = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer)

TOKEN_A = 'syntheticcred_ABCDEF0123456789'
TOKEN_B = 'syntheticcred_9876543210ABCDEF'
PROMPT = 'Run the supplied local synthetic tool once.'


def probe(binary, root):
    folder = pathlib.Path(tempfile.mkdtemp(prefix='redacton-config-race-', dir=os.environ.get('REDACTON_PROBE_TMP_ROOT')))
    terminal = None
    server = None
    captures = []
    auxiliary = 0
    failed = False
    private = True
    stage = 'startup'
    held_at_apply = False
    applied = False
    observations = []
    stdout_sanitizes = 0
    helper_outcomes = {}
    try:
        companion = folder / 'companion'
        shutil.copytree(HERE / 'config-race-companion', companion)
        control = folder / 'control.mjs'
        control.write_text("import {appendFileSync,existsSync,writeFileSync} from 'node:fs';appendFileSync(new URL('./executions',import.meta.url),'x');if(process.argv[2]==='hold'){writeFileSync(new URL('./started',import.meta.url),'1');const end=Date.now()+45000;while(!existsSync(new URL('./release',import.meta.url))){if(Date.now()>end)process.exit(1);await new Promise(r=>setTimeout(r,10));}}process.stdout.write((process.argv[2]==='hold'?" + json.dumps(TOKEN_A) + ':' + json.dumps(TOKEN_B) + ")+ '\\n');")

        class Endpoint(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                nonlocal auxiliary, failed, private
                self.connection.settimeout(5)
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2097152:
                    failed = True; self.send_error(413); return
                request = json.loads(self.rfile.read(length))
                serialized = json.dumps(request)
                private = private and TOKEN_B not in serialized and 'config-race-token' not in serialized
                if 'count_tokens' in self.path:
                    self.send_response(200); self.end_headers(); self.wfile.write(b'{"input_tokens":1}'); return
                has_bash = any(tool.get('name') == 'Bash' for tool in request.get('tools', []))
                main = has_bash and request.get('model') == 'claude-sonnet-4-6' and PROMPT in json.dumps(request.get('messages', []))
                if main:
                    if len(captures) >= 4:
                        failed = True; self.send_error(503); return
                    last = next((message.get('content', []) for message in reversed(request['messages']) if message.get('role') == 'user'), [])
                    index = classifier.request_stage(last)
                    if index != len(captures):
                        failed = True; self.send_error(503); return
                    captures.append(request)
                    quote = lambda value: "'" + str(value).replace('\\', '/').replace("'", "'\\''") + "'"
                    command = quote(os.environ.get('REDACTON_NODE_BINARY') or shutil.which('node')) + ' ' + quote(control) + (' hold' if index == 0 else ' output')
                    block = {'type': 'tool_use', 'id': f'config_tool_{index // 2}', 'name': 'Bash', 'input': {'command': command}} if index % 2 == 0 else {'type': 'text', 'text': f'CONFIG_DONE_{index // 2}'}
                else:
                    auxiliary += 1
                    if has_bash or auxiliary > 4:
                        failed = True; self.send_error(503); return
                    block = {'type': 'text', 'text': 'Synthetic local configuration'}
                stop = 'tool_use' if block['type'] == 'tool_use' else 'end_turn'
                message = {'id': 'msg_config', 'type': 'message', 'role': 'assistant', 'model': request.get('model'), 'content': [block], 'stop_reason': stop, 'stop_sequence': None, 'usage': {'input_tokens': 1, 'output_tokens': 1}}
                self.send_response(200); self.send_header('content-type', 'text/event-stream' if request.get('stream') else 'application/json'); self.end_headers()
                if not request.get('stream'):
                    self.wfile.write(json.dumps(message).encode()); return
                def send(kind, value):
                    self.wfile.write(f'event: {kind}\ndata: {json.dumps({"type":kind, **value})}\n\n'.encode()); self.wfile.flush()
                tool = block['type'] == 'tool_use'
                send('message_start', {'message': {**message, 'content': [], 'stop_reason': None}})
                send('content_block_start', {'index': 0, 'content_block': {**block, 'input': {}} if tool else {'type': 'text', 'text': ''}})
                send('content_block_delta', {'index': 0, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(block['input'])} if tool else {'type': 'text_delta', 'text': block['text']}})
                send('content_block_stop', {'index': 0}); send('message_delta', {'delta': {'stop_reason': stop, 'stop_sequence': None}, 'usage': {'output_tokens': 1}}); send('message_stop', {})

        class Server(HTTPServer):
            def handle_error(self, *_):
                nonlocal failed
                failed = True
        server = Server(('127.0.0.1', 0), Endpoint)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        config = folder / 'config'; config.mkdir()
        (config / '.claude.json').write_text(json.dumps({'hasCompletedOnboarding': True, 'theme': 'dark', 'projects': {str(folder): {'hasTrustDialogAccepted': True}}}))
        env = {name: os.environ[name] for name in ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'] if name in os.environ}
        env.update({'HOME': str(folder), 'USERPROFILE': str(folder), 'APPDATA': str(folder / 'appdata'), 'LOCALAPPDATA': str(folder / 'localappdata'), 'TEMP': str(folder), 'TMP': str(folder), 'TERM': 'xterm-256color', 'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CONFIG_DIR': str(config), 'REDACTON_SETTINGS_ROOT': str(folder / 'settings'), 'ANTHROPIC_API_KEY': 'synthetic-local-only', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{server.server_port}', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
        terminal = driver.Terminal(binary, ['--plugin-dir', str(root), '--plugin-dir', str(companion), '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk', '--allowedTools', 'Bash', '--model', 'claude-sonnet-4-6'], str(folder), env)
        screen, emulator = observer.make_observer(140, 40, terminal.write)
        decoder = codecs.getincrementaldecoder('utf8')(errors='replace')
        history = ''; trust = False; key = False; tabs = 0; changed_at = time.monotonic()
        def visible(label):
            return bool(re.search(r'[\s│┃]*'.join(re.escape(c) for c in label if not c.isspace()), '\n'.join(screen.display)))
        def focused(label):
            text = '\n'.join(screen.display); positions = []
            for row, line in enumerate(screen.display):
                positions.extend((row, col) for col in range(len(line))); positions.append(None)
            for match in re.finditer(r'[\s│┃]*'.join(re.escape(c) for c in label if not c.isspace()), text):
                cells = [positions[index] for index in range(match.start(), match.end()) if not text[index].isspace() and text[index] not in '│┃']
                if cells and all(screen.buffer[row][col].reverse for row, col in cells): return True
            return False
        def field(label):
            return any(label in line and screen.cursor.y == row and screen.cursor.x >= line.index(label) for row, line in enumerate(screen.display))
        def send(value='', enter=True):
            if value: terminal.write(value.encode()); time.sleep(.15)
            if enter: terminal.write(b'\r')
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            chunk = terminal.read()
            if chunk == b'' or (chunk is None and terminal.poll() is not None): break
            if chunk:
                text = decoder.decode(chunk); emulator.feed(text); history = (history + text)[-65536:]
                helper_outcomes.update(classifier.helper_diagnostics(history))
            view = ' '.join('\n'.join(screen.display).split())
            old_stage = stage
            if stage == 'startup':
                if not trust and any(q in view for q in ['Do you trust the files in this folder?', 'Is this a project you created or one you trust?']): time.sleep(.5); send('\x1b[B'); trust = True
                elif not key and 'Do you want to use this API key?' in view: time.sleep(.5); send('\x1b[A'); key = True
                elif visible('Protect ready'): send(PROMPT); stage = 'hold'
            elif stage == 'hold' and (folder / 'started').exists():
                if len(captures) != 1 or (folder / 'release').exists(): break
                send('/redactconfig'); stage = 'panel'
            elif stage == 'panel' and visible('Local panel has keyboard focus') and focused('Add rule'):
                send(); stage = 'focus-id'
            elif stage == 'focus-id' and field('Rule ID'):
                send('config-race-token'); stage = 'prefix'
            elif stage == 'focus-id' and visible('Rule ID') and time.monotonic() - changed_at > .2:
                if tabs >= 8: break
                send('\t', False); tabs += 1; changed_at = time.monotonic()
            elif stage == 'prefix' and field('Public prefix,'):
                send('syntheticcred_'); stage = 'length'
            elif stage == 'length' and field('Run length,'):
                send('\x15', False); send('16'); stage = 'build'
            elif stage == 'build' and focused('Create draft'): send(); stage = 'validate'
            elif stage == 'validate' and visible('Draft ready') and focused('Validate'): send(); stage = 'preview'
            elif stage == 'preview' and visible('Core validation passed') and focused('Synthetic preview'): send(); stage = 'apply'
            elif stage == 'apply' and visible('Synthetic sample outcomes') and focused('Apply session') and visible('positive redact, negative none'):
                send(); stage = 'applied'
            elif stage == 'applied' and visible('Applied to session') and visible('Protect ready'):
                held_at_apply = len(captures) == 1 and not (folder / 'release').exists() and (folder / 'executions').read_text() == 'x'
                if not held_at_apply: break
                applied = True; terminal.write(b'\x1b'); stage = 'close'
            elif stage == 'close' and not visible('Local declarative patterns only'):
                (folder / 'release').write_text('1'); stage = 'first'
            elif stage == 'first' and visible('CONFIG_DONE_0'): send('/config-race-report'); history = ''; stage = 'first-report'
            elif stage == 'first-report':
                total = re.search(r'CONFIG_RACE_REPORT_1_([0-3])_', history)
                if total: stdout_sanitizes = int(total.group(1))
                match = re.search(r'CONFIG_RACE_REPORT_1_1_1_(cfg-[0-9]+-[0-9]+)_0_1', history)
                if match: observations.append(match.group(1)); send('Run the second supplied local synthetic tool once.'); stage = 'second'
            elif stage == 'second' and visible('CONFIG_DONE_1'): send('/config-race-report'); history = ''; stage = 'second-report'
            elif stage == 'second-report':
                total = re.search(r'CONFIG_RACE_REPORT_2_([0-3])_', history)
                if total: stdout_sanitizes = int(total.group(1))
                match = re.search(r'CONFIG_RACE_REPORT_2_2_2_(cfg-[0-9]+-[0-9]+)_0_1_(cfg-[0-9]+-[0-9]+)_1_1', history)
                if match and match.group(1) == observations[0]: observations.append(match.group(2)); stage = 'complete'; break
            if stage != old_stage: changed_at = time.monotonic()
            if stage in ['panel', 'prefix', 'length', 'build', 'validate', 'preview', 'apply', 'applied', 'close', 'first-report', 'second-report'] and time.monotonic() - changed_at > 6: break
        if stage == 'startup' and terminal.windows:
            terminal.windows.startup_diagnostic(history)
        results = {}
        for request in captures:
            for message in request.get('messages', []):
                for block in message.get('content', []) if isinstance(message.get('content'), list) else []:
                    if block.get('type') == 'tool_result': results[block.get('tool_use_id')] = block
        first = json.dumps(results.get('config_tool_0')); second = json.dumps(results.get('config_tool_1'))
        executions = (folder / 'executions').stat().st_size if (folder / 'executions').exists() else 0
        outcome = {'stage': stage, 'appliedWhileHeld': held_at_apply and applied, 'executions': executions, 'stdoutSanitizes': stdout_sanitizes, 'modelRequests': len(captures), 'auxiliaryRequests': auxiliary, 'oldConfigurationObserved': len(observations) >= 1, 'newConfigurationObserved': len(observations) == 2 and observations[0] != observations[1], 'firstRawObserved': TOKEN_A in first, 'secondMaskedObserved': TOKEN_B not in second and '<SECRET_1>' in second, 'toolResultCount': len(results), 'toolResultsSuccessful': len(results) == 2 and all(value.get('is_error') is not True for value in results.values()), 'privateEveryRequest': private, 'endpointFailed': failed}
        diagnostic = {'code': 'CONFIG_HELPER_DIAGNOSTICS', 'helpers': [helper_outcomes[index] for index in (1, 2) if index in helper_outcomes], 'secondToolCode': classifier.second_tool_code(results.get('config_tool_1'))}
    finally:
        try:
            if terminal: terminal.close()
        finally:
            if server: server.shutdown(); server.server_close()
            shutil.rmtree(folder)
    outcome['privateEveryRequest'] = private
    outcome['endpointFailed'] = failed
    outcome['auxiliaryRequests'] = auxiliary
    outcome['status'] = 'passed' if stage == 'complete' and held_at_apply and applied and executions == 2 and stdout_sanitizes == 2 and len(captures) == 4 and len(observations) == 2 and observations[0] != observations[1] and TOKEN_A in first and TOKEN_B not in second and '<SECRET_1>' in second and outcome['toolResultsSuccessful'] and private and not failed else 'blocked' if stage == 'panel' and len(captures) == 1 and not failed else 'failed'
    return outcome, diagnostic


def main():
    binary = os.path.abspath(os.environ.get('CLAUDE_BINARY', shutil.which('claude') or 'claude'))
    version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=10)
    if version.returncode or not version.stdout.startswith('2.1.294 '): raise RuntimeError('CONFIG_RACE_HOST_UNAVAILABLE')
    root = pathlib.Path(sys.argv[sys.argv.index('--plugin-root') + 1]).resolve()
    before = hashlib.sha256((root / 'mod/index.tsx').read_bytes()).hexdigest()
    row, diagnostic = probe(binary, root)
    if hashlib.sha256((root / 'mod/index.tsx').read_bytes()).hexdigest() != before: raise RuntimeError('CONFIG_RACE_SOURCE_CHANGED')
    pathlib.Path(sys.argv[sys.argv.index('--report') + 1]).write_text(json.dumps({'hostVersion': '2.1.294', 'modSourceSha256': before, 'row': row}))
    print(json.dumps(diagnostic))
    return 0 if row['status'] == 'passed' else 1


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception:
        print(json.dumps({'code': 'CONFIG_RACE_PROBE_FAILED'})); sys.exit(1)
