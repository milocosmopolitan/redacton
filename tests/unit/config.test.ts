import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfigController,
  type ConfigDocument,
  effectiveConfiguration,
  removeRule,
} from '../../mod/config.ts';
import { createSessionState, record } from '../../mod/state.ts';
import { statusView } from '../../mod/view.ts';

const document: ConfigDocument = {
  schemaVersion: 1,
  rules: [
    {
      kind: 'token',
      id: 'corp_token',
      prefix: 'corp_',
      alphabet: 'alnum',
      run: { kind: 'exact', length: 24 },
      specificity: 'contextual',
      validator: 'none',
      action: 'redact',
    },
  ],
};
function prepared(c: ConfigController, value = document) {
  const draft = c.begin(value);
  assert.equal(c.validated(draft.token, true), true);
  assert.equal(c.previewed(draft.token, true), true);
  return draft;
}
test('approved precedence replaces whole lists including empty layers', () => {
  assert.equal(
    effectiveConfiguration({ personal: document }).source,
    'personal',
  );
  const result = effectiveConfiguration({
    personal: document,
    project: { schemaVersion: 1, rules: [] },
  });
  assert.equal(result.source, 'project');
  assert.equal(result.document.rules.length, 0);
});
test('preview and explicit apply required; cancelled and stale callbacks cannot activate', () => {
  const c = new ConfigController();
  const initial = c.snapshot();
  const draft = c.begin(document);
  assert.equal(c.apply(draft.token).ok, false);
  c.cancel(draft.token);
  assert.equal(c.validated(draft.token, true), false);
  assert.equal(c.snapshot(), initial);
  const next = prepared(c);
  c.replaceApproved(
    { schemaVersion: 1, rules: [] },
    'personal',
    initial.revision,
  );
  assert.deepEqual(c.apply(next.token), { ok: false, code: 'STALE_REVISION' });
});
test('in-flight configuration immutable, revisions monotonic, undo CAS and sessions isolated', () => {
  const c = new ConfigController();
  const other = new ConfigController();
  const captured = c.snapshot();
  const draft = prepared(c);
  assert.equal(c.apply(draft.token).ok, true);
  const active = c.snapshot();
  assert.equal(captured.rules.length, 0);
  assert.equal(other.snapshot().rules.length, 0);
  assert.throws(() =>
    Object.defineProperty(active.rules[0], 'prefix', { value: 'changed' }),
  );
  assert.deepEqual(c.revert(captured.revision), {
    ok: false,
    code: 'STALE_REVISION',
  });
  assert.equal(c.revert(active.revision).ok, true);
  assert.equal(c.snapshot().rules.length, 0);
  assert.notEqual(c.snapshot().revision, captured.revision);
  assert.equal(removeRule(document, 'missing'), null);
  assert.equal(removeRule(document, 'corp_token')?.rules.length, 0);
});
test('status contains cached safe metadata only, changes no state, empty history supported', () => {
  const state = createSessionState('one');
  const c = new ConfigController(document, 'project');
  record(state, { errorCode: 'SCANNED', count: 0 });
  const before = JSON.stringify(state);
  const view = statusView(state, c.snapshot(), 123);
  assert.equal(JSON.stringify(state), before);
  assert.equal(view.readiness, 'loading');
  assert.equal(view.observedAt, 123);
  assert.equal(view.zeroFindingsNote, 'ZERO_FINDINGS_NOT_SAFE_CONTENT');
  assert.equal(JSON.stringify(view).includes('corp_"'), false);
  assert.equal(JSON.stringify(view).includes('alphabet'), false);
  assert.equal(
    statusView(createSessionState('empty'), c.snapshot(), null).recent.length,
    0,
  );
});

import { replaceRule } from '../../mod/config.ts';
import { SavedSettingsController } from '../../mod/settings.ts';

test('project trust is exact-revision gated, stale and cancelled writes leave approval unchanged', () => {
  const c = new SavedSettingsController();
  c.observe({
    scope: 'project',
    identity: 'project-1',
    revision: 'saved-1',
    document,
  });
  assert.equal(c.approvedLayers().project, undefined);
  assert.equal(c.beginSave('project', document), null);
  assert.equal(c.approveProject('project-1', 'wrong', document), false);
  assert.equal(c.approveProject('project-1', 'saved-1', document), true);
  const intent = c.beginSave('project', { schemaVersion: 1, rules: [] });
  assert.ok(intent);
  c.observe({
    scope: 'project',
    identity: 'project-1',
    revision: 'saved-2',
    document,
  });
  assert.equal(c.approvedLayers().project, undefined);
  assert.equal(
    c.saved(intent.token, {
      scope: 'project',
      identity: 'project-1',
      revision: 'saved-3',
      document: intent.document,
    }),
    false,
  );
  c.approveProject('project-1', 'saved-2', document);
  const cancelled = c.beginSave('project', document);
  assert.ok(cancelled);
  c.cancel(cancelled.token);
  assert.equal(
    c.saved(cancelled.token, {
      scope: 'project',
      identity: 'project-1',
      revision: 'saved-4',
      document,
    }),
    false,
  );
});
test('personal save receipt binds exact candidate, scope and durable identity', () => {
  const c = new SavedSettingsController();
  c.observe({
    scope: 'personal',
    identity: 'personal-1',
    revision: 'saved-1',
    document: { schemaVersion: 1, rules: [] },
  });
  const intent = c.beginSave('personal', document);
  assert.ok(intent);
  assert.equal(
    c.saved(intent.token, {
      scope: 'personal',
      identity: 'personal-1',
      revision: 'saved-2',
      document: { schemaVersion: 1, rules: [] },
    }),
    false,
  );
  assert.equal(
    c.saved(intent.token, {
      scope: 'personal',
      identity: 'personal-1',
      revision: 'saved-2',
      document,
    }),
    true,
  );
  assert.equal(c.approvedLayers().personal?.rules.length, 1);
});

test('invalid validation and preview keep active baseline', () => {
  const controller = new ConfigController(document);
  const active = controller.snapshot();
  const draft = controller.begin({ schemaVersion: 1, rules: [] });
  assert.equal(controller.validated(draft.token, false), false);
  assert.equal(controller.previewed(draft.token, true), false);
  assert.equal(controller.apply(draft.token).ok, false);
  assert.equal(controller.snapshot(), active);
  assert.equal(controller.validated(draft.token, true), true);
  assert.equal(controller.previewed(draft.token, false), false);
  assert.equal(controller.snapshot(), active);
});

test('same-revision scope switch cannot authorize receipt; session reset revokes trust and pending writes', () => {
  const c = new SavedSettingsController();
  c.observe({
    scope: 'project',
    identity: 'project-1',
    revision: 'absent',
    document,
  });
  c.approveProject('project-1', 'absent', document);
  const intent = c.beginSave('project', document);
  assert.ok(intent);
  c.observe({
    scope: 'project',
    identity: 'project-2',
    revision: 'absent',
    document,
  });
  assert.equal(
    c.saved(intent.token, {
      scope: 'project',
      identity: 'project-1',
      revision: 'saved-1',
      document,
    }),
    false,
  );
  assert.equal(c.approvedLayers().project, undefined);
  c.approveProject('project-2', 'absent', document);
  const pending = c.beginSave('project', document);
  assert.ok(pending);
  c.resetSession();
  assert.deepEqual(c.approvedLayers(), {});
  assert.equal(
    c.saved(pending.token, {
      scope: 'project',
      identity: 'project-2',
      revision: 'saved-2',
      document,
    }),
    false,
  );
});

test('replayed durable revision with changed project body requires a fresh exact review', () => {
  const c = new SavedSettingsController();
  c.observe({ scope: 'project', identity: 'p', revision: 'r', document });
  assert.equal(c.approveProject('p', 'r', document), true);
  const pending = c.beginSave('project', document);
  assert.ok(pending);
  const empty: ConfigDocument = { schemaVersion: 1, rules: [] };
  c.observe({
    scope: 'project',
    identity: 'p',
    revision: 'r',
    document: empty,
  });
  assert.equal(c.approvedLayers().project, undefined);
  assert.equal(c.approveProject('p', 'r', document), false);
  assert.equal(
    c.saved(pending.token, {
      scope: 'project',
      identity: 'p',
      revision: 'new',
      document,
    }),
    false,
  );
  assert.equal(c.approveProject('p', 'r', empty), true);
});

test('fresh controllers cannot accept callbacks from prior sessions with the same local epoch', () => {
  const old = new ConfigController();
  const current = new ConfigController();
  const prior = old.begin(document);
  const next = current.begin(document);
  assert.notEqual(prior.token, next.token);
  assert.equal(current.validated(prior.token, true), false);
  const oldSaved = new SavedSettingsController();
  const newSaved = new SavedSettingsController();
  for (const controller of [oldSaved, newSaved])
    controller.observe({
      scope: 'personal',
      identity: 'p',
      revision: 'absent',
      document,
    });
  const previousIntent = oldSaved.beginSave('personal', document);
  const currentIntent = newSaved.beginSave('personal', document);
  assert.ok(previousIntent);
  assert.ok(currentIntent);
  assert.notEqual(previousIntent.token, currentIntent.token);
  assert.equal(
    newSaved.saved(previousIntent.token, {
      scope: 'personal',
      identity: 'p',
      revision: 'next',
      document,
    }),
    false,
  );
});

import { ImportReviewController } from '../../mod/settings.ts';

test('portable import is only a reviewed draft; replacement and cancellation invalidate old approvals', () => {
  const imports = new ImportReviewController();
  const active = new ConfigController();
  const before = active.snapshot();
  const first = imports.stage('project', 'p', document);
  assert.equal(imports.approved(first.token), null);
  assert.equal(
    imports.approve(first.token, { schemaVersion: 1, rules: [] }),
    false,
  );
  assert.equal(imports.approve(first.token, first.document), true);
  assert.equal(active.snapshot(), before);
  const second = imports.stage('project', 'p', { schemaVersion: 1, rules: [] });
  assert.equal(imports.approved(first.token), null);
  assert.equal(imports.approve(first.token, first.document), false);
  assert.equal(imports.approve(second.token, second.document), true);
  imports.cancel();
  assert.equal(imports.approved(second.token), null);
});

test('existing-rule edits are atomic drafts; missing and duplicate targets reject without mutation', () => {
  const rule = document.rules[0];
  assert.ok(rule);
  const edited = { ...rule, action: 'block' as const };
  const controller = new ConfigController(document, 'project');
  const active = controller.snapshot();
  assert.equal(replaceRule(document, 'missing', edited), null);
  const second = { ...rule, id: 'second_rule' };
  const pair: ConfigDocument = { schemaVersion: 1, rules: [rule, second] };
  assert.equal(replaceRule(pair, rule.id, second), null);
  const candidate = replaceRule(document, rule.id, edited);
  assert.ok(candidate);
  const cancelled = controller.begin(candidate, 'session');
  assert.equal(controller.snapshot(), active);
  controller.cancel(cancelled.token);
  assert.equal(controller.snapshot(), active);
  const draft = prepared(controller, candidate);
  assert.equal(controller.snapshot(), active);
  assert.equal(controller.apply(draft.token).ok, true);
  assert.equal(controller.snapshot().scope, 'session');
  assert.equal(controller.snapshot().rules[0]?.action, 'block');
  assert.equal(active.rules[0]?.action, 'redact');
  assert.equal(controller.apply(draft.token).ok, false);
});

import { candidateDocument, populateForm } from '../../mod/form.ts';

test('guided edit preserves all fields, rejects ID collision, and retains the other rule', () => {
  const rule = document.rules[0];
  assert.ok(rule);
  const other = { ...rule, id: 'other-rule' };
  const active: ConfigDocument = { schemaVersion: 1, rules: [rule, other] };
  const form = populateForm(rule);
  assert.equal(form.editingId, rule.id);
  assert.deepEqual(candidateDocument(active, form), active);
  form.id = other.id;
  assert.equal(candidateDocument(active, form), null);
  form.id = 'edited-rule';
  form.action = 'block';
  const candidate = candidateDocument(active, form);
  assert.ok(candidate);
  assert.equal(candidate.rules.length, 2);
  assert.equal(candidate.rules[0]?.id, 'edited-rule');
  assert.deepEqual(candidate.rules[1], other);
  assert.equal(active.rules[0]?.id, rule.id);
  assert.equal(form.busy, false);
  assert.equal(form.durableBusy, false);
});

import { sharedNamesAction } from '../../mod/config.ts';

test('explicit assignment-name group action atomically updates all names and no token actions', () => {
  const token = document.rules[0];
  assert.ok(token);
  const active: ConfigDocument = {
    schemaVersion: 1,
    rules: [
      token,
      {
        kind: 'names',
        id: 'corp_names',
        names: ['CorpPhrase'],
        action: 'redact',
      },
      {
        kind: 'names',
        id: 'team_names',
        names: ['TeamPhrase'],
        action: 'redact',
      },
    ],
  };
  assert.equal(sharedNamesAction(active), 'redact');
  const selected = active.rules[1];
  assert.ok(selected);
  const form = populateForm(selected);
  form.action = 'block';
  assert.equal(candidateDocument(active, form), null);
  form.namesGroupAction = true;
  const candidate = candidateDocument(active, form);
  assert.ok(candidate);
  assert.equal(candidate.rules[0]?.action, 'redact');
  assert.deepEqual(
    candidate.rules.slice(1).map((rule) => rule.action),
    ['block', 'block'],
  );
  assert.deepEqual(
    active.rules.slice(1).map((rule) => rule.action),
    ['redact', 'redact'],
  );
  const controller = new ConfigController(active);
  const captured = controller.snapshot();
  const draft = prepared(controller, candidate);
  assert.equal(controller.snapshot(), captured);
  assert.equal(controller.apply(draft.token).ok, true);
  assert.deepEqual(
    controller
      .snapshot()
      .rules.slice(1)
      .map((rule) => rule.action),
    ['block', 'block'],
  );
});
