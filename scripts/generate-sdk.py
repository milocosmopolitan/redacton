"""Load an isolated interactive Mod to obtain installed declarations, without a turn."""
import json
import fcntl
import os
import pty
import select
import signal
import sys
import struct
import termios
import time

binary, plugin, config = sys.argv[1:]
with open(os.path.join(config, '.claude.json'), 'w', encoding='utf8') as stream:
    json.dump({'hasCompletedOnboarding': True, 'theme': 'dark',
               'projects': {os.path.realpath(plugin): {'hasTrustDialogAccepted': True}}}, stream)
arguments = [binary, '--plugin-dir', plugin, '--setting-sources', '',
             '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
             '--permission-mode', 'dontAsk']
pid, master = pty.fork()
if pid == 0:
    os.chdir(plugin)
    os.execvpe(binary, arguments, os.environ)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
generated = False
buffer = b''
answered = set()
try:
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if os.path.isfile(os.path.join(plugin, '.claude-plugin/types/claude-code-tools/index.d.ts')):
            generated = True
            break
        readable, _, _ = select.select([master], [], [], .1)
        if readable:
            try:
                output = os.read(master, 65536)
            except OSError:
                break
            buffer = (buffer + output)[-65536:]
            # Only accept startup prompts in this disposable synthetic workspace.
            for phrase in [b'Do you want to use this API key?', b'Do you trust the files', b'Is this a project you created']:
                if phrase in buffer and phrase not in answered:
                    os.write(master, b'\r')
                    answered.add(phrase)
finally:
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.close(master)
    os.waitpid(pid, 0)
if not generated:
    print(json.dumps({'code': 'SDK_INTERACTIVE_STARTUP', 'categories':
          [word for word in ['trust', 'API key', 'Welcome', 'login', 'error', 'Enter', 'theme']
           if word.lower().encode() in buffer.lower()]}))
sys.exit(0 if generated else 1)
