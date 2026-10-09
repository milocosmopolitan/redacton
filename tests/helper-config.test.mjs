import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import * as engine from '@redact-secret/core';
import { validateConfigDocument } from '../helper/dist/config.js';
import {
  CANONICAL_TYPES,
  ENGINE_VERSION,
  encodeResponse,
  LIMITS,
  POLICY_ID,
  processRequest,
} from '../helper/dist/core.js';
import { compileConfiguration } from '../helper/dist/rules.js';

const token = (overrides = {}) => ({
  kind: 'token',
  id: 'corp-token',
  action: 'redact',
  prefix: 'ZXQ_',
  alphabet: 'alnum',
  run: { kind: 'exact', length: 20 },
  specificity: 'contextual',
  validator: 'none',
  ...overrides,
});
const config = (rules) => ({
  schemaVersion: 1,
  rules,
  revision: 'draft-7',
  source: 'session',
  scope: 'session',
});
const request = (operation, rules, segments) => ({
  protocolVersion: 2,
  requestId: 'config-test',
  operation,
  policyId: POLICY_ID,
  config: config(rules),
  ...(segments ? { segments } : {}),
});
const scan = (rules, text, e = engine) =>
  processRequest(request('sanitize', rules, [{ id: 's0', text }]), e);

test('strict config fields, positive bounds, duplicate IDs and names action conflicts reject without raw diagnostics', () => {
  for (const document of [
    { schemaVersion: 2, rules: [] },
    { schemaVersion: 1, rules: [], extra: true },
    { schemaVersion: 1, rules: [token({ action: 'warn' })] },
    { schemaVersion: 1, rules: [token({ run: { kind: 'exact', length: 0 } })] },
    { schemaVersion: 1, rules: [token({ prefix: 'BAD\nPREFIX' })] },
    { schemaVersion: 1, rules: [token(), token()] },
    {
      schemaVersion: 1,
      rules: Array.from({ length: 65 }, (_, i) => token({ id: `corp-${i}` })),
    },
    {
      schemaVersion: 1,
      rules: [
        {
          kind: 'names',
          id: 'corp-names',
          action: 'redact',
          names: Array.from({ length: 33 }, (_, i) => `corp_${i}`),
        },
      ],
    },
  ])
    assert.throws(() => validateConfigDocument(document), {
      message: 'INVALID_CONFIG',
    });
  assert.throws(
    () =>
      validateConfigDocument({
        schemaVersion: 1,
        rules: [
          {
            kind: 'names',
            id: 'names-one',
            action: 'redact',
            names: ['corp_one'],
          },
          {
            kind: 'names',
            id: 'names-two',
            action: 'block',
            names: ['corp_two'],
          },
        ],
      }),
    { message: 'NAMES_ACTION_CONFLICT' },
  );
});

test('every pinned alphabet, validator and run recipe previews actual actions with no pattern or text projection', async () => {
  for (const alphabet of [
    'alnum',
    'alnum-dash',
    'alnum-dash-dot',
    'upper-alnum',
    'digit',
    'lower-hex',
    'base64-body',
  ])
    for (const validator of ['none', 'trailing-lower-hex'])
      for (const kind of ['exact', 'at-least']) {
        const response = await processRequest(
          request('preview', [
            token({ alphabet, validator, run: { kind, length: 12 } }),
          ]),
          engine,
        );
        assert.equal(response.status, 'ok');
        assert.equal(response.configRevision, 'draft-7');
        assert.deepEqual(JSON.parse(JSON.stringify(response.outcomes)), [
          {
            id: 'corp-token',
            positive: {
              detected: true,
              action: 'redact',
              findingCounts: { 'corp-token': 1 },
            },
            negative: { detected: false, action: 'none', findingCounts: {} },
          },
        ]);
        assert.equal(JSON.stringify(response).includes('ZXQ_'), false);
      }
});

test('configured custom matches redact or block whole event, preserve canonical/private-key floor, and bind immutable revision', async () => {
  const value = 'ZXQ_12345678901234567890';
  const redacted = await scan([token()], value);
  assert.equal(redacted.status, 'ok');
  assert.equal(redacted.segments[0].text, '<SECRET_1>');
  assert.deepEqual({ ...redacted.findingCounts }, { 'corp-token': 1 });
  assert.equal(redacted.configRevision, 'draft-7');
  const blocked = await scan([token({ action: 'block' })], value);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.errorCode, 'RULE_BLOCKED');
  assert.equal(blocked.segments, undefined);
  const built = await scan(
    [token()],
    'ghp_SYNTHETICREVOKED00000000000000000000',
  );
  assert.equal(built.status, 'ok');
  assert.equal(built.findingCounts.github_token, 1);
  const pem =
    '-----BEGIN PRIVATE KEY-----\nU1lOVEhFVElDX1JFVk9LRURfRklYVFVSRQ==\n-----END PRIVATE KEY-----';
  const privateKey = await scan([token()], `${value}\n${pem}`);
  assert.equal(privateKey.errorCode, 'PRIVATE_KEY_BLOCKED');
  assert.equal(privateKey.segments, undefined);
  for (const id of [
    'github_token',
    'generic-token',
    'generic-token-ruleset-names',
    'pii-domain',
  ]) {
    const rejected = await processRequest(
      request('validate-config', [token({ id })]),
      engine,
    );
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.errorCode, 'INVALID_CONFIG');
  }
});

test('repeated names sections and aliases use one explicit action; built-in overlap stays protected', async () => {
  const rules = [
    {
      kind: 'names',
      id: 'corp-names',
      action: 'block',
      names: ['corp_passphrase'],
    },
    {
      kind: 'names',
      id: 'other-names',
      action: 'block',
      names: ['corp_access'],
    },
  ];
  assert.equal(
    (await processRequest(request('validate-config', rules), engine)).status,
    'ok',
  );
  for (const name of [
    'CorpPassphrase',
    'corp-passphrase',
    'corp_passphrase',
    'corp_access',
  ]) {
    const response = await scan(rules, `${name}=SyntheticPass7x9Q2m4N6p8R0s2T`);
    assert.equal(response.status, 'blocked');
    assert.equal(response.errorCode, 'RULE_BLOCKED');
  }
  const preview = await processRequest(request('preview', rules), engine);
  assert.equal(preview.status, 'ok');
  assert.equal(preview.outcomes.length, 2);
  assert.ok(preview.outcomes.every((row) => row.positive.action === 'block'));
  const overlap = await scan(
    [
      token({
        prefix: 'ghp_',
        action: 'block',
        run: { kind: 'exact', length: 36 },
      }),
    ],
    'ghp_SYNTHETICREVOKED00000000000000000000',
  );
  assert.equal(overlap.status, 'ok');
  assert.equal(overlap.findingCounts.github_token, 1);
});

test('undeclared types, hostile preview counts and output overflow never project raw partial responses', async () => {
  const fake = (findings) => ({
    VERSION: ENGINE_VERSION,
    initialize: async () => {},
    artifact: () => 'addon',
    scanAndRedact: (text, options) => {
      assert.equal(options.actionPolicy, undefined);
      return text === '' || !options.ruleset
        ? { text, findings: [] }
        : { text: 'safe', findings };
    },
  });
  const unknown = await scan(
    [token()],
    'ordinary',
    fake([{ type: 'undeclared', action: 'redact' }]),
  );
  assert.equal(unknown.errorCode, 'POLICY_FAILURE');
  assert.equal(unknown.segments, undefined);
  const findings = Array.from({ length: 501 }, () => ({
    type: 'corp-token',
    action: 'redact',
  }));
  const excessive = await processRequest(
    request('preview', [token()]),
    fake(findings),
  );
  assert.equal(excessive.errorCode, 'FINDING_LIMIT');
  assert.equal(excessive.outcomes, undefined);
  const bad = await processRequest(request('validate-config', []), {
    ...fake([]),
    scanAndRedact: () => ({ text: 'raw', findings: [] }),
  });
  assert.equal(bad.errorCode, 'ENGINE_RESPONSE');
  const limited = JSON.parse(
    encodeResponse({
      requestId: 'config-test',
      protocolVersion: 2,
      configRevision: 'draft-7',
      segments: [{ text: 'x'.repeat(LIMITS.outputBytes) }],
    }),
  );
  assert.equal(limited.errorCode, 'OUTPUT_LIMIT');
  assert.equal(limited.protocolVersion, 2);
  assert.equal(limited.configRevision, 'draft-7');
  assert.ok(CANONICAL_TYPES.length > 0);
});

test('real native and forced WASM CLI validate and preview exact same approved dynamic vocabulary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'redacton-config-'));
  try {
    await cp(resolve('helper/dist'), join(dir, 'helper'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await mkdir(join(dir, 'node_modules/@redact-secret'), { recursive: true });
    for (const name of ['core', 'wasm'])
      await cp(
        resolve('node_modules/@redact-secret', name),
        join(dir, 'node_modules/@redact-secret', name),
        { recursive: true },
      );
    for (const [path, artifact] of [
      [resolve('helper/dist/index.js'), 'addon'],
      [join(dir, 'helper/index.js'), 'wasm'],
    ])
      for (const operation of ['validate-config', 'preview', 'sanitize']) {
        const value = request(
          operation,
          [token()],
          operation === 'sanitize'
            ? [{ id: 's0', text: 'ZXQ_12345678901234567890' }]
            : undefined,
        );
        const child = spawnSync(process.execPath, [path], {
          input: JSON.stringify(value),
          encoding: 'utf8',
          timeout: 3000,
        });
        assert.equal(child.status, 0);
        assert.equal(child.stderr, '');
        const response = JSON.parse(child.stdout);
        assert.equal(response.status, 'ok');
        assert.equal(response.artifact, artifact);
        assert.equal(response.configRevision, 'draft-7');
        if (operation === 'sanitize')
          assert.equal(response.segments[0].text, '<SECRET_1>');
      }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinned default ruleset warns; explicit Redacton callback and documented comparison API expose that footgun', async () => {
  await engine.initialize();
  const compiled = compileConfiguration(
    validateConfigDocument({ schemaVersion: 1, rules: [token()] }),
    CANONICAL_TYPES,
  );
  const text = 'ZXQ_12345678901234567890';
  const defaults = engine.scanAndRedact(text, { ruleset: compiled.ruleset });
  assert.equal(defaults.text, text);
  assert.equal(defaults.findings[0].action, 'warn');
  const comparison = engine.compareActionPolicies(text, {
    ruleset: compiled.ruleset,
    policies: [
      { kind: 'default' },
      { kind: 'callback', policy: compiled.policy },
    ],
    limits: { maxInputBytes: LIMITS.inputBytes, maxFindings: LIMITS.findings },
  });
  assert.equal(comparison.version, ENGINE_VERSION);
  assert.equal(comparison.enforced, false);
  assert.equal(comparison.policies[0].counts.warn, 1);
  assert.equal(comparison.policies[1].counts.redact, 1);
  assert.ok(comparison.policies.every((side) => side.documentSha256 === null));
  assert.throws(
    () =>
      engine.scanAndRedact(text, {
        ruleset: compiled.ruleset,
        policy: compiled.policy,
        actionPolicy: { actionPolicyRevision: 1, base: 'default', rules: [] },
      }),
    (error) => error.code === 'INVALID_OPTIONS',
  );
});

test('baseline core rejects recognized credential literals while public format prefixes remain valid', async () => {
  const recognized = 'ghp_SYNTHETICREVOKED00000000000000000000';
  assert.ok(engine.scanAndRedact(recognized).findings.length > 0);
  for (const rules of [
    [token({ prefix: recognized })],
    [token({ id: 'ghp_syntheticrevoked00000000000000000000' })],
    [{ kind: 'names', id: 'corp-name', action: 'redact', names: [recognized] }],
  ]) {
    const response = await processRequest(
      request('validate-config', rules),
      engine,
    );
    assert.equal(response.status, 'failed');
    assert.equal(response.errorCode, 'INVALID_CONFIG');
    assert.equal(JSON.stringify(response).includes(recognized), false);
  }
  assert.equal(
    (
      await processRequest(
        request('validate-config', [token({ prefix: 'ghp_' })]),
        engine,
      )
    ).status,
    'ok',
  );
});
