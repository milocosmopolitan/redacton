import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPrompt,
  extractToolResult,
  rebuildPrompt,
  rebuildToolResult,
} from '../../mod/adapters/text.ts';

test('Bash fresh envelope strips text/ref aliases and scans both streams', () => {
  const input = {
    result: { stdout: 'raw output', stderr: 'raw error', interrupted: false },
    text: 'raw alias',
    ref: 42,
    isReadOnly: true,
  };
  const extracted = extractToolResult('Bash', input);
  assert.ok(extracted.status === 'ok');
  assert.deepEqual(
    extracted.segments.map((segment) => segment.id),
    ['stdout', 'stderr'],
  );
  assert.deepEqual(
    rebuildToolResult(extracted, [
      { id: 'stderr', text: 'clean error' },
      { id: 'stdout', text: 'clean output' },
    ]),
    {
      result: {
        stdout: 'clean output',
        stderr: 'clean error',
        interrupted: false,
      },
    },
  );
  assert.equal(input.text, 'raw alias');
});

test('Read sanitizes required path and content, not just its display alias', () => {
  const extracted = extractToolResult('Read', {
    result: {
      type: 'text',
      file: {
        filePath: '/raw',
        content: 'raw',
        numLines: 1,
        startLine: 1,
        totalLines: 1,
      },
    },
    ref: 1,
  });
  assert.ok(extracted.status === 'ok');
  assert.deepEqual(
    rebuildToolResult(extracted, [
      { id: 'filePath', text: '/clean' },
      { id: 'content', text: 'clean' },
    ]),
    {
      result: {
        type: 'text',
        file: {
          filePath: '/clean',
          content: 'clean',
          numLines: 1,
          startLine: 1,
          totalLines: 1,
        },
      },
    },
  );
});

test('model-origin Bash undefined optional fields are stripped; populated aliases stay blocked', () => {
  const ordinary = {
    stdout: 'ordinary',
    stderr: '',
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
    persistedOutputPath: undefined,
    backgroundTaskId: undefined,
    bashEditDiff: undefined,
    returnCodeInterpretation: undefined,
    rawOutputPath: undefined,
    structuredContent: undefined,
  };
  const extracted = extractToolResult('Bash', {
    result: ordinary,
    context: [],
    ref: 1,
    isReadOnly: true,
  });
  assert.ok(extracted.status === 'ok');
  assert.deepEqual(rebuildToolResult(extracted, extracted.segments), {
    result: { stdout: 'ordinary', stderr: '', interrupted: false },
  });
  for (const field of [
    'persistedOutputPath',
    'backgroundTaskId',
    'bashEditDiff',
    'returnCodeInterpretation',
    'rawOutputPath',
    'structuredContent',
  ]) {
    assert.equal(
      extractToolResult('Bash', {
        result: { ...ordinary, [field]: 'uninspected' },
      }).status,
      'blocked',
    );
  }
  assert.equal(
    extractToolResult('Bash', {
      result: { ...ordinary, unknownAlias: undefined },
    }).status,
    'blocked',
  );
});

test('Bash known aliases accept only absent or undefined data properties', () => {
  const result = { stdout: 'synthetic', stderr: '', interrupted: false };
  for (const field of ['rawOutputPath', 'structuredContent']) {
    for (const value of ['', null, [], {}, ['synthetic alias'], '/synthetic']) {
      assert.equal(
        extractToolResult('Bash', {
          result: { ...result, [field]: value },
        }).status,
        'blocked',
      );
    }
    const accessor = Object.defineProperty({ ...result }, field, {
      enumerable: true,
      get() {
        throw new Error('must not read alias');
      },
    });
    assert.equal(
      extractToolResult('Bash', { result: accessor }).status,
      'blocked',
    );
  }
  assert.equal(
    extractToolResult('Bash', {
      result: { ...result, [Symbol('synthetic')]: undefined },
    }).status,
    'blocked',
  );
});

test('unsupported selected shapes, downstream context and getters are withheld', () => {
  const bash = { stdout: '', stderr: '', interrupted: false };
  for (const input of [
    { result: bash, context: ['raw'] },
    { result: { ...bash, outputFile: '/raw' } },
    { result: bash, isError: true },
    { result: bash, extra: 'raw' },
    { result: null },
    {
      get result() {
        throw new Error('must not invoke');
      },
    },
  ]) {
    assert.equal(extractToolResult('Bash', input).status, 'blocked');
  }
  assert.equal(
    extractToolResult('Read', { result: { type: 'image', file: {} } }).status,
    'blocked',
  );
  assert.equal(
    extractToolResult('Bash', { result: { ...bash, isImage: true } }).status,
    'blocked',
  );
  const ordinary = extractToolResult('Bash', {
    result: { ...bash, isImage: false, noOutputExpected: false },
  });
  assert.ok(ordinary.status === 'ok');
  assert.deepEqual(rebuildToolResult(ordinary, ordinary.segments), {
    result: bash,
  });
});

test('prompt context is batched and rebuilt before submission, attachments are blocked', () => {
  const origin = { kind: 'sdk' };
  const extracted = extractPrompt({
    text: 'raw',
    context: ['raw context'],
    wait: false,
    origin,
    turnId: 'opaque',
  });
  assert.ok(extracted.status === 'ok');
  const rebuilt = rebuildPrompt(extracted, [
    { id: 'text', text: 'clean' },
    { id: 'context0', text: 'clean context' },
  ]);
  assert.deepEqual(rebuilt, {
    text: 'clean',
    context: ['clean context'],
    wait: false,
    origin,
    turnId: 'opaque',
  });
  assert.ok(!('drop' in rebuilt));
  assert.equal(rebuilt.origin, origin);
  assert.equal(
    extractPrompt({ text: 'raw', wait: false, origin, attachments: [{}] })
      .status,
    'blocked',
  );
  const pluginOrigin = Object.freeze({
    kind: 'plugin',
    name: 'redacton',
    asUser: true,
  });
  const plugin = extractPrompt({
    text: 'raw',
    wait: false,
    origin: pluginOrigin,
  });
  assert.equal(plugin.status, 'ok');
  const rebuiltPlugin = rebuildPrompt(plugin, [{ id: 'text', text: 'clean' }]);
  assert.ok(!('drop' in rebuiltPlugin));
  assert.equal(rebuiltPlugin.origin, pluginOrigin);
  assert.equal(
    extractPrompt({
      text: 'raw',
      wait: false,
      origin: { kind: 'plugin', name: 'redacton', raw: 'alias' },
    }).status,
    'blocked',
  );
});

test('partial, duplicate and invented scanner segment responses never mix original text', () => {
  const extracted = extractToolResult('Bash', {
    result: { stdout: 'raw', stderr: 'raw', interrupted: false },
  });
  for (const segments of [
    [{ id: 'stdout', text: 'clean' }],
    [
      { id: 'stdout', text: 'clean' },
      { id: 'stdout', text: 'clean' },
    ],
    [
      { id: 'stdout', text: 'clean' },
      { id: 'invented', text: 'clean' },
    ],
  ]) {
    assert.deepEqual(rebuildToolResult(extracted, segments), {
      deny: 'INVALID_RESPONSE',
    });
  }
});
