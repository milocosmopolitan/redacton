"""Actual isolated terminal warning check; optional task-local pyte dependency."""
import hashlib
import json
import os
import shutil
import signal
import tempfile
import time
import sys
import subprocess
import re
import threading
import codecs
if os.name != 'nt':
    import fcntl
    import pty
    import termios
    import struct
    import select
from http.server import BaseHTTPRequestHandler, HTTPServer
if os.environ.get("REDACTON_PYTE_PATH"):
    sys.path.insert(0, os.environ["REDACTON_PYTE_PATH"])
import pyte

def prepare_ui_companion(fixture_root, folder, node_binary):
    ui_companion = os.path.join(folder, 'ui-companion')
    shutil.copytree(os.path.join(fixture_root, 'qualification/ui-companion'), ui_companion)
    if not node_binary:
        raise SystemExit('UI_FIXTURE_NODE_UNAVAILABLE')
    fixture_script = os.path.join(folder, 'ui-counter.mjs')
    with open(fixture_script, 'w', encoding='utf8') as stream:
        stream.write("import {appendFileSync} from 'node:fs';appendFileSync(new URL('./ui-execution-counter',import.meta.url),'x');process.stdout.write('syntheticcred_ABCDEF0123456789\\n');process.stderr.write('syntheticcred_ABCDEF0123456789\\n');")
    def shell_path(value):
        return "'" + value.replace('\\', '/').replace("'", "'\\''") + "'"
    fixture_command = shell_path(os.path.abspath(node_binary)) + ' ' + shell_path(fixture_script)
    register_path = os.path.join(ui_companion, 'hooks/register.js')
    with open(register_path, encoding='utf8') as stream:
        register = stream.read()
    command_pattern = r'command:"(?:[^"\\]|\\.)*"'
    commands = list(re.finditer(command_pattern, register))
    if len(commands) != 1 or 'ui-execution-counter' not in commands[0].group():
        raise SystemExit('UI_FIXTURE_INVALID')
    register = re.sub(command_pattern, lambda _: 'command:' + json.dumps(fixture_command), register)
    with open(register_path, 'w', encoding='utf8') as stream:
        stream.write(register)
    return ui_companion

host_binary = os.environ.get('CLAUDE_BINARY', 'claude')
version_run = subprocess.run([host_binary, '--version'], capture_output=True, text=True, timeout=10)
version_match = re.match(r'([0-9]+\.[0-9]+\.[0-9]+)\s', version_run.stdout)
if version_run.returncode or not version_match:
    raise SystemExit('HOST_VERSION_UNAVAILABLE')
host_version = version_match.group(1)

root = os.path.abspath(sys.argv[sys.argv.index('--plugin-root') + 1] if '--plugin-root' in sys.argv else '.')
ux_mode = '--ux' in sys.argv
fixture_root=os.path.abspath(sys.argv[sys.argv.index('--fixture-root')+1] if '--fixture-root' in sys.argv else root)
model_requests = 0
class Endpoint(BaseHTTPRequestHandler):
    def do_POST(self):
        global model_requests
        self.rfile.read(int(self.headers.get('Content-Length','0')))
        if 'count_tokens' not in self.path:
            model_requests += 1
        self.send_response(503)
        self.end_headers()
    def log_message(self, *_args):
        pass
server = HTTPServer(('127.0.0.1',0), Endpoint)
threading.Thread(target=server.serve_forever,daemon=True).start()
folder = tempfile.mkdtemp(prefix='redacton-normal-ui-',dir=os.environ.get('REDACTON_PROBE_TMP_ROOT'))
config = os.path.join(folder, 'config')
os.mkdir(config)
with open(os.path.join(config, '.claude.json'), 'w') as stream:
    json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'projects': {folder: {'hasTrustDialogAccepted': True}}}, stream)
env = {key: os.environ[key] for key in ['PATH', 'HOME', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'] if key in os.environ}
env.update({'HOME': folder, 'USERPROFILE': folder, 'APPDATA': os.path.join(folder, 'appdata'), 'LOCALAPPDATA': os.path.join(folder, 'localappdata'), 'TEMP': folder, 'TMP': folder, 'DISABLE_AUTOUPDATER': '1', 'TERM': 'xterm-256color', 'CLAUDE_CONFIG_DIR': config, 'ANTHROPIC_API_KEY': 'synthetic-local-only', 'REDACTON_SETTINGS_ROOT': os.path.join(folder,'settings'), 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{server.server_port}', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
try:
    ui_companion = prepare_ui_companion(fixture_root, folder, shutil.which('node'))
    arguments = ['--plugin-dir', root, '--plugin-dir', ui_companion, '--plugin-dir', os.path.join(fixture_root,'qualification/helper-counter'), '--allowedTools','Bash', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
except BaseException:
    shutil.rmtree(folder, ignore_errors=True)
    server.shutdown();server.server_close()
    raise

columns=int(os.environ.get('REDACTON_UI_COLUMNS','140'))
windows_pty = None
try:
    if os.name == 'nt':
        import importlib.util
        spec = importlib.util.spec_from_file_location('redacton_windows_pty', os.path.join(os.path.dirname(__file__), 'windows-pty.py'))
        backend = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backend)
        windows_pty = backend.WindowsPty(os.path.abspath(shutil.which(host_binary) or host_binary), arguments, folder, env, columns)
    else:
        pid, master = pty.fork()
        if pid == 0:
            os.chdir(folder)
            os.execvpe(host_binary, [host_binary, *arguments], env)
        os.set_blocking(master, False)
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 40, columns, 0, 0))
except BaseException:
    shutil.rmtree(folder, ignore_errors=True)
    server.shutdown();server.server_close()
    raise

def write_terminal(data):
    if windows_pty:
        windows_pty.write(data)
    else:
        os.write(master, data)

def read_terminal():
    if windows_pty:
        return windows_pty.read(.1)
    if select.select([master], [], [], .1)[0]:
        try:
            return os.read(master, 65536)
        except OSError:
            return b''
    return None

decoder = codecs.getincrementaldecoder('utf8')(errors='replace')
import importlib.util
observer_spec = importlib.util.spec_from_file_location('redacton_terminal_observer', os.path.join(os.path.dirname(__file__), 'terminal-observer.py'))
observer_module = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer_module)
screen, terminal = observer_module.make_observer(columns, 40, write_terminal)
raw = ''
exit_code = None
stage = 'startup'
off_action_counts = {'createDraft': 0, 'validate': 0, 'focusTabs': 0}
off_input_counts = {'ruleIdEntries': 0, 'prefixEntries': 0, 'lengthClears': 0, 'lengthEntries': 0, 'lengthSubmits': 0}
off_frames = []
last_observed_stage = None
off_length_settled = False
probe_start = time.monotonic()
stage_time = time.monotonic()
trust_answered = False
key_answered = False
observations = {'renderer': 'normal-terminal', 'terminalRows': 40, 'terminalColumns': columns,
                'emulator': 'pyte 0.8.2', 'trustAnswered': False, 'apiKeyAnswered': False,
                'offCommandExecuted': False, 'immediateWarningObserved': False,
                'warningBeforeTyping': False, 'warningAfterTyping': False,
                'onCommandExecuted': False, 'offWarningClearedOn': False,
                'repeatedOffWarningRestored': False, 'actualBashCompletedWhileOff': False,
                'warningAfterActualBash': False, 'uxMode':ux_mode, 'autocompleteExactNames':False, 'localArgsRejected':False, 'formOpened':False, 'draftCreated':False, 'validated':False,'previewed':False,'applied':False,'escapeClosed':False,'uiAppliedCustomEffect':False,'removed':False,'reverted':False,'offPanelWarning':False,'offValidationRejected':False,'offHelperCountUnchanged':False,'offToolOriginalPreserved':False}

def poll():
    global exit_code
    if windows_pty:
        return windows_pty.poll()
    if exit_code is None:
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            exit_code = os.waitstatus_to_exitcode(status)
    return exit_code

def send(value, enter=False):
    if value and stage == 'off-form':
        off_input_counts['ruleIdEntries'] += 1
    if value and stage == 'off-id':
        off_input_counts['prefixEntries'] += 1
    if stage == 'off-prefix':
        if value == '\x15':
            off_input_counts['lengthClears'] += 1
        elif value:
            off_input_counts['lengthEntries'] += 1
        if enter:
            off_input_counts['lengthSubmits'] += 1
    if enter and stage == 'off-length':
        off_action_counts['createDraft'] += 1
    if enter and stage == 'off-draft':
        off_action_counts['validate'] += 1
    write_terminal(value.encode())
    if enter:
        time.sleep(.2)
        write_terminal(b'\r')

def tabs(count):
    for _index in range(count):
        send('\t')
        time.sleep(.15)

def displayed():
    return '\n'.join(screen.display)

def visible_words(value,view):
    import re
    return bool(re.search(r'[\s│┃]*'.join(re.escape(c) for c in value if not c.isspace()),view))

def preview_pairs(view):
    import re
    gap=r'[\s│┃]*'
    def word(value):
        return gap.join(value)
    action='('+'|'.join(word(value) for value in ['redact','block','none'])+')'
    pattern=word('positive')+gap+action+gap+r','+gap+word('negative')+gap+action
    return [(re.sub(gap,'',a),re.sub(gap,'',b)) for a,b in re.findall(pattern,view)]

def focused(label):
    lines = screen.display
    text = '\n'.join(lines)
    positions = []
    for row, line in enumerate(lines):
        positions.extend((row, column) for column in range(len(line)))
        if row + 1 < len(lines):
            positions.append(None)
    pattern = r'[\s│┃]*'.join(re.escape(char) for char in label if not char.isspace())
    for match in re.finditer(pattern, text):
        cells = [positions[index] for index in range(match.start(), match.end()) if not text[index].isspace() and text[index] not in '│┃']
        if cells and all(screen.buffer[row][column].reverse for row, column in cells):
            return True
    return False

def startup_dialog(kind, current_stage, view):
    if current_stage != 'startup' or 'Enter' not in view:
        return False
    if kind == 'trust':
        return any(question in view for question in [
            'Do you trust the files in this folder?',
            'Is this a project you created or one you trust?',
        ])
    return kind == 'api-key' and 'Do you want to use this API key?' in view

def control_geometry(label):
    text = '\n'.join(screen.display)
    positions = []
    for row, line in enumerate(screen.display):
        positions.extend((row, column) for column in range(len(line)))
        if row + 1 < len(screen.display):
            positions.append(None)
    pattern = r'[\s│┃]*'.join(re.escape(char) for char in label if not char.isspace())
    match = re.search(pattern, text)
    if not match:
        return None
    cells = [positions[index] for index in range(match.start(), match.end()) if not text[index].isspace() and text[index] not in '│┃']
    styles = [screen.buffer[row][column] for row, column in cells]
    return {'row': cells[0][0], 'column': cells[0][1], 'endRow': cells[-1][0], 'endColumn': cells[-1][1], 'characters': len(cells), 'reverse': sum(bool(cell.reverse) for cell in styles), 'bold': sum(bool(cell.bold) for cell in styles), 'colored': sum(cell.fg != 'default' for cell in styles)}

def off_frame(phase):
    if len(off_frames) >= 8:
        return
    view = ' '.join(displayed().split())
    controls = {key: control_geometry(label) for key, label in [('ruleId', 'Rule ID'), ('prefix', 'Public prefix,'), ('length', 'Run length,'), ('createDraft', 'Create draft'), ('validate', 'Validate')]}
    cursor_field = next((key for key in ['ruleId', 'prefix', 'length'] if controls[key] and controls[key]['row'] <= screen.cursor.y <= controls[key]['endRow'] and screen.cursor.x >= controls[key]['column']), 'unknown')
    child_exit = poll()
    off_frames.append({'stage': stage, 'phase': phase, 'alive': child_exit is None, 'exitCode': child_exit, 'elapsedMs': min(180000, int((time.monotonic() - probe_start) * 1000)), 'cursor': {'row': screen.cursor.y, 'column': screen.cursor.x}, 'cursorLabelRow': cursor_field, 'pane': {'focused': visible_words('Local panel has keyboard focus', view), 'unfocused': visible_words('WARNING: local panel is not focused', view), 'legacyFocused': 'Local panel has keyboard focus' in view}, 'notices': {'invalidCandidate': visible_words('INVALID_CANDIDATE', view), 'rejected': visible_words('TURN_ON_TO_VALIDATE', view), 'draftReady': visible_words('Draft ready', view)}, 'actions': {**off_action_counts, **off_input_counts}, 'controls': controls})

try:
    deadline = time.monotonic() + float(os.environ.get('REDACTON_UI_SECONDS', '45'))
    while time.monotonic() < deadline:
        data = read_terminal()
        if data is not None:
            if not data:
                break
            chunk = decoder.decode(data)
            raw = (raw + chunk)[-262144:]
            terminal.feed(chunk)
        elif poll() is not None:
            break
        view = ' '.join(displayed().split())
        if 'Warning: Redacton is OFF.' in view:
            observations['immediateWarningObserved'] = True
        if not trust_answered and startup_dialog('trust', stage, view):
            time.sleep(1)
            send('\x1b[B', True)
            trust_answered = True
            observations['trustAnswered'] = True
            raw = ''
        if not key_answered and startup_dialog('api-key', stage, view):
            time.sleep(1)
            send('\x1b[A', True)
            key_answered = True
            observations['apiKeyAnswered'] = True
            raw = ''
        if ux_mode:
            if stage != last_observed_stage:
                last_observed_stage = stage
                if stage in ['off-form', 'off-id', 'off-prefix', 'off-length', 'off-draft', 'off-validate']:
                    off_frame('entry')
            if stage == 'off-length' and time.monotonic() - stage_time > 1 and not off_length_settled:
                off_length_settled = True
                off_frame('settled')
            if stage == 'startup' and 'Protect ready' in view:
                send('/redact:')
                stage = 'autocomplete'; stage_time = time.monotonic()
            elif stage == 'autocomplete' and time.monotonic()-stage_time > 1:
                observations['autocompleteExactNames'] = all('redact:'+name in view for name in ['status','config','add-rule','remove-rule'])
                write_terminal(b'\x15'); send('/redact:config SYNTHETIC_LOCAL_ARGUMENT',True)
                stage = 'invalid'
            elif stage == 'invalid' and 'Never put credentials in slash commands' in view:
                observations['localArgsRejected']=True
                send('/redact:add-rule',True); stage='form'
            elif stage == 'form' and 'Rule ID' in view and 'Local panel has keyboard focus' in view:
                observations['formOpened']=True
                if '--initial-focus-probe' in sys.argv:
                    styles={}
                    for row,line in enumerate(screen.display):
                        for label in ['Rule ID','Public prefix','Run length','Create draft','Revert','Cancel']:
                            if label in line:
                                cells=screen.buffer[row]
                                styles[label]=list(set((c.fg,c.bg,c.reverse,c.bold) for c in cells.values()))
                    observations['focusStyles']=styles
                    break
                guided_start=time.monotonic()
                send('synthetic.rule',True);stage='id';stage_time=time.monotonic()
            elif stage=='id' and 'Public prefix,' in view and time.monotonic()-stage_time>.3:
                send('syntheticcred_',True);stage='prefix';stage_time=time.monotonic()
            elif stage=='prefix' and 'Run length,' in view and time.monotonic()-stage_time>.3:
                send('\x15');time.sleep(.15);send('16',True);stage='length';stage_time=time.monotonic()
            elif stage=='length' and focused('Create draft') and time.monotonic()-stage_time>.3:
                if '--focus-probe' in sys.argv:
                    styles={}
                    for row,line in enumerate(screen.display):
                        for label in ['Public prefix','Run length','Create draft','Validate','Revert']:
                            if label in line:
                                col=line.index(label);cells=screen.buffer[row]
                                styles[label]={'row':row,'styles':list(set((cells[x].fg,cells[x].bg,cells[x].reverse,cells[x].bold) for x in range(col,col+len(label))))}
                    observations['controlStyles']=styles
                    observations['terminalCursor']=[screen.cursor.x,screen.cursor.y]
                    break
                send('',True);stage='draft';stage_time=time.monotonic()
            elif stage == 'draft' and (('Draft ready' in (view+raw)) or ('· editing · base' in view and focused('Validate'))):
                observations['draftCreated']=True
                send('',True);stage='validate';stage_time=time.monotonic()
            elif stage == 'validate' and (('Core validation passed' in (view+raw)) or ('· validated · base' in view and focused('Synthetic preview'))):
                observations['validated']=True
                send('',True);stage='preview'
            elif stage == 'preview' and (visible_words('Synthetic sample outcomes',view) and focused('Apply session') and preview_pairs(view)):
                observations['previewed']=True
                import re
                observations['previewObservedActions']=preview_pairs(view)
                observations['previewOutcomesVisibleBeforeApply']=bool(observations['previewObservedActions'])
                send('',True);stage='apply'
            elif stage == 'apply' and visible_words('Applied to session',view) and (visible_words('Protect ready',view) or focused('Remove rule')):
                observations['applied']=True
                observations['guidedApplySeconds']=round(time.monotonic()-guided_start,3)
                write_terminal(b'\x1b');stage='escape';stage_time=time.monotonic()
            elif stage == 'escape' and time.monotonic()-stage_time > .7:
                observations['escapeClosed']='Local declarative patterns only' not in view
                send('/ui-custom-probe',True);stage='custom'
            elif stage=='custom' and 'UI_CUSTOM_WITHHELD_' in (view+raw):
                send('/helpercount',True);stage='custom-diagnostic'
            elif stage=='custom-diagnostic' and 'CONFIG_EXPECTED_' in (view+raw):
                observations['customConfigExpected']='CONFIG_EXPECTED_true' in (view+raw)
                break
            elif stage=='custom' and 'UI_CUSTOM_SANITIZED' in (view+raw):
                observations['uiAppliedCustomEffect']=True
                observations['guidedVerifiedSeconds']=round(time.monotonic()-guided_start,3)
                send('/redact:remove-rule',True);stage='remove';raw=''
            elif stage=='remove' and 'Select removal' in view and 'Local panel has keyboard focus' in view:
                send('',True);stage='remove-draft';raw=''
            elif stage=='remove-draft' and (('Removal draft' in (view+raw)) or ('· editing · base' in view and focused('Validate'))):
                send('',True);stage='remove-validate';raw=''
            elif stage=='remove-validate' and (('Core validation passed' in (view+raw)) or ('· validated · base' in view and focused('Synthetic preview'))):
                send('',True);stage='remove-preview';raw=''
            elif stage=='remove-preview' and (visible_words('Synthetic sample outcomes',view) and focused('Apply session') and visible_words('empty rules, built-ins retained',view)):
                send('',True);stage='remove-apply';raw=''
            elif stage=='remove-apply' and visible_words('Applied to session',view) and (visible_words('Protect ready',view) or focused('Revert')):
                observations['removed']=True
                stage='ready-revert';stage_time=time.monotonic();raw=''
            elif stage=='ready-revert' and 'Revert' in view and time.monotonic()-stage_time>.5:
                observations['revertVisibleBeforePress']=True
                send('',True);stage='revert';stage_time=time.monotonic();raw=''
            elif stage=='revert' and time.monotonic()-stage_time>1:
                observations['revertReceiptObserved']=visible_words('Reverted to previous configuration.',view)
                write_terminal(b'\x1b');stage='final-escape';stage_time=time.monotonic()
            elif stage=='final-escape' and time.monotonic()-stage_time>.7:
                send('/redact:status',True);stage='verify-revert';raw=''
            elif stage=='verify-revert' and visible_words('1 custom rules: synthetic.rule',view):
                observations['reverted']=True
                send('/helpercount',True);stage='before-off-count';raw=''
            elif stage=='before-off-count' and 'HELPER_CALLS_' in (view+raw):
                import re
                before_off_count=int(re.findall(r'HELPER_CALLS_(\d+)',view+raw)[-1])
                send('/redactoff',True);stage='ux-off';raw=''
            elif stage=='ux-off' and 'credential protection disabled' in view:
                observations['warningBeforeTyping']=True
                send('/redact:add-rule',True);stage='off-form';raw=''
            elif stage=='off-form' and 'Local panel has keyboard focus' in view and 'Rule ID' in view:
                observations['offPanelWarning']='Redacton OFF' in view
                send('off-rule',True);stage='off-id';stage_time=time.monotonic()
            elif stage=='off-id' and 'Public prefix,' in view and time.monotonic()-stage_time>.3:
                send('syntheticoff_',True);stage='off-prefix';stage_time=time.monotonic()
            elif stage=='off-prefix' and 'Run length,' in view and time.monotonic()-stage_time>.3:
                observations['warningAfterTyping']='Redacton OFF' in view
                send('\x15');time.sleep(.15);send('16',True);stage='off-length';stage_time=time.monotonic()
            elif stage=='off-length' and focused('Create draft') and time.monotonic()-stage_time>.3:
                send('',True);stage='off-draft';raw=''
            elif stage=='off-length' and 'Local panel has keyboard focus' in view and time.monotonic()-stage_time>.5 and off_action_counts['focusTabs'] < 12:
                send('\t');off_action_counts['focusTabs'] += 1;stage_time=time.monotonic()
            elif stage=='off-draft' and focused('Validate') and (visible_words('Draft ready',view) or '· editing · base' in view):
                send('',True);stage='off-validate';raw=''
            elif stage=='off-validate' and visible_words('TURN_ON_TO_VALIDATE',view):
                observations['offValidationRejected']=True
                write_terminal(b'\x1b');stage='off-close';stage_time=time.monotonic()
            elif stage=='off-close' and time.monotonic()-stage_time>.7:
                send('/ui-custom-probe',True);stage='off-tool';raw=''
            elif stage=='off-tool' and 'UI_CUSTOM_RAW_OFF' in (view+raw):
                observations['offToolOriginalPreserved']=True
                observations['warningAfterActualBash']='credential protection disabled' in view
                send('/helpercount',True);stage='after-off-count';raw=''
            elif stage=='after-off-count' and 'HELPER_CALLS_' in (view+raw):
                import re
                after_off_count=int(re.findall(r'HELPER_CALLS_(\d+)',view+raw)[-1])
                observations['offHelperCountUnchanged']=before_off_count==after_off_count
                observations['helperCallsBeforeOff']=before_off_count
                observations['helperCallsAfterOff']=after_off_count
                stage='complete';break
            continue
        if stage == 'startup' and 'Redacton ON' in view:
            send('/redactoff', True)
            stage = 'off'
            stage_time = time.monotonic()
        elif stage == 'off' and 'credential protection disabled' in view:
            observations['offCommandExecuted'] = True
            observations['warningBeforeTyping'] = True
            send('typed-synthetic')
            stage = 'typing'
            stage_time = time.monotonic()
        elif stage == 'typing' and time.monotonic() - stage_time > .7 and 'typed-synthetic' in view:
            observations['warningAfterTyping'] = 'credential protection disabled' in view
            # Clear the draft and exercise local commands without any model call.
            write_terminal(b'\x15')
            time.sleep(.2)
            send('/redacton', True)
            stage = 'on'
            stage_time = time.monotonic()
        elif stage == 'on' and time.monotonic() - stage_time > 1 and 'Protect ready' in view:
            observations['onCommandExecuted'] = True
            observations['offWarningClearedOn'] = 'credential protection disabled' not in view
            send('/redactoff', True)
            stage = 'off-again'
        elif stage == 'off-again' and 'credential protection disabled' in view:
            observations['repeatedOffWarningRestored'] = True
            send('/ui-tool-probe', True)
            stage = 'tool'
        elif stage == 'tool' and 'UI_TOOL_COMPLETED' in view:
            observations['actualBashCompletedWhileOff'] = True
            observations['warningAfterActualBash'] = 'credential protection disabled' in view
            stage = 'complete'
            break
    import re
    observations['applyDiagnostics']={'receipt':visible_words('Applied to session',view),'ready':visible_words('Protect ready',view),'focusedApply':focused('Apply session'),'focusedRemove':focused('Remove rule'),'focusedRevert':focused('Revert')}
    observations['invalidCandidateObserved']='INVALID_CANDIDATE' in (view+raw)
    observations['statusCustomCounts']=re.findall(r'(\d+) custom rules:',view+raw)
    observations['completed'] = stage == 'complete'
    observations['finalStage'] = stage
    off_frame('final')
    observations['offFrames'] = off_frames
    observations['focusedButton'] = next((label for label in ['Create draft', 'Validate', 'Synthetic preview', 'Apply session', 'Revert', 'Remove rule'] if focused(label)), None)
    observations['offReceiptState'] = {'rejected': visible_words('TURN_ON_TO_VALIDATE', view), 'draftReady': visible_words('Draft ready', view), 'editingDraft': '· editing · base' in view}
    observations['offActionCounts'] = off_action_counts
    observations['childExitCode'] = poll()
    if windows_pty and stage == 'startup':
        windows_pty.startup_diagnostic(raw)
    observations['startupCategories'] = [word for word in ['trust', 'API key', 'Welcome', 'login', 'error', 'Enter'] if word.lower() in displayed().lower()]
    observations['modelRequests']=model_requests
    observations['customWithheldCodes']=[code for code in ['REDACTON_UNAVAILABLE','REDACTON_UNSUPPORTED_SHAPE','REDACTON_WITHHELD','REDACTON_TOOL_DENIED','REDACTON_INPUT_LIMIT','OTHER'] if 'UI_CUSTOM_WITHHELD_'+code in raw]
    marker_files=0
    for current,_dirs,files in os.walk(config):
        for name in files:
            path=os.path.join(current,name)
            if os.path.getsize(path)<=4194304:
                with open(path,'rb') as stream:
                    marker_files += b'syntheticcred_' in stream.read()
    observations['formPatternPersistedFiles']=marker_files
    counter=os.path.join(folder,'ui-execution-counter')
    observations['customToolExecutions']=os.path.getsize(counter) if os.path.isfile(counter) else 0
    if '--report' in sys.argv:
        report_path=os.path.abspath(sys.argv[sys.argv.index('--report')+1])
        os.makedirs(os.path.dirname(report_path),exist_ok=True)
        hashes={}
        for name in ['.claude-plugin/plugin.json','mod/index.tsx','mod/protocol.ts','mod/config.ts','mod/form.ts','mod/settings.ts','mod/storage.ts','helper/dist/index.js','helper/dist/core.js','helper/dist/storage.js','helper/dist/rules.js']:
            with open(os.path.join(root,name),'rb') as source:
                hashes[name]=hashlib.sha256(source.read()).hexdigest()
        with open(report_path,'w') as report:
            json.dump({'hostVersion':host_version,'runtimeSourceSha256':hashes,'result':observations},report,indent=2)
    print(json.dumps(observations))
    if not observations['completed'] or model_requests or (ux_mode and observations['customToolExecutions']!=2) or (ux_mode and not all(observations[key] for key in ['previewOutcomesVisibleBeforeApply','autocompleteExactNames','localArgsRejected','formOpened','draftCreated','validated','previewed','applied','escapeClosed','uiAppliedCustomEffect','removed','reverted','offPanelWarning','offValidationRejected','offHelperCountUnchanged','offToolOriginalPreserved','warningBeforeTyping','warningAfterTyping','warningAfterActualBash'])):
        sys.exit(1)
finally:
    try:
        if windows_pty:
            windows_pty.close()
        else:
            if poll() is None:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            os.close(master)
    finally:
        shutil.rmtree(folder)
        server.shutdown();server.server_close()
