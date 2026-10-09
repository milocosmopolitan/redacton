import { TextDecoder } from 'node:util';
import { failure, encodeResponse, processRequest, LIMITS } from './core.mjs';

let sent = false;
function finish(response) {
  if (sent) return;
  sent = true;
  process.stdout.write(encodeResponse(response) + '\n', () => process.exit(0));
}
// The parent process must also enforce this deadline because synchronous engine calls block timers.
const timer = setTimeout(() => finish(failure(null, 'TIMEOUT')), LIMITS.timeoutMs);
try {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > LIMITS.outputBytes) { finish(failure(null, 'INPUT_LIMIT')); break; }
    chunks.push(chunk);
  }
  if (!sent) {
    let request;
    try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { finish(failure(null, 'INVALID_JSON')); }
    if (!sent) {
      let engine;
      try { engine = await import('@redact-secret/core'); }
      catch { finish(failure(null, 'ENGINE_UNAVAILABLE')); }
      if (!sent) finish(await processRequest(request, engine));
    }
  }
} catch { finish(failure(null, 'INPUT_FAILURE')); }
finally { clearTimeout(timer); }
