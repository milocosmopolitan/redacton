"""Synthetic local PTY warning probe; reports fixed observations only."""
import json
import re
import os
import pty
import select
import shutil
import signal
import struct
import tempfile
import time
import fcntl
import termios

root = os.path.abspath('.')
folder = tempfile.mkdtemp(prefix='redacton-ui-')
config = os.path.join(folder, 'config')
os.mkdir(config)
with open(os.path.join(config, '.claude.json'), 'w') as stream:
    json.dump({'hasCompletedOnboarding': True, 'theme': 'dark', 'projects': {folder: {'hasTrustDialogAccepted': True}}}, stream)
env = {key: os.environ[key] for key in ['PATH', 'HOME'] if key in os.environ}
env.update({'TERM': 'xterm-256color', 'CLAUDE_CONFIG_DIR': config, 'ANTHROPIC_API_KEY': 'synthetic-local-only', 'ANTHROPIC_BASE_URL': 'http://127.0.0.1:1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
# rtk proxy captures a child's output, which makes Claude switch to print mode.
# This argv-only child preserves the PTY; the shell entrypoint still uses rtk.
pid, master = pty.fork()
if pid == 0:
    os.chdir(folder)
    os.execvpe('claude', ['claude', '--plugin-dir', root, '--ax-screen-reader', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], env)
os.set_blocking(master, False)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
exit_code = None
def poll():
    global exit_code
    if exit_code is None:
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            exit_code = os.waitstatus_to_exitcode(status)
    return exit_code
seen = ''
deadline = time.monotonic() + 20
off_sent = False
typed = False
after_typing = ''
trust_answered = False
key_answered = False
def send(value):
    try:
        if value.endswith(b'\r') and len(value) > 1:
            os.write(master, value[:-1])
            time.sleep(.15)
            os.write(master, b'\r')
        else:
            os.write(master, value)
    except (BlockingIOError, OSError):
        pass

try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], .1)[0]:
            try:
                text = os.read(master, 65536).decode('utf8', errors='replace')
            except OSError:
                break
            seen += text
            if '\x1b[6n' in text:
                send(b'\x1b[1;1R')
            if '\x1b[c' in text:
                send(b'\x1b[?1;2c')
            if '\x1b[>c' in text:
                send(b'\x1b[>0;95;0c')
            seen = seen[-262144:]
            if typed:
                after_typing += text
        elif poll() is not None:
            break
        if not trust_answered and 'trust' in seen.lower() and 'Enter' in seen:
            send(b'y\r')
            trust_answered = True
            seen = ''
        if not key_answered and 'Do you want to use this API key?' in seen and 'Enter y/n:' in seen:
            send(b'y\r')
            key_answered = True
            seen = ''
        if 'Please answer y or n.' in seen:
            send(b'y\r')
            seen = ''
        if not off_sent and ('Redacton ON' in seen or 'Protect ready' in seen):
            send(b'/redactoff\r')
            off_sent = True
        if off_sent and not typed and 'credential protection disabled' in seen:
            send(b'typed-synthetic')
            typed = True
        if typed and 'credential protection disabled' in after_typing:
            break
    print(json.dumps({'renderer': 'screen-reader', 'offCommandSent': off_sent, 'immediateWarningObserved': 'Warning: Redacton is OFF.' in seen, 'persistentWarningObserved': 'credential protection disabled' in seen, 'typedWhileOff': typed, 'warningRedrawnDuringTyping': 'credential protection disabled' in after_typing, 'onboardingBlocked': not off_sent, 'childExitCode': poll(), 'startupCategories': [word for word in ['theme', 'API key', 'trust', 'Welcome', 'login', 'Enter', 'terminal', 'error', 'argument', 'missing', 'unknown', 'required'] if word.lower() in seen.lower()], 'optionsMentioned': list(set(re.findall(r'--[a-z-]+', seen)))}))
finally:
    if poll() is None:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    os.close(master)
    shutil.rmtree(folder)
