"""Actual isolated terminal warning check; optional task-local pyte dependency."""
import fcntl
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
import pyte

root = os.path.abspath('.')
folder = tempfile.mkdtemp(prefix='redacton-normal-ui-')
config = os.path.join(folder, 'config')
os.mkdir(config)
with open(os.path.join(config, '.claude.json'), 'w') as stream:
    json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'projects': {folder: {'hasTrustDialogAccepted': True}}}, stream)
env = {key: os.environ[key] for key in ['PATH', 'HOME'] if key in os.environ}
env.update({'TERM': 'xterm-256color', 'CLAUDE_CONFIG_DIR': config, 'ANTHROPIC_API_KEY': 'synthetic-local-only', 'ANTHROPIC_BASE_URL': 'http://127.0.0.1:1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
pid, master = pty.fork()
if pid == 0:
    os.chdir(folder)
    os.execvpe('claude', ['claude', '--plugin-dir', root, '--plugin-dir', os.path.join(root, 'qualification/ui-companion'), '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], env)
os.set_blocking(master, False)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
screen = pyte.Screen(140, 40)
terminal = pyte.Stream(screen)
raw = ''
exit_code = None
stage = 'startup'
stage_time = time.monotonic()
trust_answered = False
key_answered = False
observations = {'renderer': 'normal-terminal', 'terminalRows': 40, 'terminalColumns': 140,
                'emulator': 'pyte 0.8.2', 'trustAnswered': False, 'apiKeyAnswered': False,
                'offCommandExecuted': False, 'immediateWarningObserved': False,
                'warningBeforeTyping': False, 'warningAfterTyping': False,
                'onCommandExecuted': False, 'offWarningClearedOn': False,
                'repeatedOffWarningRestored': False, 'actualBashCompletedWhileOff': False,
                'warningAfterActualBash': False}

def poll():
    global exit_code
    if exit_code is None:
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            exit_code = os.waitstatus_to_exitcode(status)
    return exit_code

def send(value, enter=False):
    os.write(master, value.encode())
    if enter:
        time.sleep(.2)
        os.write(master, b'\r')

def displayed():
    return '\n'.join(screen.display)

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
        view = displayed()
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
    observations['completed'] = stage == 'complete'
    observations['finalStage'] = stage
    observations['childExitCode'] = poll()
    observations['startupCategories'] = [word for word in ['trust', 'API key', 'Welcome', 'login', 'error', 'Enter'] if word.lower() in displayed().lower()]
    print(json.dumps(observations))
finally:
    if poll() is None:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    os.close(master)
    shutil.rmtree(folder)
