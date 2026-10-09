import type {
  EngineInterface,
  On,
  ToolCallInput,
  ToolCallResult,
} from 'claude-code';
import type { TrustedToolResult } from './adapters/text.ts';
import {
  extractPrompt,
  extractToolResult,
  rebuildPrompt,
  rebuildToolResult,
} from './adapters/text.ts';
import type { HelperRequest, HelperResponse } from './protocol.ts';
import {
  LIMITS,
  makeRequest,
  POLICY_ID,
  validateProcessResponse,
} from './protocol.ts';
import type { OperationSnapshot, SessionState } from './state.ts';
import {
  createSessionState,
  record,
  requestProtection,
  setReadiness,
  snapshot,
} from './state.ts';

interface Runtime {
  sequence: number;
  pending: number;
}
interface OperationSlot {
  captured: OperationSnapshot;
  controller: SessionState;
  trusted: TrustedToolResult | null;
}

// Child input is stdin only; scanner imports never enter the Mod runtime.
async function runHelper(
  $: EngineInterface,
  controller: SessionState,
  request: HelperRequest,
  signal: AbortSignal | undefined,
  runtime: Runtime,
): Promise<HelperResponse> {
  if (signal?.aborted) return { status: 'failed', errorCode: 'CANCELLED' };
  if (runtime.pending >= LIMITS.pending)
    return { status: 'failed', errorCode: 'QUEUE_SATURATED' };
  runtime.pending += 1;
  try {
    const result = await $.process.run(
      ['node', `${$.plugin.root}/helper/dist/index.js`],
      { stdin: JSON.stringify(request), timeoutMs: LIMITS.timeoutMs },
    );
    if (signal?.aborted) return { status: 'failed', errorCode: 'CANCELLED' };
    const response = validateProcessResponse(result, request);
    if (response.status !== 'ok') {
      setReadiness(controller, 'unavailable');
      $.ui.invalidate('ui.render');
    }
    return response;
  } catch {
    setReadiness(controller, 'unavailable');
    $.ui.invalidate('ui.render');
    return { status: 'failed', errorCode: 'HELPER_UNAVAILABLE' };
  } finally {
    runtime.pending -= 1;
  }
}

async function checkReadiness(
  $: EngineInterface,
  controller: SessionState,
  runtime: Runtime,
): Promise<void> {
  if (!controller.requestedProtection) return;
  setReadiness(controller, 'loading');
  const response = await runHelper(
    $,
    controller,
    {
      protocolVersion: 1,
      requestId: `check-${++runtime.sequence}`,
      operation: 'self-check',
      policyId: POLICY_ID,
    },
    undefined,
    runtime,
  );
  setReadiness(controller, response.status === 'ok' ? 'ready' : 'unavailable');
  $.ui.invalidate('ui.render');
}

function operationKey(event: {
  tool_use_id?: unknown;
  agentId?: unknown;
  tool?: unknown;
}): string | null {
  if (
    typeof event.tool_use_id !== 'string' ||
    !event.tool_use_id.length ||
    (event.agentId !== undefined && typeof event.agentId !== 'string')
  )
    return null;
  return JSON.stringify([event.agentId ?? null, event.tool, event.tool_use_id]);
}

async function sanitizeSelectedTool<E extends ToolCallInput>(
  $: EngineInterface,
  e: E,
  next: ((event: E) => Promise<ToolCallResult>) & {
    readonly signal: AbortSignal;
  },
  slots: Map<string, OperationSlot>,
  runtime: Runtime,
): Promise<ToolCallResult> {
  const key = operationKey(e);
  const slot = key === null ? undefined : slots.get(key);
  // OFF bypass is associated by the outer operation, not the current toggle.
  if (!slot) return { deny: 'REDACTON_WITHHELD' };
  if (!slot.captured.requestedProtection) return next(e);
  const answer = await next(e);
  if (answer.deny) {
    slot.trusted = { deny: 'REDACTON_TOOL_DENIED' };
    return slot.trusted;
  }
  const extraction = extractToolResult(e.tool, answer);
  if (extraction.status !== 'ok') {
    slot.trusted = { deny: 'REDACTON_UNSUPPORTED_SHAPE' };
    return slot.trusted;
  }
  const request = makeRequest(
    `tool-${++runtime.sequence}`,
    extraction.segments,
  );
  if (!request) {
    slot.trusted = { deny: 'REDACTON_INPUT_LIMIT' };
    return slot.trusted;
  }
  const response = await runHelper(
    $,
    slot.controller,
    request,
    next.signal,
    runtime,
  );
  if (response.status !== 'ok' || next.signal?.aborted) {
    slot.trusted = { deny: 'REDACTON_WITHHELD' };
    return slot.trusted;
  }
  const trusted = rebuildToolResult(extraction, response.segments);
  if ('deny' in trusted) return trusted;
  record(slot.controller, { errorCode: 'SCANNED', count: response.count });
  $.ui.invalidate('ui.render');
  slot.trusted = trusted;
  return trusted;
}

export function register(on: On) {
  let state = createSessionState('initial');
  const runtime = { sequence: 0, pending: 0 };
  const slots = new Map<string, OperationSlot>();

  on('session.start', async ($, e, next) => {
    state = createSessionState(await $.session.id());
    await $.command.register({
      name: 'redacton',
      description: 'Request local credential protection for new operations',
    });
    await $.command.register({
      name: 'redactoff',
      description:
        'Disable credential protection for new operations in this session',
    });
    await checkReadiness($, state, runtime);
    return next(e);
  }).catch((_$, e, next) => next(e));

  // The host does not reload this module on restore/branch; clear OFF at session.end.
  on('session.end', (_$, e, next) => {
    state = createSessionState(`reset-${++runtime.sequence}`);
    return next(e);
  });

  on('command.run', { command: 'redactoff' }, ($, e) => {
    if (e.args?.trim()) return { text: 'Redacton commands take no arguments.' };
    requestProtection(state, false);
    $.ui.invalidate('ui.render');
    return {
      text: 'Warning: Redacton is OFF. Credentials may reach Claude unchanged.',
    };
  }).catch(() => ({ text: 'REDACTON_COMMAND_UNAVAILABLE' }));

  on('command.run', { command: 'redacton' }, async ($, e) => {
    if (e.args?.trim()) return { text: 'Redacton commands take no arguments.' };
    requestProtection(state, true);
    $.ui.invalidate('ui.render');
    await checkReadiness($, state, runtime);
    return {
      text:
        state.readiness === 'ready'
          ? 'Redacton ON. Protect ready. Partial coverage: supported prompt text, Read text, Bash stdout/stderr.'
          : 'Redacton ON. Protection unavailable; selected content will be withheld.',
    };
  }).catch(() => ({
    text: 'Redacton ON. Protection unavailable; selected content will be withheld.',
  }));

  on('prompt.submit', async ($, e, next) => {
    const controller = state;
    const captured = snapshot(controller);
    if (!captured.requestedProtection) return next(e);
    if (captured.readiness === 'loading')
      await checkReadiness($, controller, runtime);
    if (captured.readiness !== 'ready' && controller.readiness !== 'ready')
      return { drop: 'REDACTON_UNAVAILABLE' };
    const extraction = extractPrompt(e);
    if (extraction.status !== 'ok')
      return { drop: 'REDACTON_UNSUPPORTED_SHAPE' };
    const request = makeRequest(
      `prompt-${++runtime.sequence}`,
      extraction.segments,
    );
    if (!request) return { drop: 'REDACTON_INPUT_LIMIT' };
    const response = await runHelper(
      $,
      controller,
      request,
      next.signal,
      runtime,
    );
    if (response.status !== 'ok') return { drop: response.errorCode };
    record(controller, { errorCode: 'SCANNED', count: response.count });
    $.ui.invalidate('ui.render');
    const replacement = rebuildPrompt(extraction, response.segments);
    if ('drop' in replacement || next.signal?.aborted)
      return { drop: 'REDACTON_WITHHELD' };
    return next(replacement);
  }).catch(() => ({ drop: 'REDACTON_WITHHELD' }));

  // Never trust next's returned envelope: a skipped inner hook can return original data.
  on('tool.call', { tool: ['Read', 'Bash'] }, async (_$, e, next) => {
    const controller = state;
    const captured = snapshot(controller);
    const key = operationKey(e);
    if (key === null) return { deny: 'REDACTON_UNSUPPORTED_SHAPE' };
    if (slots.has(key)) return { deny: 'REDACTON_DUPLICATE_OPERATION' };
    if (captured.requestedProtection && slots.size >= LIMITS.pending)
      return { deny: 'REDACTON_QUEUE_SATURATED' };
    const slot: OperationSlot = { captured, controller, trusted: null };
    slots.set(key, slot);
    try {
      if (captured.requestedProtection && captured.readiness !== 'ready')
        return { deny: 'REDACTON_UNAVAILABLE' };
      const answer = await next(e);
      if (!captured.requestedProtection) return answer;
      if (next.signal?.aborted) return { deny: 'REDACTON_CANCELLED' };
      return slot.trusted ?? { deny: 'REDACTON_WITHHELD' };
    } finally {
      slots.delete(key);
    }
  }).catch(() => ({ deny: 'REDACTON_WITHHELD' }));

  on('tool.call', { tool: 'Read' }, ($, e, next) =>
    sanitizeSelectedTool($, e, next, slots, runtime),
  ).catch(() => ({ deny: 'REDACTON_WITHHELD' }));
  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    sanitizeSelectedTool($, e, next, slots, runtime),
  ).catch(() => ({ deny: 'REDACTON_WITHHELD' }));

  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const label = !state.requestedProtection
      ? '⚠ Redacton OFF — credential protection disabled'
      : state.readiness === 'ready'
        ? 'Redacton ON · Protect ready · Partial coverage'
        : `Redacton ON · Protect ${state.readiness} · Selected content withheld`;
    const recent = state.recent[state.recent.length - 1];
    const metadata =
      recent && state.requestedProtection && state.readiness === 'ready'
        ? recent.count === 0
          ? 'No recognized findings; partial coverage.'
          : `Recognized credential findings: ${recent.count}`
        : '';
    return (
      <Box>
        <Text>
          {label}
          {metadata ? ` · ${metadata}` : ''}
        </Text>
      </Box>
    );
  });
}
