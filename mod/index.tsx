import type {
  EngineInterface,
  On,
  RenderChildren,
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
import { isExplicitLocalUser } from './authority.ts';
import {
  type ActiveConfiguration,
  ConfigController,
  effectiveConfiguration,
  removeRule,
  sharedNamesAction,
  type TokenRule,
} from './config.ts';
import {
  candidateConfiguration,
  candidateDocument,
  freshForm,
  populateForm,
  type RuleForm,
} from './form.ts';
import type { HelperRequest, HelperResponse } from './protocol.ts';
import {
  LIMITS,
  makeRequest,
  POLICY_ID,
  utf8Bytes,
  validateProcessResponse,
} from './protocol.ts';
import { failureScope, settingsRemediation } from './recovery.ts';
import { ImportReviewController, SavedSettingsController } from './settings.ts';
import type { OperationSnapshot, SessionState } from './state.ts';
import {
  createSessionState,
  record,
  requestProtection,
  setReadiness,
  snapshot,
} from './state.ts';
import {
  type StorageRequest,
  type StorageResponse,
  type TransferResponse,
  validateStorageResponse,
  validateTransferResponse,
} from './storage.ts';
import { removalView, statusView } from './view.ts';

interface Runtime {
  sequence: number;
  pending: number;
  observedAt: number | null;
  personalLoad: 'pending' | 'ready' | 'failed';
  settingsCode: string;
  generation: number;
  personalPromise: Promise<void> | null;
  recoveryPromise: Promise<void> | null;
  checkPromise: Promise<void> | null;
  healthRevision: string;
  healthEpoch: number;
}
interface OperationSlot {
  captured: OperationSnapshot;
  config: ActiveConfiguration;
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
  const localFailure = (errorCode: string): HelperResponse => {
    if (request.operation === 'sanitize') {
      record(controller, { errorCode, count: 0 });
      $.ui.invalidate('ui.render');
    }
    return { status: 'failed', errorCode };
  };
  if (signal?.aborted) return localFailure('CANCELLED');
  const generation = runtime.generation;
  const healthEpoch = runtime.healthEpoch;
  const payload = JSON.stringify(request);
  if (utf8Bytes(payload) > LIMITS.inputBytes)
    return localFailure('INPUT_LIMIT');
  if (runtime.pending >= LIMITS.pending) return localFailure('QUEUE_SATURATED');
  runtime.pending += 1;
  try {
    const result = await $.process.run(
      ['node', `${$.plugin.root}/helper/dist/index.js`],
      {
        stdin: payload,
        timeoutMs: LIMITS.timeoutMs,
        env: { NODE_OPTIONS: '', NODE_PATH: '' },
      },
    );
    if (signal?.aborted) return localFailure('CANCELLED');
    const response = validateProcessResponse(result, request);
    if (response.status !== 'ok' && request.operation === 'sanitize') {
      record(controller, { errorCode: response.errorCode, count: 0 });
      if (
        failureScope(request.operation, response.errorCode) === 'scanner' &&
        runtime.generation === generation &&
        runtime.healthEpoch === healthEpoch &&
        runtime.healthRevision === request.config?.revision
      ) {
        runtime.healthEpoch += 1;
        runtime.observedAt = Date.now();
        setReadiness(controller, 'unavailable');
      }
      $.ui.invalidate('ui.render');
    }
    return response;
  } catch {
    if (request.operation === 'sanitize') {
      record(controller, { errorCode: 'HELPER_UNAVAILABLE', count: 0 });
      if (
        runtime.generation === generation &&
        runtime.healthEpoch === healthEpoch &&
        runtime.healthRevision === request.config?.revision
      ) {
        runtime.healthEpoch += 1;
        setReadiness(controller, 'unavailable');
        runtime.observedAt = Date.now();
      }
      $.ui.invalidate('ui.render');
    }
    return { status: 'failed', errorCode: 'HELPER_UNAVAILABLE' };
  } finally {
    runtime.pending -= 1;
  }
}

async function checkReadiness(
  $: EngineInterface,
  controller: SessionState,
  runtime: Runtime,
  config: ActiveConfiguration,
): Promise<void> {
  if (!controller.requestedProtection || runtime.personalLoad !== 'ready')
    return;
  if (runtime.checkPromise && runtime.healthRevision === config.revision) {
    await runtime.checkPromise;
    return;
  }
  const generation = runtime.generation;
  const epoch = ++runtime.healthEpoch;
  runtime.healthRevision = config.revision;
  setReadiness(controller, 'loading');
  const work = (async () => {
    const response = await runHelper(
      $,
      controller,
      {
        protocolVersion: 2,
        config,
        requestId: `check-${++runtime.sequence}`,
        operation: 'self-check',
        policyId: POLICY_ID,
      },
      undefined,
      runtime,
    );
    if (
      runtime.generation !== generation ||
      runtime.healthRevision !== config.revision ||
      runtime.healthEpoch !== epoch
    )
      return;
    setReadiness(
      controller,
      response.status === 'ok' ? 'ready' : 'unavailable',
    );
    runtime.observedAt = Date.now();
    $.ui.invalidate('ui.render');
  })();
  runtime.checkPromise = work;
  try {
    await work;
  } finally {
    if (runtime.checkPromise === work) runtime.checkPromise = null;
  }
}

async function runSettings(
  $: EngineInterface,
  request: StorageRequest,
  runtime: Runtime,
): Promise<StorageResponse> {
  const payload = JSON.stringify(request);
  if (utf8Bytes(payload) > LIMITS.inputBytes)
    return { ok: false, code: 'INPUT_LIMIT' };
  if (runtime.pending >= LIMITS.pending)
    return { ok: false, code: 'QUEUE_SATURATED' };
  runtime.pending += 1;
  try {
    const result = await $.process.run(
      ['node', `${$.plugin.root}/helper/dist/index.js`],
      {
        stdin: payload,
        timeoutMs: LIMITS.settingsTimeoutMs,
        env: { NODE_OPTIONS: '', NODE_PATH: '' },
      },
    );
    return validateStorageResponse(result, request);
  } catch {
    return { ok: false, code: 'SETTINGS_UNAVAILABLE' };
  } finally {
    runtime.pending -= 1;
  }
}

async function runTransfer(
  $: EngineInterface,
  request: StorageRequest,
  runtime: Runtime,
): Promise<TransferResponse> {
  const payload = JSON.stringify(request);
  if (utf8Bytes(payload) > LIMITS.inputBytes)
    return { ok: false, code: 'INPUT_LIMIT' };
  if (runtime.pending >= LIMITS.pending)
    return { ok: false, code: 'QUEUE_SATURATED' };
  runtime.pending += 1;
  try {
    const result = await $.process.run(
      ['node', `${$.plugin.root}/helper/dist/index.js`],
      {
        stdin: payload,
        timeoutMs: LIMITS.settingsTimeoutMs,
        env: { NODE_OPTIONS: '', NODE_PATH: '' },
      },
    );
    return validateTransferResponse(result, request);
  } catch {
    return { ok: false, code: 'SETTINGS_UNAVAILABLE' };
  } finally {
    runtime.pending -= 1;
  }
}

async function loadPersonal(
  $: EngineInterface,
  controller: SessionState,
  config: ConfigController,
  settings: SavedSettingsController,
  runtime: Runtime,
): Promise<void> {
  if (!controller.requestedProtection || runtime.personalLoad !== 'pending')
    return;
  const generation = runtime.generation;
  const initial = config.snapshot();
  const response = await runSettings(
    $,
    {
      protocolVersion: 2,
      requestId: `personal-${++runtime.sequence}`,
      operation: 'load-config',
      policyId: POLICY_ID,
      storage: { scope: 'personal', approved: true },
    },
    runtime,
  );
  if (runtime.generation !== generation || !controller.requestedProtection)
    return;
  if (response.ok) {
    settings.observe(response.settings);
    if (initial.scope !== 'session')
      config.replaceApproved(
        response.settings.document,
        'personal',
        initial.revision,
      );
    runtime.personalLoad = 'ready';
    runtime.settingsCode = '';
  } else {
    runtime.personalLoad = 'failed';
    runtime.settingsCode = response.code;
    setReadiness(controller, 'unavailable');
    runtime.observedAt = Date.now();
  }
  $.ui.invalidate('ui.render');
}

async function ensurePersonal(
  $: EngineInterface,
  controller: SessionState,
  config: ConfigController,
  settings: SavedSettingsController,
  runtime: Runtime,
): Promise<void> {
  if (runtime.personalPromise) {
    await runtime.personalPromise;
    return;
  }
  if (runtime.personalLoad !== 'pending' || !controller.requestedProtection)
    return;
  const work = loadPersonal($, controller, config, settings, runtime);
  runtime.personalPromise = work;
  try {
    await work;
  } finally {
    if (runtime.personalPromise === work) runtime.personalPromise = null;
  }
}

const ALPHABETS: readonly TokenRule['alphabet'][] = [
  'alnum',
  'alnum-dash',
  'alnum-dash-dot',
  'upper-alnum',
  'digit',
  'lower-hex',
  'base64-body',
];

async function focusLocal(
  $: EngineInterface,
  target: { requestId: string; key: string },
): Promise<boolean> {
  try {
    const response = await $.ui.focus(target);
    return !response.deny;
  } catch {
    return false;
  }
}

// The engine's record of open panes is authoritative: a host can remove the
// pane without raising `ui.close`. An unreadable record keeps the guard.
async function localPaneListed($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((pane) => pane.id === 'redact-config');
  } catch {
    return true;
  }
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
    record(slot.controller, { errorCode: 'UNSUPPORTED_SHAPE', count: 0 });
    slot.trusted = { deny: 'REDACTON_UNSUPPORTED_SHAPE' };
    return slot.trusted;
  }
  const request = makeRequest(
    `tool-${++runtime.sequence}`,
    extraction.segments,
    slot.config,
  );
  if (!request) {
    record(slot.controller, { errorCode: 'INPUT_LIMIT', count: 0 });
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

function freshFormWithNotice(notice: string): RuleForm {
  const form = freshForm();
  form.notice = notice;
  return form;
}

export function register(on: On) {
  let state = createSessionState('initial');
  const runtime: Runtime = {
    sequence: 0,
    pending: 0,
    observedAt: null,
    personalLoad: 'pending',
    settingsCode: '',
    generation: 0,
    personalPromise: null,
    recoveryPromise: null,
    checkPromise: null,
    healthRevision: '',
    healthEpoch: 0,
  };
  let config = new ConfigController();
  let form: RuleForm = freshForm();
  let paneOpen = false;
  const settings = new SavedSettingsController();
  const imports = new ImportReviewController();
  const slots = new Map<string, OperationSlot>();

  on('session.start', async ($, e, next) => {
    paneOpen = false;
    state = createSessionState(await $.session.id());
    config = new ConfigController();
    settings.resetSession();
    imports.cancel();
    runtime.observedAt = null;
    runtime.generation += 1;
    runtime.personalPromise = null;
    runtime.recoveryPromise = null;
    runtime.checkPromise = null;
    runtime.healthRevision = '';
    runtime.healthEpoch += 1;
    runtime.personalLoad = 'pending';
    runtime.settingsCode = '';
    const controller = state;
    const owner = config;
    const generation = runtime.generation;
    await $.command.register({
      name: 'redacton',
      description: 'Request local credential protection for new operations',
      immediate: true,
    });
    await $.command.register({
      name: 'redactoff',
      description:
        'Disable credential protection for new operations in this session',
      immediate: true,
    });
    await $.command.register({
      name: 'redactconfig',
      description: 'Open local configuration, including during an active tool',
      immediate: true,
    });
    if (runtime.generation !== generation) return next(e);
    await ensurePersonal($, controller, owner, settings, runtime);
    if (runtime.generation === generation)
      await checkReadiness($, controller, runtime, owner.snapshot());
    return next(e);
  }).catch((_$, e, next) => next(e));

  // The host does not reload this module on restore/branch; clear OFF at session.end.
  on('session.end', ($, e, next) => {
    config = new ConfigController();
    settings.resetSession();
    imports.cancel();
    runtime.observedAt = null;
    runtime.generation += 1;
    runtime.personalPromise = null;
    runtime.recoveryPromise = null;
    runtime.checkPromise = null;
    runtime.healthRevision = '';
    runtime.healthEpoch += 1;
    runtime.personalLoad = 'pending';
    runtime.settingsCode = '';
    paneOpen = false;
    form = freshForm();
    $.ui.close({ id: 'redact-config' });
    state = createSessionState(`reset-${++runtime.sequence}`);
    return next(e);
  });

  on('command.run', { command: 'redactoff' }, ($, e) => {
    if (e.args?.trim()) return { text: 'Redacton commands take no arguments.' };
    if (!isExplicitLocalUser(e.origin))
      return {
        text: 'REDACTON_USER_ACTION_REQUIRED: Use /redactoff directly in the local terminal.',
      };
    requestProtection(state, false);
    runtime.generation += 1;
    runtime.personalPromise = null;
    runtime.recoveryPromise = null;
    runtime.checkPromise = null;
    $.ui.invalidate('ui.render');
    return {
      text: 'Warning: Redacton is OFF. Credentials may reach Claude unchanged.',
    };
  }).catch(() => ({ text: 'REDACTON_COMMAND_UNAVAILABLE' }));

  on('command.run', { command: 'redacton' }, async ($, e) => {
    if (e.args?.trim()) return { text: 'Redacton commands take no arguments.' };
    requestProtection(state, true);
    $.ui.invalidate('ui.render');
    const controller = state;
    const owner = config;
    if (!runtime.recoveryPromise) {
      if (runtime.personalLoad === 'failed') runtime.personalLoad = 'pending';
      setReadiness(controller, 'loading');
      const generation = runtime.generation;
      const work = (async () => {
        await ensurePersonal($, controller, owner, settings, runtime);
        if (runtime.generation === generation && controller.requestedProtection)
          await checkReadiness($, controller, runtime, owner.snapshot());
      })();
      runtime.recoveryPromise = work;
      try {
        await work;
      } finally {
        if (runtime.recoveryPromise === work) runtime.recoveryPromise = null;
      }
    } else await runtime.recoveryPromise;
    return {
      text: !state.requestedProtection
        ? 'Redacton OFF. Recovery cancelled; no scanning helper is dispatched for OFF operations.'
        : state.readiness === 'ready'
          ? 'Redacton ON. Protect ready. Partial coverage: supported prompt text, Read text, Bash stdout/stderr.'
          : `Redacton ON. Protection unavailable; selected content will be withheld. ${settingsRemediation(runtime.settingsCode)}`,
    };
  }).catch(() => ({
    text: `Redacton ON. Protection unavailable; selected content will be withheld. ${settingsRemediation(runtime.settingsCode)}`,
  }));

  on(
    'command.run',
    {
      command: [
        'redact:status',
        'redactconfig',
        'redact:config',
        'redact:add-rule',
        'redact:remove-rule',
      ],
    },
    async ($, e) => {
      if (e.args.trim())
        return {
          text: 'Redacton local commands take no arguments. Never put credentials in slash commands.',
        };
      if (e.command === 'redact:status') {
        const view = statusView(state, config.snapshot(), runtime.observedAt);
        return {
          text: `Redacton ${view.protection} · Protect ${view.readiness}. Saved settings: ${runtime.settingsCode || runtime.personalLoad}. Cached observation: ${view.observedAt === null ? 'not observed' : new Date(view.observedAt).toISOString()}. This is not a health check.\nConfiguration ${view.revision} · source ${view.source} · scope ${view.scope} · ${view.customRuleCount} custom rules: ${view.ruleIds.join(', ') || 'none'}.\nSupported: prompt text/context, Read text, Bash stdout/stderr. Excluded: Grep, Glob paths, WebFetch, Write arguments/effects, MCP and other tools; tool arguments, binary/image/audio, PII, existing history. Encoded/base64 credentials can be missed. Zero findings does not mean safe content.\nRecent: ${view.recent.map((item) => `${item.code}:${item.count}`).join(', ') || 'none'}`,
        };
      }
      if (!isExplicitLocalUser(e.origin))
        return {
          text: 'REDACTON_USER_ACTION_REQUIRED: Open configuration directly in the local terminal.',
        };
      imports.cancel();
      form = freshForm();
      form.mode =
        e.command === 'redact:add-rule'
          ? 'add'
          : e.command === 'redact:remove-rule'
            ? 'remove'
            : 'config';
      await $.prompt.fill({ text: '', mode: 'replace' });
      const placement = await $.ui.open({
        id: 'redact-config',
        title: 'Redacton local configuration',
        focus: true,
        closeOnEscape: true,
        rows: 32,
      });
      paneOpen = placement.isPlaced;
      if (!placement.isPlaced) await $.ui.close({ id: 'redact-config' });
      if (placement.isPlaced)
        await focusLocal($, {
          requestId: 'redact-config',
          key:
            form.mode === 'add'
              ? 'rule-id'
              : form.mode === 'remove' && config.snapshot().rules[0]
                ? `remove-${config.snapshot().rules[0]?.id}`
                : 'edit-add',
        });
      return {
        text: placement.isPlaced
          ? 'Redacton local panel opened. No credentials or exact secret values. Changes require validation, synthetic preview, then Apply.'
          : 'Redacton local panel unavailable on this surface. Configuration unchanged.',
      };
    },
  ).catch(() => ({ text: 'REDACTON_LOCAL_COMMAND_UNAVAILABLE' }));

  const releaseLocalPane = () => {
    const draft = config.currentDraft();
    if (draft) config.cancel(draft.token);
    imports.cancel();
    paneOpen = false;
    form = freshForm();
  };

  on('ui.close', ($, e, next) => {
    if (e.id !== 'redact-config') return next(e);
    if (form.durableBusy && e.origin.kind !== 'unload') {
      form.notice =
        'Operation in progress. Wait for completion; a durable write may already commit.';
      $.ui.invalidate('ui.render');
      return { value: undefined };
    }
    releaseLocalPane();
    return next(e);
  });

  // Terminal and desktop element tables both carry every element the form
  // uses; other surfaces keep the host's default (nothing drawn).
  on(
    'ui.render',
    { component: 'Pane', requestId: 'redact-config' },
    ($, e, next) => {
      if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e);
      const { Box, Text, Input, Select, Button } = $.ui.resolve(e);
      // The terminal tree stays as qualified; only the desktop is restyled.
      const desktop = e.surface === 'desktop';
      const tab = (name: RuleForm['tab']) => !desktop || form.tab === name;
      const row = desktop ? { gap: 1, flexWrap: 'wrap' as const } : {};
      const primary = desktop ? { variant: 'primary' as const } : {};
      const Card = ({
        title,
        children,
      }: {
        title?: string;
        children?: RenderChildren;
      }) =>
        desktop ? (
          <Box
            flexDirection="column"
            gap={1}
            borderStyle="round"
            paddingX={1}
            paddingY={1}
          >
            {title ? <Text bold>{title}</Text> : null}
            {children}
          </Box>
        ) : (
          <Box flexDirection="column">{children}</Box>
        );
      const owner = config;
      const formOwner = form;
      const sessionOwner = state;
      const active = owner.snapshot();
      const draft = owner.currentDraft();
      const update = () => $.ui.invalidate('ui.render');
      const changed = () => {
        if (!validOwner()) return;
        if (draft) owner.cancel(draft.token);
        form.notice = '';
        update();
      };
      const close = async () => {
        if (!validOwner()) return;
        if (form.durableBusy) {
          form.notice =
            'Operation in progress. Wait for completion; a durable save may already commit.';
          update();
          return;
        }
        if (draft) owner.cancel(draft.token);
        form = freshForm();
        try {
          await $.ui.close({ id: 'redact-config' });
          paneOpen = false;
          imports.cancel();
          form = freshForm();
        } catch {
          form.notice = 'LOCAL_PANEL_CLOSE_UNAVAILABLE';
          update();
        }
      };
      const validOwner = () =>
        owner === config &&
        sessionOwner === state &&
        formOwner === form &&
        paneOpen;
      const setKind = (choice: RuleForm['kind']) => {
        if (!validOwner()) return;
        form.kind = choice;
        form.namesGroupAction = false;
        if (form.kind === 'names') form.action = sharedNamesAction(active);
        changed();
      };
      const setAction = (choice: RuleForm['action']) => {
        if (!validOwner()) return;
        form.action = choice;
        if (form.kind === 'names') form.namesGroupAction = true;
        changed();
      };
      const setAlphabet = (choice: TokenRule['alphabet']) => {
        if (!validOwner()) return;
        form.alphabet = choice;
        changed();
      };
      const setRunKind = (choice: RuleForm['runKind']) => {
        if (!validOwner()) return;
        form.runKind = choice;
        changed();
      };
      const setSpecificity = (choice: RuleForm['specificity']) => {
        if (!validOwner()) return;
        form.specificity = choice;
        changed();
      };
      const setValidator = (choice: RuleForm['validator']) => {
        if (!validOwner()) return;
        form.validator = choice;
        changed();
      };
      return (
        <Box
          flexDirection="column"
          {...(desktop ? { gap: 1, padding: 1 } : {})}
        >
          {desktop ? (
            <Card>
              <Text bold>
                {!state.requestedProtection
                  ? '⚠ Redacton OFF · credentials may reach Claude unchanged'
                  : `Redacton ON · Protect ${state.readiness} · Partial coverage`}
              </Text>
              <Text>
                Partial coverage: prompt text, Read text and Bash output only.
                Encoded credentials can be missed. Zero findings is not a safety
                guarantee.
              </Text>
              {e.props.isFocused ? null : (
                <Text bold>
                  WARNING: local panel is not focused. Do not type patterns into
                  the composer. Focus this panel before editing.
                </Text>
              )}
              <Text>
                Local declarative patterns only. Never enter a credential or
                exact secret. Nothing is saved until an explicit Save.
              </Text>
              <Text
                dimColor
              >{`Configuration ${active.revision} · ${active.source}/${active.scope} · custom rules ${active.rules.length} · built-in credentials stay enabled`}</Text>
              {runtime.settingsCode ? (
                <Text>{runtime.settingsCode}</Text>
              ) : null}
              <Box {...row}>
                <Button
                  key="details"
                  onPress={() => {
                    if (!validOwner()) return;
                    form.details = !form.details;
                    update();
                  }}
                >
                  {form.details
                    ? 'Hide coverage details'
                    : 'Show coverage details'}
                </Button>
              </Box>
              {form.details ? (
                <Text>
                  Supported: prompt text/context, Read text, Bash stdout/stderr.
                  Unprotected: Grep, Glob paths, WebFetch, Write
                  arguments/effects, MCP, other tools and existing history.
                </Text>
              ) : null}
            </Card>
          ) : (
            <Box flexDirection="column">
              <Text>
                {!state.requestedProtection
                  ? '⚠ Redacton OFF · credentials may reach Claude unchanged'
                  : `Redacton ON · Protect ${state.readiness} · Partial coverage`}
              </Text>
              <Text>
                Supported: prompt text/context, Read text, Bash stdout/stderr.
                Unprotected: Grep, Glob paths, WebFetch, Write
                arguments/effects, MCP, other tools and existing history.
                Encoded/base64 credentials can be missed.
              </Text>
              <Text>{`Configuration ${active.revision} · ${active.source}/${active.scope} · custom rules ${active.rules.length}. Built-in credentials remain enabled. Zero findings is not a safety guarantee.`}</Text>
              <Text>
                {e.props.isFocused
                  ? 'Local panel has keyboard focus. Type only in labeled fields.'
                  : 'WARNING: local panel is not focused. Do not type patterns into the composer. Focus this panel before editing.'}
              </Text>
              <Text>
                Local declarative patterns only. Never enter a credential or
                exact secret. Nothing is saved until an explicit Save.
              </Text>
              <Text>{runtime.settingsCode}</Text>
            </Box>
          )}
          {desktop ? (
            <Box gap={1} flexWrap="wrap">
              {(
                [
                  ['rules', 'Rules'],
                  ['storage', 'Save and load'],
                  ['transfer', 'Import and export'],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={`tab-${id}`}
                  variant={form.tab === id ? 'primary' : 'secondary'}
                  onPress={() => {
                    if (!validOwner()) return;
                    form.tab = id;
                    update();
                  }}
                >
                  {label}
                </Button>
              ))}
            </Box>
          ) : null}
          {desktop && form.notice ? (
            <Card>
              <Text>{form.notice}</Text>
            </Card>
          ) : null}
          {tab('rules') ? (
            <Card title="Custom rules">
              <Box {...row}>
                <Button
                  key="edit-add"
                  onPress={() => {
                    if (!validOwner()) return;
                    form = freshForm();
                    form.mode = 'add';
                    update();
                  }}
                >
                  Add rule
                </Button>
                <Button
                  key="edit-remove"
                  onPress={async () => {
                    if (!validOwner()) return;
                    form = freshForm();
                    form.mode = 'remove';
                    update();
                    const first = active.rules[0];
                    if (first)
                      await focusLocal($, {
                        requestId: 'redact-config',
                        key: `remove-${first.id}`,
                      });
                  }}
                >
                  Remove rule
                </Button>
                <Button
                  key="revert"
                  onPress={async () => {
                    if (!validOwner() || form.busy) return;
                    const result = owner.revert(active.revision);
                    form.notice = result.ok
                      ? 'Reverted to previous configuration.'
                      : result.code;
                    if (result.ok && state.requestedProtection)
                      await checkReadiness(
                        $,
                        sessionOwner,
                        runtime,
                        result.config,
                      );
                    if (!validOwner()) return;
                    update();
                  }}
                >
                  Revert
                </Button>
                {desktop ? null : (
                  <Button key="cancel" onPress={close}>
                    Cancel / close
                  </Button>
                )}
              </Box>
              {desktop ? null : <Text>{form.notice}</Text>}
              <Text>
                Editing any inherited custom rule creates a session override.
                Personal and project files stay unchanged until explicit scoped
                Save.
              </Text>
              {desktop && !active.rules.length ? (
                <Text dimColor>No custom rules yet. Choose Add rule.</Text>
              ) : null}
              <Box {...row}>
                {active.rules.map((rule) => (
                  <Button
                    key={`edit-${rule.id}`}
                    onPress={async () => {
                      if (!validOwner() || form.busy) return;
                      const pending = owner.currentDraft();
                      if (pending) owner.cancel(pending.token);
                      form = populateForm(rule);
                      form.notice = `Editing custom rule ${rule.id} as a session override. Validate, preview, Apply.`;
                      update();
                      await focusLocal($, {
                        requestId: 'redact-config',
                        key: 'rule-id',
                      });
                    }}
                  >{`Edit ${rule.id}`}</Button>
                ))}
              </Box>
              {form.mode === 'add' ? (
                <Box flexDirection="column">
                  {desktop ? (
                    <Select
                      key="kind"
                      label="Rule kind"
                      value={form.kind}
                      options={[
                        {
                          value: 'token',
                          label: 'Token: public prefix + shape',
                        },
                        { value: 'names', label: 'Assignment names' },
                      ]}
                      onSelect={(value) =>
                        setKind(value === 'names' ? 'names' : 'token')
                      }
                    />
                  ) : (
                    <Button
                      key="kind"
                      onPress={() =>
                        setKind(form.kind === 'token' ? 'names' : 'token')
                      }
                    >{`Kind: ${form.kind}`}</Button>
                  )}
                  <Input
                    key="rule-id"
                    label="Rule ID"
                    value={form.id}
                    autoFocus
                    onInput={(value) => {
                      if (!validOwner()) return;
                      form.id = value;
                      changed();
                    }}
                    onSubmit={async (value) => {
                      if (!validOwner()) return;
                      form.id = value;
                      changed();
                      update();
                      await focusLocal($, {
                        requestId: 'redact-config',
                        key: form.kind === 'token' ? 'prefix' : 'names',
                      });
                    }}
                  />
                  {desktop ? (
                    <Select
                      key="action"
                      label={
                        form.kind === 'names'
                          ? 'Action for ALL assignment-name rules'
                          : 'Action'
                      }
                      value={form.action}
                      options={[
                        {
                          value: 'redact',
                          label: 'Redact (replace with placeholder)',
                        },
                        {
                          value: 'block',
                          label: 'Block (withhold the content)',
                        },
                      ]}
                      onSelect={(value) =>
                        setAction(value === 'block' ? 'block' : 'redact')
                      }
                    />
                  ) : (
                    <Button
                      key="action"
                      onPress={() =>
                        setAction(form.action === 'redact' ? 'block' : 'redact')
                      }
                    >
                      {form.kind === 'names'
                        ? `Action for ALL assignment-name rules: ${form.action}`
                        : `Action: ${form.action}`}
                    </Button>
                  )}
                  {form.kind === 'token' ? (
                    <Box flexDirection="column">
                      <Input
                        key="prefix"
                        label="Public prefix, 3–64 bytes"
                        value={form.prefix}
                        onInput={(value) => {
                          if (!validOwner()) return;
                          form.prefix = value;
                          changed();
                        }}
                        onSubmit={async (value) => {
                          if (!validOwner()) return;
                          form.prefix = value;
                          changed();
                          update();
                          await focusLocal($, {
                            requestId: 'redact-config',
                            key: 'length',
                          });
                        }}
                      />
                      {desktop ? (
                        <Select
                          key="alphabet"
                          label="Characters after the prefix"
                          value={form.alphabet}
                          options={ALPHABETS.map((value) => ({ value }))}
                          onSelect={(value) =>
                            setAlphabet(
                              ALPHABETS.find((item) => item === value) ??
                                'alnum',
                            )
                          }
                        />
                      ) : (
                        <Button
                          key="alphabet"
                          onPress={() =>
                            setAlphabet(
                              ALPHABETS[
                                (ALPHABETS.indexOf(form.alphabet) + 1) %
                                  ALPHABETS.length
                              ] ?? 'alnum',
                            )
                          }
                        >{`Alphabet: ${form.alphabet}`}</Button>
                      )}
                      {desktop ? (
                        <Select
                          key="run-kind"
                          label="Length mode"
                          value={form.runKind}
                          options={[
                            { value: 'exact', label: 'Exactly this many' },
                            { value: 'at-least', label: 'At least this many' },
                          ]}
                          onSelect={(value) =>
                            setRunKind(
                              value === 'at-least' ? 'at-least' : 'exact',
                            )
                          }
                        />
                      ) : (
                        <Button
                          key="run-kind"
                          onPress={() =>
                            setRunKind(
                              form.runKind === 'exact' ? 'at-least' : 'exact',
                            )
                          }
                        >{`Length mode: ${form.runKind}`}</Button>
                      )}
                      <Input
                        key="length"
                        label="Run length, 1–4096"
                        value={form.length}
                        onInput={(value) => {
                          if (!validOwner()) return;
                          form.length = value;
                          changed();
                        }}
                        onSubmit={async (value) => {
                          if (!validOwner()) return;
                          form.length = value;
                          changed();
                          update();
                          await focusLocal($, {
                            requestId: 'redact-config',
                            key: 'build',
                          });
                        }}
                      />
                      {desktop ? (
                        <Select
                          key="specificity"
                          label="Specificity"
                          value={form.specificity}
                          options={[
                            { value: 'contextual', label: 'Contextual' },
                            { value: 'entropy', label: 'Entropy' },
                          ]}
                          onSelect={(value) =>
                            setSpecificity(
                              value === 'entropy' ? 'entropy' : 'contextual',
                            )
                          }
                        />
                      ) : (
                        <Button
                          key="specificity"
                          onPress={() =>
                            setSpecificity(
                              form.specificity === 'contextual'
                                ? 'entropy'
                                : 'contextual',
                            )
                          }
                        >{`Specificity: ${form.specificity}`}</Button>
                      )}
                      {desktop ? (
                        <Select
                          key="validator"
                          label="Validator"
                          value={form.validator}
                          options={[
                            { value: 'none', label: 'None' },
                            {
                              value: 'trailing-lower-hex',
                              label: 'Trailing lowercase hex',
                            },
                          ]}
                          onSelect={(value) =>
                            setValidator(
                              value === 'trailing-lower-hex'
                                ? 'trailing-lower-hex'
                                : 'none',
                            )
                          }
                        />
                      ) : (
                        <Button
                          key="validator"
                          onPress={() =>
                            setValidator(
                              form.validator === 'none'
                                ? 'trailing-lower-hex'
                                : 'none',
                            )
                          }
                        >{`Validator: ${form.validator}`}</Button>
                      )}
                    </Box>
                  ) : (
                    <Box flexDirection="column">
                      <Input
                        key="names"
                        label="Assignment names, comma-separated (max 32)"
                        value={form.names}
                        onInput={(value) => {
                          if (!validOwner()) return;
                          form.names = value;
                          changed();
                        }}
                        onSubmit={async (value) => {
                          if (!validOwner()) return;
                          form.names = value;
                          changed();
                          update();
                          await focusLocal($, {
                            requestId: 'redact-config',
                            key: 'build',
                          });
                        }}
                      />
                      <Text>
                        Names share one action across all name rules. Names
                        apply only to contextual assignments. A name is not an
                        exact value.
                      </Text>
                    </Box>
                  )}
                  <Button
                    key="build"
                    {...primary}
                    onPress={async () => {
                      if (!validOwner()) return;
                      const document = candidateDocument(active, form);
                      if (!document) {
                        form.notice = 'INVALID_CANDIDATE';
                        update();
                        return;
                      }
                      owner.begin(document);
                      form.notice = form.editingId
                        ? 'Atomic edit draft ready. Validate with the pinned core parser.'
                        : 'Draft ready. Validate with the pinned core parser.';
                      update();
                      await focusLocal($, {
                        requestId: 'redact-config',
                        key: 'validate',
                      });
                    }}
                  >
                    Create draft
                  </Button>
                </Box>
              ) : null}
              {form.mode === 'remove' ? (
                <Box flexDirection="column">
                  {active.rules.map((rule) => {
                    const impact = removalView(active, rule.id);
                    return (
                      <Box key={rule.id}>
                        <Text>{`${rule.id} · ${rule.kind} · ${rule.action} · ${active.source}/${active.scope}`}</Text>
                        <Button
                          key={`remove-${rule.id}`}
                          onPress={async () => {
                            if (!validOwner()) return;
                            if (!impact?.removable) {
                              form.notice =
                                'Inherited rule is read-only. Choose Copy to session to deliberately override.';
                              update();
                              return;
                            }
                            const document = removeRule(active, rule.id);
                            if (document) {
                              owner.begin(document);
                              form.notice =
                                'Removal draft. Other rules and built-ins may still match. Validate, preview, then Apply.';
                              update();
                              await focusLocal($, {
                                requestId: 'redact-config',
                                key: 'validate',
                              });
                            }
                          }}
                        >
                          Select removal
                        </Button>
                      </Box>
                    );
                  })}
                  <Button
                    key="copy-session"
                    onPress={() => {
                      if (!validOwner()) return;
                      owner.begin(active, 'session');
                      form.notice =
                        'Explicit session copy. Validate, preview, Apply, then select removal.';
                      update();
                    }}
                  >
                    Copy to session override
                  </Button>
                </Box>
              ) : null}
            </Card>
          ) : null}
          {tab('storage') ? (
            <Card title="Save and load">
              <Text>
                Personal defaults restore at session boundaries. Project
                settings require explicit load and trust. Precedence: session
                override, trusted project, personal, defaults. Project trust
                lasts this session.
              </Text>
              {desktop ? <Text bold>Load</Text> : null}
              <Box {...row}>
                {(['personal', 'project'] as const).map((scope) => (
                  <Button
                    key={`load-${scope}`}
                    onPress={async () => {
                      if (!validOwner() || form.busy) return;
                      if (!state.requestedProtection) {
                        form.notice = 'TURN_ON_TO_LOAD';
                        update();
                        return;
                      }
                      form.busy = true;
                      const storage =
                        scope === 'project'
                          ? {
                              scope,
                              approved: false,
                              projectRoot: await $.session.root(),
                            }
                          : { scope, approved: true };
                      const response = await runSettings(
                        $,
                        {
                          protocolVersion: 2,
                          requestId: `load-${++runtime.sequence}`,
                          operation: 'load-config',
                          policyId: POLICY_ID,
                          storage,
                        },
                        runtime,
                      );
                      if (validOwner()) {
                        if (response.ok) {
                          settings.observe(response.settings);
                          if (scope === 'personal') {
                            runtime.personalLoad = 'ready';
                            runtime.settingsCode = '';
                            const effective = effectiveConfiguration(
                              settings.approvedLayers(),
                            );
                            if (active.scope !== 'session') {
                              const changed = owner.replaceApproved(
                                effective.document,
                                effective.source,
                                active.revision,
                              );
                              if (changed.ok)
                                await checkReadiness(
                                  $,
                                  sessionOwner,
                                  runtime,
                                  changed.config,
                                );
                            }
                            form.notice =
                              'Personal settings loaded. Session overrides keep precedence.';
                          } else {
                            form.mode = 'project';
                            form.notice =
                              'Project candidate loaded, NOT active. Review rule definitions then Trust exact revision.';
                          }
                        } else form.notice = response.code;
                        form.busy = false;
                        update();
                      }
                    }}
                  >{`Load ${scope}`}</Button>
                ))}
              </Box>
              {form.mode === 'project' ? (
                <Box flexDirection="column">
                  {(() => {
                    const reviewed = settings.loadedConfiguration('project');
                    return reviewed ? (
                      <Box flexDirection="column">
                        <Text>{`Project candidate ${reviewed.revision}. Not active before trust. ${reviewed.document.rules.length} rules.`}</Text>
                        {reviewed.document.rules.map((rule) => (
                          <Text key={`review-${rule.id}`}>
                            {rule.kind === 'token'
                              ? `${rule.id}: ${rule.action}, token prefix ${rule.prefix}, alphabet ${rule.alphabet}, ${rule.run.kind} ${rule.run.length}, ${rule.specificity}, validator ${rule.validator}`
                              : `${rule.id}: ${rule.action}, assignment names ${rule.names.join(', ')}`}
                          </Text>
                        ))}
                        <Button
                          key="trust-project"
                          onPress={async () => {
                            if (!validOwner() || form.busy) return;
                            if (!state.requestedProtection) {
                              form.notice = 'TURN_ON_TO_TRUST';
                              update();
                              return;
                            }
                            if (
                              !settings.approveProject(
                                reviewed.identity,
                                reviewed.revision,
                                reviewed.document,
                              )
                            ) {
                              form.notice = 'PROJECT_REVIEW_STALE';
                              update();
                              return;
                            }
                            const effective = effectiveConfiguration(
                              settings.approvedLayers(),
                            );
                            if (active.scope !== 'session') {
                              const changed = owner.replaceApproved(
                                effective.document,
                                effective.source,
                                active.revision,
                              );
                              if (changed.ok)
                                await checkReadiness(
                                  $,
                                  sessionOwner,
                                  runtime,
                                  changed.config,
                                );
                            }
                            form.notice =
                              'Exact reviewed project configuration trusted for this session. Session override keeps precedence.';
                            update();
                          }}
                        >
                          Trust reviewed project
                        </Button>
                      </Box>
                    ) : null;
                  })()}
                </Box>
              ) : null}
              {desktop ? <Text bold>Save</Text> : null}
              <Box {...row}>
                {(['personal', 'project'] as const).map((scope) => (
                  <Button
                    key={`save-${scope}`}
                    onPress={async () => {
                      if (!validOwner() || form.busy) return;
                      if (!state.requestedProtection) {
                        form.notice = 'TURN_ON_TO_SAVE';
                        update();
                        return;
                      }
                      const loaded = settings.loadedConfiguration(scope);
                      const intent = settings.beginSave(scope, active);
                      if (!loaded || !intent) {
                        form.notice = 'LOAD_AND_REVIEW_SCOPE_FIRST';
                        update();
                        return;
                      }
                      form.busy = true;
                      form.durableBusy = true;
                      form.notice =
                        'Explicit save in progress. Closing does not undo an already dispatched durable write.';
                      update();
                      const storage = {
                        scope,
                        approved: true,
                        ...(scope === 'project'
                          ? { projectRoot: await $.session.root() }
                          : {}),
                        expectedRevision: intent.expectedRevision,
                        expectedIdentity: intent.identity,
                        expectedDocument: loaded.document,
                        document: intent.document,
                      };
                      const response = await runSettings(
                        $,
                        {
                          protocolVersion: 2,
                          requestId: `save-${++runtime.sequence}`,
                          operation: 'save-config',
                          policyId: POLICY_ID,
                          storage,
                        },
                        runtime,
                      );
                      if (validOwner()) {
                        form.notice =
                          response.ok &&
                          settings.saved(intent.token, response.settings)
                            ? `Saved ${scope}. Current session override retained.`
                            : response.ok
                              ? 'STALE_SAVE_RECEIPT'
                              : response.code;
                        form.busy = false;
                        form.durableBusy = false;
                        update();
                      }
                    }}
                  >{`Save ${scope}`}</Button>
                ))}
              </Box>
              {desktop ? <Text bold>Reset</Text> : null}
              <Box {...row}>
                {(['personal', 'project'] as const).map((scope) => (
                  <Button
                    key={`reset-${scope}`}
                    onPress={() => {
                      if (!validOwner() || form.busy) return;
                      form.resetScope = scope;
                      form.notice = `Confirm reset of ${scope} only. Removes additional saved rules; built-ins and other scopes remain. Existing session override remains.`;
                      update();
                    }}
                  >{`Reset ${scope}`}</Button>
                ))}
              </Box>
              {form.resetScope ? (
                <Button
                  key="confirm-reset"
                  onPress={async () => {
                    if (!validOwner() || form.busy) return;
                    if (!state.requestedProtection) {
                      form.notice = 'TURN_ON_TO_RESET';
                      update();
                      return;
                    }
                    const scope = form.resetScope;
                    if (!scope) return;
                    const loaded = settings.loadedConfiguration(scope);
                    const intent = settings.beginSave(scope, {
                      schemaVersion: 1,
                      rules: [],
                    });
                    if (!loaded || !intent) {
                      form.notice = 'LOAD_AND_REVIEW_SCOPE_FIRST';
                      update();
                      return;
                    }
                    form.busy = true;
                    form.durableBusy = true;
                    const storage = {
                      scope,
                      approved: true,
                      ...(scope === 'project'
                        ? { projectRoot: await $.session.root() }
                        : {}),
                      expectedRevision: intent.expectedRevision,
                      expectedIdentity: intent.identity,
                      expectedDocument: loaded.document,
                    };
                    const response = await runSettings(
                      $,
                      {
                        protocolVersion: 2,
                        requestId: `reset-${++runtime.sequence}`,
                        operation: 'reset-config',
                        policyId: POLICY_ID,
                        storage,
                      },
                      runtime,
                    );
                    if (validOwner()) {
                      if (
                        response.ok &&
                        settings.saved(intent.token, response.settings)
                      ) {
                        const effective = effectiveConfiguration(
                          settings.approvedLayers(),
                        );
                        if (active.scope !== 'session') {
                          const changed = owner.replaceApproved(
                            effective.document,
                            effective.source,
                            active.revision,
                          );
                          if (changed.ok)
                            await checkReadiness(
                              $,
                              sessionOwner,
                              runtime,
                              changed.config,
                            );
                        }
                        form.notice = `Reset ${scope} only. Built-ins retained.`;
                      } else
                        form.notice = response.ok
                          ? 'STALE_RESET_RECEIPT'
                          : response.code;
                      form.busy = false;
                      form.durableBusy = false;
                      form.resetScope = null;
                      update();
                    }
                  }}
                >{`Confirm reset ${form.resetScope}`}</Button>
              ) : null}
            </Card>
          ) : null}
          {tab('transfer') ? (
            <Card title="Import and export">
              <Text>
                Portable transfer files contain rule definitions only. Export
                may reveal internal names or prefixes. Review before sharing; no
                history, OFF state, matched input is exported. Never put actual
                credentials in rule fields; unknown sensitive values cannot
                always be recognized.
              </Text>
              {desktop ? <Text bold>Import</Text> : null}
              <Box {...row}>
                {(['personal', 'project'] as const).map((scope) => (
                  <Button
                    key={`import-${scope}`}
                    onPress={async () => {
                      if (!validOwner() || form.busy) return;
                      if (!state.requestedProtection) {
                        form.notice = 'TURN_ON_TO_IMPORT';
                        update();
                        return;
                      }
                      form.busy = true;
                      const storage =
                        scope === 'project'
                          ? {
                              scope,
                              approved: false,
                              projectRoot: await $.session.root(),
                            }
                          : { scope, approved: true };
                      const response = await runTransfer(
                        $,
                        {
                          protocolVersion: 2,
                          requestId: `import-${++runtime.sequence}`,
                          operation: 'import-config',
                          policyId: POLICY_ID,
                          storage,
                        },
                        runtime,
                      );
                      if (validOwner()) {
                        if (response.ok) {
                          imports.stage(
                            scope,
                            response.transfer.identity,
                            response.transfer.document,
                          );
                          form.notice =
                            'Imported candidate only. Review definitions, then explicitly use reviewed import. Active configuration unchanged.';
                        } else form.notice = response.code;
                        form.busy = false;
                        update();
                      }
                    }}
                  >{`Import ${scope}`}</Button>
                ))}
              </Box>
              {(() => {
                const imported = imports.snapshot();
                return imported ? (
                  <Box flexDirection="column">
                    <Text>{`Imported ${imported.scope} candidate ${imported.token}, inactive until reviewed and applied.`}</Text>
                    {imported.document.rules.map((rule) => (
                      <Text key={`import-review-${rule.id}`}>
                        {rule.kind === 'token'
                          ? `${rule.id}: ${rule.action}, prefix ${rule.prefix}, ${rule.alphabet}, ${rule.run.kind} ${rule.run.length}, ${rule.specificity}, ${rule.validator}`
                          : `${rule.id}: ${rule.action}, names ${rule.names.join(', ')}`}
                      </Text>
                    ))}
                    <Button
                      key="approve-import"
                      onPress={() => {
                        if (!validOwner() || form.busy) return;
                        if (
                          !imports.approve(imported.token, imported.document)
                        ) {
                          form.notice = 'STALE_IMPORT_REVIEW';
                          update();
                          return;
                        }
                        const document = imports.approved(imported.token);
                        if (document) {
                          owner.begin(document, 'session');
                          form.notice =
                            'Reviewed import staged as a session draft. Validate, synthetic preview, Apply. Saving is separate.';
                        }
                        update();
                      }}
                    >
                      Use reviewed import draft
                    </Button>
                  </Box>
                ) : null;
              })()}
              {desktop ? <Text bold>Export</Text> : null}
              <Box {...row}>
                {(['personal', 'project'] as const).map((scope) => (
                  <Button
                    key={`export-${scope}`}
                    onPress={async () => {
                      if (!validOwner() || form.busy) return;
                      if (!state.requestedProtection) {
                        form.notice = 'TURN_ON_TO_EXPORT';
                        update();
                        return;
                      }
                      const approved =
                        scope === 'personal' ||
                        settings.approvedLayers().project !== undefined;
                      if (!approved) {
                        form.notice = 'LOAD_AND_TRUST_PROJECT_FIRST';
                        update();
                        return;
                      }
                      const loaded = settings.loadedConfiguration(scope);
                      if (!loaded) {
                        form.notice = 'LOAD_SCOPE_FIRST';
                        update();
                        return;
                      }
                      form.busy = true;
                      form.durableBusy = true;
                      const storage = {
                        scope,
                        approved,
                        expectedIdentity: loaded.identity,
                        ...(scope === 'project'
                          ? { projectRoot: await $.session.root() }
                          : {}),
                        document: {
                          schemaVersion: 1 as const,
                          rules: active.rules,
                        },
                      };
                      const response = await runTransfer(
                        $,
                        {
                          protocolVersion: 2,
                          requestId: `export-${++runtime.sequence}`,
                          operation: 'export-config',
                          policyId: POLICY_ID,
                          storage,
                        },
                        runtime,
                      );
                      if (validOwner()) {
                        form.notice = response.ok
                          ? `Exported ${scope} transfer.json rule definitions only. Review before sharing.`
                          : response.code;
                        form.busy = false;
                        form.durableBusy = false;
                        update();
                      }
                    }}
                  >{`Export ${scope} transfer file`}</Button>
                ))}
              </Box>
            </Card>
          ) : null}
          {desktop ? null : <Text>{form.notice}</Text>}
          <Card title="Draft">
            <Text>
              {draft
                ? `Draft ${draft.token} · ${draft.stage} · base ${draft.baseRevision}`
                : 'No pending draft'}
            </Text>
            <Box {...row}>
              <Button
                key="validate"
                onPress={async () => {
                  if (
                    !validOwner() ||
                    !draft ||
                    draft.stage !== 'editing' ||
                    form.busy
                  )
                    return;
                  if (!state.requestedProtection) {
                    form.notice = 'TURN_ON_TO_VALIDATE';
                    update();
                    return;
                  }
                  form.busy = true;
                  const response = await runHelper(
                    $,
                    sessionOwner,
                    {
                      protocolVersion: 2,
                      requestId: `validate-${++runtime.sequence}`,
                      operation: 'validate-config',
                      policyId: POLICY_ID,
                      config: candidateConfiguration(
                        draft.document,
                        draft.token,
                      ),
                    },
                    undefined,
                    runtime,
                  );
                  if (validOwner()) {
                    const accepted = owner.validated(
                      draft.token,
                      response.status === 'ok' && response.validated === true,
                    );
                    form.notice = accepted
                      ? 'Core validation passed. Run synthetic preview.'
                      : response.status === 'ok'
                        ? 'STALE_DRAFT'
                        : response.errorCode;
                    form.busy = false;
                    update();
                    if (accepted)
                      await focusLocal($, {
                        requestId: 'redact-config',
                        key: 'preview',
                      });
                  }
                }}
              >
                Validate
              </Button>
              <Button
                key="preview"
                onPress={async () => {
                  if (
                    !validOwner() ||
                    !draft ||
                    draft.stage !== 'validated' ||
                    form.busy
                  )
                    return;
                  if (!state.requestedProtection) {
                    form.notice = 'TURN_ON_TO_PREVIEW';
                    update();
                    return;
                  }
                  form.busy = true;
                  const response = await runHelper(
                    $,
                    sessionOwner,
                    {
                      protocolVersion: 2,
                      requestId: `preview-${++runtime.sequence}`,
                      operation: 'preview',
                      policyId: POLICY_ID,
                      config: candidateConfiguration(
                        draft.document,
                        draft.token,
                      ),
                    },
                    undefined,
                    runtime,
                  );
                  if (validOwner()) {
                    const accepted = owner.previewed(
                      draft.token,
                      response.status === 'ok' &&
                        response.outcomes !== undefined,
                    );
                    form.notice =
                      accepted && response.status === 'ok'
                        ? `Synthetic sample outcomes: ${response.outcomes?.map((item) => `${item.id}: positive ${item.positive.action}, negative ${item.negative.action}`).join('; ') || 'empty rules, built-ins retained'}. Samples only, not an accuracy guarantee. Inspect nonmatches and built-in overlap before Apply. No real values scanned.`
                        : response.status === 'ok'
                          ? 'STALE_DRAFT'
                          : response.errorCode;
                    form.busy = false;
                    update();
                    if (accepted)
                      await focusLocal($, {
                        requestId: 'redact-config',
                        key: 'apply',
                      });
                  }
                }}
              >
                Synthetic preview
              </Button>
              <Button
                key="apply"
                {...primary}
                onPress={async () => {
                  if (!validOwner() || !draft || form.busy) return;
                  const result = owner.apply(draft.token);
                  form.notice = result.ok
                    ? 'Applied to session. New operations capture this revision. Existing operations retain their revision.'
                    : result.code;
                  form = freshFormWithNotice(form.notice);
                  const appliedForm = form;
                  form.busy = result.ok && state.requestedProtection;
                  if (result.ok && state.requestedProtection)
                    await checkReadiness(
                      $,
                      sessionOwner,
                      runtime,
                      result.config,
                    );
                  if (
                    owner !== config ||
                    sessionOwner !== state ||
                    form !== appliedForm ||
                    !paneOpen
                  )
                    return;
                  form.busy = false;
                  update();
                  if (result.ok)
                    await focusLocal($, {
                      requestId: 'redact-config',
                      key: result.config.rules.length
                        ? 'edit-remove'
                        : 'revert',
                    });
                }}
              >
                Apply session
              </Button>
              <Button
                key="reset"
                onPress={() => {
                  if (!validOwner()) return;
                  owner.begin({ schemaVersion: 1, rules: [] }, 'session');
                  form.notice =
                    'Reset draft removes additional rules, built-ins remain. Validate, preview, Apply.';
                  update();
                }}
              >
                Reset session rules
              </Button>
              {desktop ? (
                <Button key="cancel" onPress={close}>
                  Cancel / close
                </Button>
              ) : null}
            </Box>
          </Card>
        </Box>
      );
    },
  );

  on('prompt.submit', async ($, e, next) => {
    if (paneOpen && e.origin.kind === 'composer') {
      if (await localPaneListed($))
        return { drop: 'REDACTON_CLOSE_LOCAL_PANEL_BEFORE_PROMPT' };
      releaseLocalPane();
    }
    if (
      typeof e.text === 'string' &&
      /^\/(?:redact:(?:status|config|add-rule|remove-rule)|redactconfig)(?:\s|$)/.test(
        e.text,
      )
    )
      return { drop: 'REDACTON_LOCAL_COMMAND_UNAVAILABLE' };
    const controller = state;
    const owner = config;
    const generation = runtime.generation;
    const captured = snapshot(controller);
    if (captured.requestedProtection && runtime.recoveryPromise)
      return { drop: 'REDACTON_UNAVAILABLE' };
    if (captured.requestedProtection)
      await ensurePersonal($, controller, owner, settings, runtime);
    if (runtime.generation !== generation || controller !== state)
      return { drop: 'REDACTON_STALE_SESSION' };
    const capturedConfig = owner.snapshot();
    if (!captured.requestedProtection) return next(e);
    if (captured.readiness === 'loading')
      await checkReadiness($, controller, runtime, capturedConfig);
    if (captured.readiness !== 'ready' && controller.readiness !== 'ready')
      return { drop: 'REDACTON_UNAVAILABLE' };
    const extraction = extractPrompt(e);
    if (extraction.status !== 'ok') {
      record(controller, { errorCode: 'UNSUPPORTED_SHAPE', count: 0 });
      return { drop: 'REDACTON_UNSUPPORTED_SHAPE' };
    }
    const request = makeRequest(
      `prompt-${++runtime.sequence}`,
      extraction.segments,
      capturedConfig,
    );
    if (!request) {
      record(controller, { errorCode: 'INPUT_LIMIT', count: 0 });
      return { drop: 'REDACTON_INPUT_LIMIT' };
    }
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
  on('tool.call', { tool: ['Read', 'Bash'] }, async ($, e, next) => {
    const controller = state;
    const owner = config;
    const generation = runtime.generation;
    const captured = snapshot(controller);
    if (captured.requestedProtection && runtime.recoveryPromise)
      return { deny: 'REDACTON_UNAVAILABLE' };
    if (captured.requestedProtection)
      await ensurePersonal($, controller, owner, settings, runtime);
    if (runtime.generation !== generation || controller !== state)
      return { deny: 'REDACTON_STALE_SESSION' };
    const key = operationKey(e);
    if (key === null) return { deny: 'REDACTON_UNSUPPORTED_SHAPE' };
    if (slots.has(key)) return { deny: 'REDACTON_DUPLICATE_OPERATION' };
    if (captured.requestedProtection && slots.size >= LIMITS.pending)
      return { deny: 'REDACTON_QUEUE_SATURATED' };
    const slot: OperationSlot = {
      captured,
      config: owner.snapshot(),
      controller,
      trusted: null,
    };
    slots.set(key, slot);
    try {
      if (
        captured.requestedProtection &&
        captured.readiness !== 'ready' &&
        controller.readiness !== 'ready'
      )
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
      recent && recent.errorCode !== 'SCANNED'
        ? `Last operation withheld: ${recent.errorCode}`
        : recent && state.requestedProtection && state.readiness === 'ready'
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
