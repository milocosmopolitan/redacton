import { TextDecoder } from 'node:util';
import type { Engine } from './core.js';
import {
  encodeResponse,
  failure,
  LIMITS,
  processRequest,
  requestDeadlineMs,
} from './core.js';

let sent = false;
function finish(response: { requestId: string | null }) {
  if (sent) return;
  sent = true;
  process.stdout.write(`${encodeResponse(response)}\n`, () => process.exit(0));
}
// The parent process must also enforce this deadline because synchronous engine calls block timers.
const startedAt = performance.now();
let timer = setTimeout(
  () => finish(failure(null, 'TIMEOUT')),
  LIMITS.timeoutMs,
);
try {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > LIMITS.outputBytes) {
      finish(failure(null, 'INPUT_LIMIT'));
      break;
    }
    chunks.push(chunk);
  }
  if (!sent) {
    let request: unknown;
    try {
      request = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      finish(failure(null, 'INVALID_JSON'));
    }
    if (!sent) {
      const elapsed = performance.now() - startedAt;
      // Reading/parsing still gets two seconds; operation text alone cannot extend it.
      if (elapsed >= LIMITS.timeoutMs) finish(failure(null, 'TIMEOUT'));
      else if (requestDeadlineMs(request) === LIMITS.settingsTimeoutMs) {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(failure(null, 'TIMEOUT')),
          Math.max(
            1,
            LIMITS.settingsTimeoutMs - (performance.now() - startedAt),
          ),
        );
      }
      let engine: Engine | undefined;
      try {
        if (!sent) engine = await import('@redact-secret/core');
      } catch {
        finish(failure(null, 'ENGINE_UNAVAILABLE'));
      }
      if (!sent && engine) finish(await processRequest(request, engine));
    }
  }
} catch {
  finish(failure(null, 'INPUT_FAILURE'));
} finally {
  clearTimeout(timer);
}
