import type { PromptOrigin, PromptSubmitInput } from 'claude-code';
import type { Segment } from '../protocol.ts';
import {
  isNonnegativeInteger,
  isStringArray,
  hasOnlyDataKeys as keys,
  hasOwn as own,
} from '../validation.ts';

export interface UnsupportedShape {
  status: 'blocked';
  errorCode: 'UNSUPPORTED_SHAPE';
}
export interface PromptExtraction {
  status: 'ok';
  shape: 'prompt';
  segments: Segment[];
  metadata: { wait: boolean; origin: PromptOrigin; turnId?: string };
}
export interface BashExtraction {
  status: 'ok';
  shape: 'Bash';
  segments: Segment[];
  metadata: { interrupted: boolean };
}
export interface ReadExtraction {
  status: 'ok';
  shape: 'Read';
  segments: Segment[];
  metadata: { numLines: number; startLine: number; totalLines: number };
}
export type ToolExtraction = BashExtraction | ReadExtraction;
export type Extraction = PromptExtraction | ToolExtraction;
export type TrustedToolResult =
  | { deny: string }
  | {
      result:
        | { stdout: string; stderr: string; interrupted: boolean }
        | {
            type: 'text';
            file: {
              filePath: string;
              content: string;
              numLines: number;
              startLine: number;
              totalLines: number;
            };
          };
    };
const blocked = (): UnsupportedShape => ({
  status: 'blocked',
  errorCode: 'UNSUPPORTED_SHAPE',
});

// The model-origin host envelope retains these optional keys as undefined.
// Populated values can carry paths, aliases or background output, so withhold them.
const emptyBashFields = [
  'returnCodeInterpretation',
  'backgroundTaskId',
  'backgroundedByUser',
  'backgroundedByTurnAbort',
  'backgroundedToDeliverMessage',
  'timedOutAfterMs',
  'backgroundEndsWithFinalResponse',
  'backgroundCwdHint',
  'dangerouslyDisableSandbox',
  'persistedOutputPath',
  'persistedOutputSize',
  'staleReadFileStateHint',
  'ghRateLimitHint',
  'gitOperation',
  'bashEditDiff',
];
const safeOriginKinds = new Set([
  'composer',
  'bridge',
  'sdk',
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
  'unclassified',
  'slack-ping',
]);
function validOrigin(origin: unknown): origin is PromptOrigin {
  if (
    keys(origin, ['kind']) &&
    typeof origin.kind === 'string' &&
    safeOriginKinds.has(origin.kind)
  )
    return true;
  if (
    keys(origin, ['kind', 'name', 'asUser']) &&
    origin.kind === 'plugin' &&
    typeof origin.name === 'string'
  ) {
    return !own(origin, 'asUser') || origin.asUser === true;
  }
  return (
    keys(origin, ['kind', 'server']) &&
    origin.kind === 'channel' &&
    typeof origin.server === 'string'
  );
}

export function extractPrompt(
  value: unknown,
): PromptExtraction | UnsupportedShape {
  if (
    !keys(value, [
      'text',
      'context',
      'attachments',
      'wait',
      'origin',
      'turnId',
    ]) ||
    typeof value.text !== 'string' ||
    typeof value.wait !== 'boolean' ||
    !validOrigin(value.origin) ||
    (own(value, 'turnId') && typeof value.turnId !== 'string') ||
    (own(value, 'attachments') &&
      (!Array.isArray(value.attachments) || value.attachments.length)) ||
    (own(value, 'context') && !isStringArray(value.context))
  )
    return blocked();
  const context = isStringArray(value.context) ? value.context : [];
  return {
    status: 'ok',
    shape: 'prompt',
    segments: [
      { id: 'text', text: value.text },
      ...context.map((text, index) => ({ id: `context${index}`, text })),
    ],
    metadata: {
      wait: value.wait,
      origin: value.origin,
      ...(typeof value.turnId === 'string' ? { turnId: value.turnId } : {}),
    },
  };
}

function sanitized(
  extraction: Extraction | UnsupportedShape,
  segments: unknown,
): Map<string, string> | null {
  if (
    extraction?.status !== 'ok' ||
    !Array.isArray(segments) ||
    segments.length !== extraction.segments.length
  )
    return null;
  const expected = new Set(extraction.segments.map((segment) => segment.id));
  const output = new Map<string, string>();
  for (const segment of segments) {
    if (
      !keys(segment, ['id', 'text']) ||
      typeof segment.id !== 'string' ||
      !expected.has(segment.id) ||
      output.has(segment.id) ||
      typeof segment.text !== 'string'
    )
      return null;
    output.set(segment.id, segment.text);
  }
  return output;
}

export function rebuildPrompt(
  extraction: PromptExtraction | UnsupportedShape,
  segments: unknown,
): PromptSubmitInput | { drop: string } {
  const values = sanitized(extraction, segments);
  if (!values || extraction.status !== 'ok' || extraction.shape !== 'prompt')
    return { drop: 'INVALID_RESPONSE' };
  const text = values.get('text');
  if (text === undefined) return { drop: 'INVALID_RESPONSE' };
  const result: PromptSubmitInput = {
    text,
    wait: extraction.metadata.wait,
    origin: extraction.metadata.origin,
  };
  if (own(extraction.metadata, 'turnId'))
    result.turnId = extraction.metadata.turnId;
  if (values.size > 1)
    result.context = extraction.segments.slice(1).map((segment) => {
      const text = values.get(segment.id);
      if (text === undefined) throw new Error('INVALID_RESPONSE');
      return text;
    });
  return result;
}

export function extractToolResult(
  tool: string,
  value: unknown,
): ToolExtraction | UnsupportedShape {
  if (
    !keys(value, [
      'result',
      'text',
      'ref',
      'context',
      'isError',
      'isReadOnly',
      'deny',
    ]) ||
    value.isError === true ||
    (own(value, 'deny') && value.deny !== undefined) ||
    (own(value, 'context') &&
      (!Array.isArray(value.context) || value.context.length)) ||
    (own(value, 'isError') && value.isError !== undefined) ||
    (own(value, 'isReadOnly') &&
      value.isReadOnly !== true &&
      value.isReadOnly !== undefined) ||
    (own(value, 'text') &&
      value.text !== undefined &&
      typeof value.text !== 'string') ||
    (own(value, 'ref') &&
      value.ref !== undefined &&
      !Number.isSafeInteger(value.ref))
  )
    return blocked();
  const result = value.result;
  if (tool === 'Bash') {
    if (
      !keys(result, [
        'stdout',
        'stderr',
        'interrupted',
        'isImage',
        'noOutputExpected',
        ...emptyBashFields,
      ]) ||
      emptyBashFields.some(
        (field) => own(result, field) && result[field] !== undefined,
      ) ||
      typeof result.stdout !== 'string' ||
      typeof result.stderr !== 'string' ||
      typeof result.interrupted !== 'boolean' ||
      (own(result, 'isImage') && result.isImage !== false) ||
      (own(result, 'noOutputExpected') &&
        typeof result.noOutputExpected !== 'boolean')
    )
      return blocked();
    return {
      status: 'ok',
      shape: 'Bash',
      metadata: { interrupted: result.interrupted },
      segments: [
        { id: 'stdout', text: result.stdout },
        { id: 'stderr', text: result.stderr },
      ],
    };
  }
  if (tool === 'Read') {
    if (
      !keys(result, ['type', 'file']) ||
      result.type !== 'text' ||
      !keys(result.file, [
        'filePath',
        'content',
        'numLines',
        'startLine',
        'totalLines',
      ]) ||
      typeof result.file.filePath !== 'string' ||
      typeof result.file.content !== 'string' ||
      !isNonnegativeInteger(result.file.numLines) ||
      !isNonnegativeInteger(result.file.startLine) ||
      !isNonnegativeInteger(result.file.totalLines)
    )
      return blocked();
    return {
      status: 'ok',
      shape: 'Read',
      metadata: {
        numLines: result.file.numLines,
        startLine: result.file.startLine,
        totalLines: result.file.totalLines,
      },
      segments: [
        { id: 'filePath', text: result.file.filePath },
        { id: 'content', text: result.file.content },
      ],
    };
  }
  return blocked();
}

export function rebuildToolResult(
  extraction: ToolExtraction | UnsupportedShape,
  segments: unknown,
): TrustedToolResult {
  const values = sanitized(extraction, segments);
  if (!values || extraction.status !== 'ok')
    return { deny: 'INVALID_RESPONSE' };
  if (extraction.shape === 'Bash') {
    const stdout = values.get('stdout');
    const stderr = values.get('stderr');
    if (stdout === undefined || stderr === undefined)
      return { deny: 'INVALID_RESPONSE' };
    return {
      result: { stdout, stderr, interrupted: extraction.metadata.interrupted },
    };
  }
  const filePath = values.get('filePath');
  const content = values.get('content');
  if (filePath === undefined || content === undefined)
    return { deny: 'INVALID_RESPONSE' };
  return {
    result: {
      type: 'text',
      file: { filePath, content, ...extraction.metadata },
    },
  };
}
