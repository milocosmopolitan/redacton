"""Actual isolated terminal warning check; optional task-local pyte dependency."""
import fcntl
import hashlib
import json
import os
import pty
import select
import shutil
import signal
import struct
import tempfile
import termios
import time
import sys
import subprocess
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
if os.environ.get("REDACTON_PYTE_PATH"):
    sys.path.insert(0, os.environ["REDACTON_PYTE_PATH"])
import pyte

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
folder = tempfile.mkdtemp(prefix='redacton-normal-ui-')
config = os.path.join(folder, 'config')
os.mkdir(config)
with open(os.path.join(config, '.claude.json'), 'w') as stream:
    json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'projects': {folder: {'hasTrustDialogAccepted': True}}}, stream)
env = {key: os.environ[key] for key in ['PATH', 'HOME'] if key in os.environ}
env.update({'HOME': folder, 'DISABLE_AUTOUPDATER': '1', 'TERM': 'xterm-256color', 'CLAUDE_CONFIG_DIR': config, 'ANTHROPIC_API_KEY': 'synthetic-local-only', 'REDACTON_SETTINGS_ROOT': os.path.join(folder,'settings'), 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{server.server_port}', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
pid, master = pty.fork()
if pid == 0:
    os.chdir(folder)
    os.execvpe(host_binary, [host_binary, '--plugin-dir', root, '--plugin-dir', os.path.join(fixture_root, 'qualification/ui-companion'), '--plugin-dir', os.path.join(fixture_root,'qualification/helper-counter'), '--allowedTools','Bash', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], env)
os.set_blocking(master, False)
columns=int(os.environ.get('REDACTON_UI_COLUMNS','140'))
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 40, columns, 0, 0))
screen = pyte.Screen(columns, 40)
terminal = pyte.Stream(screen)
raw = ''
exit_code = None
stage = 'startup'
off_action_counts = {'createDraft': 0, 'validate': 0, 'focusTabs': 0}
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
    if exit_code is None:
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            exit_code = os.waitstatus_to_exitcode(status)
    return exit_code

def send(value, enter=False):
    if enter and stage == 'off-length':
        off_action_counts['createDraft'] += 1
    if enter and stage == 'off-draft':
        off_action_counts['validate'] += 1
    os.write(master, value.encode())
    if enter:
        time.sleep(.2)
        os.write(master, b'\r')

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

try:
    deadline = time.monotonic() + float(os.environ.get('REDACTON_UI_SECONDS', '45'))
    while time.monotonic() < deadline:
        if select.select([master], [], [], .1)[0]:
            try:
                chunk = os.read(master, 65536).decode('utf8', errors='replace')
            except OSError:
                break
            raw = (raw + chunk)[-262144:]
            terminal.feed(chunk)
            if '\x1b[6n' in chunk:
                os.write(master, f'\x1b[{screen.cursor.y + 1};{screen.cursor.x + 1}R'.encode())
            if '\x1b[c' in chunk:
                os.write(master, b'\x1b[?1;2c')
            if '\x1b[>c' in chunk:
                os.write(master, b'\x1b[>0;95;0c')
        elif poll() is not None:
            break
        view = ' '.join(displayed().split())
        if 'Warning: Redacton is OFF.' in view:
            observations['immediateWarningObserved'] = True
        if not trust_answered and 'trust' in view.lower() and 'Enter' in view:
            time.sleep(1)
            send('\x1b[B', True)
            trust_answered = True
            observations['trustAnswered'] = True
            raw = ''
        if not key_answered and 'Do you want to use this API key?' in view and 'Enter' in view:
            time.sleep(1)
            send('\x1b[A', True)
            key_answered = True
            observations['apiKeyAnswered'] = True
            raw = ''
        if ux_mode:
            if stage == 'startup' and 'Protect ready' in view:
                send('/redact:')
                stage = 'autocomplete'; stage_time = time.monotonic()
            elif stage == 'autocomplete' and time.monotonic()-stage_time > 1:
                observations['autocompleteExactNames'] = all('redact:'+name in view for name in ['status','config','add-rule','remove-rule'])
                os.write(master,b'\x15'); send('/redact:config SYNTHETIC_LOCAL_ARGUMENT',True)
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
                os.write(master,b'\x1b');stage='escape';stage_time=time.monotonic()
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
                os.write(master,b'\x1b');stage='final-escape';stage_time=time.monotonic()
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
                os.write(master,b'\x1b');stage='off-close';stage_time=time.monotonic()
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
            os.write(master, b'\x15')
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
    observations['focusedButton'] = next((label for label in ['Create draft', 'Validate', 'Synthetic preview', 'Apply session', 'Revert', 'Remove rule'] if focused(label)), None)
    observations['offReceiptState'] = {'rejected': visible_words('TURN_ON_TO_VALIDATE', view), 'draftReady': visible_words('Draft ready', view), 'editingDraft': '· editing · base' in view}
    observations['offActionCounts'] = off_action_counts
    observations['childExitCode'] = poll()
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
    if poll() is None:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    os.close(master)
    shutil.rmtree(folder)
    server.shutdown();server.server_close()
