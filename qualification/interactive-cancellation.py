"""Actual terminal Ctrl-C cancellation with owned synthetic helper phase barriers."""
import codecs
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cancellation_terminal', HERE / 'interactive-races.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
import pyte

SYNTHETIC = 'ghp_SYNTHETICREVOKED00000000000000000000'


def alive(pid):
    if os.name == 'nt':
        import ctypes
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        api.OpenProcess.restype = ctypes.c_void_p
        api.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        api.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = api.OpenProcess(0x1000, False, pid)
        if not handle:
            if ctypes.get_last_error() == 87:
                return False
            raise RuntimeError('CANCELLATION_PID_CHECK_FAILED')
        try:
            code = ctypes.c_ulong()
            if not api.GetExitCodeProcess(handle, ctypes.byref(code)):
                raise RuntimeError('CANCELLATION_PID_CHECK_FAILED')
            return code.value == 259
        finally:
            api.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def is_main_request(request, main_seen=False):
    texts = [block.get('text','') for message in request.get('messages',[]) if message.get('role')=='user' for block in (message.get('content',[]) if isinstance(message.get('content'),list) else [{'text':message.get('content','')}]) if isinstance(block,dict)]
    return  request.get('model')=='claude-sonnet-4-6' and any(tool.get('name')=='Bash' for tool in request.get('tools',[]) if isinstance(tool,dict)) and (main_seen or any('Run the supplied synthetic tool once.' in text for text in texts if isinstance(text,str)))


def probe(binary, root, mode):
    folder = pathlib.Path(tempfile.mkdtemp(prefix='redacton-interactive-cancel-',dir=os.environ.get('REDACTON_PROBE_TMP_ROOT')))
    terminal = None
    server = None
    captures = []
    all_requests = []
    auxiliary_requests = 0
    endpoint_failed = False
    marker_absent = True
    stream_started = threading.Event()
    stream_started_at = None
    release = threading.Event()
    phase = 'startup'
    stage_reached = False
    helper_pid = None
    helper_at_signal = None
    helper_after = None
    stopped_ms = None
    requests_before = 0
    signal_time = None
    receipt = False
    responsive = False
    interrupted = False
    trust_answered = False
    key_answered = False
    try:
        plugin = folder / 'plugin'
        plugin.mkdir()
        for name in ['.claude-plugin/plugin.json','hooks','commands','mod','helper/dist','helper/src/config.ts','package.json']:
            source=pathlib.Path(root)/name;destination=plugin/name;destination.parent.mkdir(parents=True,exist_ok=True)
            if source.is_dir():shutil.copytree(source,destination)
            else:shutil.copyfile(source,destination)
        # This fixture exercises the packaged Mod/controller cancellation boundary, not scanner correctness.
        (plugin / 'helper/dist/index.js').write_text("""import {writeFileSync} from 'node:fs';
let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text);
if(request.operation==='load-config'){process.stdout.write(JSON.stringify({protocolVersion:2,requestId:request.requestId,status:'ok',engineVersion:'0.1.0-beta.14',policyId:'credentials-alpha1',artifact:'addon',settings:{scope:request.storage.scope,identity:'0'.repeat(64),revision:'absent',document:{schemaVersion:1,rules:[]}}}));process.exit(0);}
const response={protocolVersion:request.protocolVersion,requestId:request.requestId,status:'ok',engineVersion:'0.1.0-beta.14',policyId:'credentials-alpha1',artifact:'addon',findingCounts:{},...(request.config?{configRevision:request.config.revision}:{})};
if(request.operation==='sanitize')response.segments=request.segments.map(segment=>({id:segment.id,text:segment.text}));
if(request.segments?.some(segment=>segment.id==='stdout')){writeFileSync(new URL('./cancel-pid',import.meta.url),String(process.pid));await new Promise(r=>setTimeout(r,30000));}
process.stdout.write(JSON.stringify(response));
""", encoding='utf8')
        control = folder / 'output.mjs'
        control.write_text('process.stdout.write(' + json.dumps(SYNTHETIC + '\n') + ');', encoding='utf8')
        node = shutil.which('node')
        if not node:
            raise RuntimeError('CANCELLATION_NODE_UNAVAILABLE')
        quote = lambda value: "'" + str(value).replace('\\','/').replace("'", "'\\''") + "'"
        command = quote(os.path.abspath(node)) + ' ' + quote(control)

        class Endpoint(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                nonlocal auxiliary_requests, endpoint_failed, marker_absent, stream_started_at
                self.connection.settimeout(5)
                length = int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 2097152:
                    endpoint_failed=True;self.send_error(413)
                    return
                try:request=json.loads(self.rfile.read(length))
                except Exception:endpoint_failed=True;return
                if not isinstance(request,dict):endpoint_failed=True;return
                marker_absent = marker_absent and SYNTHETIC not in json.dumps(request)
                if 'count_tokens' in self.path:
                    self.send_response(200);self.end_headers();self.wfile.write(b'{"input_tokens":1}')
                    return
                if len(all_requests)>=16:endpoint_failed=True;self.send_error(503);return
                all_requests.append(request)
                main = is_main_request(request,bool(captures))
                if main:captures.append(request)
                else:auxiliary_requests += 1
                if main and mode == 'before-tool-helper' and len(captures) == 1:
                    self.send_response(200);self.send_header('content-type','text/event-stream');self.end_headers()
                    message={'id':'msg_cancel_pending','type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':1,'output_tokens':1}}
                    events=[('message_start',{'message':message}),('content_block_start',{'index':0,'content_block':{'type':'text','text':''}}),('content_block_delta',{'index':0,'delta':{'type':'text_delta','text':'Synthetic pending response.'}}),('content_block_stop',{'index':0})]
                    for kind,data in events:self.wfile.write(f'event: {kind}\ndata: {json.dumps({"type":kind,**data})}\n\n'.encode());self.wfile.flush()
                    # A complete text block establishes an active stream before any tool block.
                    stream_started_at = time.monotonic()
                    stream_started.set()
                    release.wait(60)
                    return
                first = main and len(captures) == 1
                block = {'type':'tool_use','id':'cancel_tool_1','name':'Bash','input':{'command':command}} if first else {'type':'text','text':'CANCEL_UNEXPECTED_DELIVERY' if main else 'Synthetic cancellation'}
                stop = 'tool_use' if first else 'end_turn'
                message = {'id':'msg_cancel','type':'message','role':'assistant','model':request.get('model','claude-sonnet-4-6'),'content':[block],
                           'stop_reason':stop,'stop_sequence':None,'usage':{'input_tokens':1,'output_tokens':1}}
                self.send_response(200)
                self.send_header('content-type','text/event-stream' if request.get('stream') else 'application/json')
                self.end_headers()
                if not request.get('stream'):
                    self.wfile.write(json.dumps(message).encode());return
                def send(kind, data):
                    self.wfile.write(f'event: {kind}\ndata: {json.dumps({"type":kind,**data})}\n\n'.encode());self.wfile.flush()
                send('message_start',{'message':{**message,'content':[],'stop_reason':None}})
                send('content_block_start',{'index':0,'content_block':{**block,'input':{}} if first else {'type':'text','text':''}})
                send('content_block_delta',{'index':0,'delta':{'type':'input_json_delta','partial_json':json.dumps(block['input'])} if first else {'type':'text_delta','text':block['text']}})
                send('content_block_stop',{'index':0})
                send('message_delta',{'delta':{'stop_reason':stop,'stop_sequence':None},'usage':{'output_tokens':1}})
                send('message_stop',{})

        server = ThreadingHTTPServer(('127.0.0.1',0), Endpoint)
        server.daemon_threads = False
        server.handle_error = lambda *_: None
        threading.Thread(target=server.serve_forever,daemon=True).start()
        config = folder / 'config';config.mkdir()
        (config / '.claude.json').write_text(json.dumps({'hasCompletedOnboarding':True,'theme':'dark','projects':{str(folder):{'hasTrustDialogAccepted':True}}}))
        env = {name:os.environ[name] for name in ['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT'] if name in os.environ}
        env.update({'HOME':str(folder),'USERPROFILE':str(folder),'APPDATA':str(folder/'appdata'),'LOCALAPPDATA':str(folder/'localappdata'),
                    'TEMP':str(folder),'TMP':str(folder),'TERM':'xterm-256color','DISABLE_AUTOUPDATER':'1','CLAUDE_CONFIG_DIR':str(config),
                    'REDACTON_SETTINGS_ROOT':str(folder/'settings'),'ANTHROPIC_API_KEY':'synthetic-local-only',
                    'ANTHROPIC_BASE_URL':f'http://127.0.0.1:{server.server_port}','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1'})
        terminal = driver.Terminal(binary,['--plugin-dir',str(plugin),'--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
                                   '--permission-mode','dontAsk','--allowedTools','Bash','--model','claude-sonnet-4-6'],str(folder),env)
        observer_spec = importlib.util.spec_from_file_location('cancellation_observer', HERE / 'terminal-observer.py')
        observer_module = importlib.util.module_from_spec(observer_spec)
        observer_spec.loader.exec_module(observer_module)
        screen, stream = observer_module.make_observer(140, 40, terminal.write)
        decoder = codecs.getincrementaldecoder('utf8')(errors='replace')
        history = ''
        deadline = time.monotonic()+45
        while time.monotonic() < deadline:
            chunk = terminal.read()
            if chunk == b'' or (chunk is None and terminal.poll() is not None):
                break
            if chunk:
                text = decoder.decode(chunk);stream.feed(text);history=(history+text)[-65536:]
            view = ' '.join('\n'.join(screen.display).split())
            if phase == 'startup' and not trust_answered and any(question in view for question in ['Do you trust the files in this folder?', 'Is this a project you created or one you trust?']):
                time.sleep(1);terminal.write(b'\x1b[B');time.sleep(.2);terminal.write(b'\r');trust_answered=True
            elif phase == 'startup' and not key_answered and 'Do you want to use this API key?' in view:
                time.sleep(1);terminal.write(b'\x1b[A');time.sleep(.2);terminal.write(b'\r');key_answered=True
            elif phase == 'startup' and 'Protect ready' in view:
                terminal.write(b'Run the supplied synthetic tool once.');time.sleep(.2);terminal.write(b'\r');phase='waiting'
            elif phase == 'waiting':
                marker = plugin / 'helper/dist/cancel-pid'
                if mode == 'during-tool-helper' and marker.exists():
                    value = marker.read_text()
                    if not re.fullmatch(r'[1-9][0-9]{0,9}',value):raise RuntimeError('CANCELLATION_PID_INVALID')
                    helper_pid=int(value);helper_at_signal=alive(helper_pid)
                    if not helper_at_signal:raise RuntimeError('CANCELLATION_PHASE_LOST')
                if (mode == 'before-tool-helper' and len(captures)==1 and stream_started.is_set() and time.monotonic()-stream_started_at >= .5) or helper_pid is not None:
                    stage_reached=True;requests_before=len(captures);signal_time=time.monotonic()
                    terminal.write(b'\x03');interrupted=True;phase='interrupted';history=''
            elif phase == 'interrupted':
                elapsed=int((time.monotonic()-signal_time)*1000)
                if helper_pid and stopped_ms is None and not alive(helper_pid):
                    stopped_ms=elapsed;helper_after=False
                if helper_pid and elapsed>1000 and stopped_ms is None:
                    helper_after=True;break
                receipt=receipt or 'interrupted' in view.lower()
                if receipt and elapsed>1200:
                    terminal.write(b'/redact:status');time.sleep(.2);terminal.write(b'\r');phase='status';history=''
            elif phase == 'status' and 'Supported:' in view and 'Configuration' in view:
                responsive=True;phase='complete';break
        # Cancellation/death proof is collected before cleanup; then freeze every request observation.
        if phase == 'startup' and terminal.windows:
            terminal.windows.startup_diagnostic(history)
        child_exit = terminal.poll()
        terminal.close();terminal=None
        release.set();server.shutdown();server.server_close();server=None
        results=[block for request in all_requests for message in request.get('messages',[]) for block in (message.get('content',[]) if isinstance(message.get('content'),list) else []) if block.get('type')=='tool_result']
        passed=marker_absent and not endpoint_failed and phase=='complete' and stage_reached and interrupted and receipt and responsive and len(captures)==requests_before==1 and not results and (helper_pid is None or (helper_at_signal and helper_after is False and stopped_ms<=1000))
        return {'mode':mode,'status':'passed' if passed else 'failed','stage':phase,'stageReached':stage_reached,'interruptSent':interrupted,
                'cancelReceipt':receipt,'cliResponded':responsive,'requestsBeforeSignal':requests_before,'requestsAfterSignal':len(captures)-requests_before,
                'toolResultCount':len(results),'protectedMarkerAbsentEveryRequest':marker_absent,'endpointFailed':endpoint_failed,'auxiliaryRequests':auxiliary_requests,'helperAliveAtSignal':helper_at_signal,'helperAliveAfterDeadline':helper_after,
                'helperStoppedMs':stopped_ms,'deadlineMs':1000,'terminalBytes':len(history),'childExitCode':child_exit,'startupDiagnostics':[word for word in ['Protect unavailable','Protect loading','Protect ready','unknown option','only supported','permission-mode','API key','trust','Welcome','Error','SyntaxError','ReferenceError','node','Bun'] if word in view] if phase=='startup' else []}
    finally:
        release.set()
        try:
            if terminal:terminal.close()
        finally:
            if server:server.shutdown();server.server_close()
            shutil.rmtree(folder)


def main():
    root=os.path.abspath(sys.argv[sys.argv.index('--plugin-root')+1])
    binary=os.path.abspath(os.environ.get('CLAUDE_BINARY',shutil.which('claude') or 'claude'))
    version=subprocess.run([binary,'--version'],capture_output=True,text=True,timeout=10)
    if version.returncode or not version.stdout.startswith('2.1.294 '):raise RuntimeError('HOST_VERSION_UNAVAILABLE')
    rows=[]
    for mode in ['before-tool-helper','during-tool-helper']:
        try:row=probe(binary,root,mode)
        except Exception:row={'mode':mode,'status':'failed','code':'CANCELLATION_PROBE_FAILED'}
        rows.append(row)
    pathlib.Path(sys.argv[sys.argv.index('--report')+1]).write_text(json.dumps({'hostVersion':'2.1.294','rows':rows}))
    return 0 if all(row['status']=='passed' for row in rows) else 1


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print(json.dumps({'code':'CANCELLATION_PROBE_FAILED'}));sys.exit(1)
