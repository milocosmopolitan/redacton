import type {
  ActiveConfiguration,
  ConfigDocument,
  ConfigScope,
} from '../helper/src/config.ts';

export type {
  Action,
  ActiveConfiguration,
  ConfigDocument,
  ConfigScope,
  CustomRule,
  NamesRule,
  TokenRule,
} from '../helper/src/config.ts';

export type ConfigResult =
  | Readonly<{ ok: true; config: ActiveConfiguration }>
  | Readonly<{
      ok: false;
      code: 'STALE_REVISION' | 'INVALID_STAGE' | 'INVALID_CANDIDATE';
    }>;

// Defensive copies prevent a caller's form edits from changing in-flight policy.
export function freezeDocument(document: ConfigDocument): ConfigDocument {
  return Object.freeze({
    schemaVersion: 1,
    rules: Object.freeze(
      document.rules.map((rule) =>
        rule.kind === 'token'
          ? Object.freeze({
              kind: rule.kind,
              id: rule.id,
              action: rule.action,
              prefix: rule.prefix,
              alphabet: rule.alphabet,
              run: Object.freeze({
                kind: rule.run.kind,
                length: rule.run.length,
              }),
              specificity: rule.specificity,
              validator: rule.validator,
            })
          : Object.freeze({
              kind: rule.kind,
              id: rule.id,
              action: rule.action,
              names: Object.freeze([...rule.names]),
            }),
      ),
    ),
  });
}
export function effectiveConfiguration(layers: {
  personal?: ConfigDocument;
  project?: ConfigDocument;
  session?: ConfigDocument;
}): Readonly<{ document: ConfigDocument; source: ConfigScope }> {
  // Each approved layer replaces the entire custom-rule list, including an empty list.
  for (const source of ['session', 'project', 'personal'] as const) {
    const document = layers[source];
    if (document)
      return Object.freeze({ document: freezeDocument(document), source });
  }
  return Object.freeze({
    document: freezeDocument({ schemaVersion: 1, rules: [] }),
    source: 'defaults',
  });
}

export interface Draft {
  readonly token: string;
  readonly baseRevision: string;
  readonly scope: ConfigScope;
  readonly document: ConfigDocument;
  readonly stage: 'editing' | 'validated' | 'previewed';
}
let controllerSequence = 0;
export class ConfigController {
  private readonly identity = ++controllerSequence;
  private epoch = 0;
  private draftEpoch = 0;
  private active: ActiveConfiguration;
  private draft: Draft | undefined;
  private undo:
    | Readonly<{ expectedRevision: string; config: ActiveConfiguration }>
    | undefined;
  constructor(
    initial: ConfigDocument = { schemaVersion: 1, rules: [] },
    source: ConfigScope = 'defaults',
  ) {
    this.active = this.activate(initial, source);
  }
  private activate(
    document: ConfigDocument,
    source: ConfigScope,
  ): ActiveConfiguration {
    this.epoch += 1;
    return Object.freeze({
      ...freezeDocument(document),
      revision: `cfg-${this.identity}-${this.epoch}`,
      source,
      scope: source,
    });
  }
  snapshot(): ActiveConfiguration {
    return this.active;
  }
  begin(document: ConfigDocument, scope: ConfigScope = 'session'): Draft {
    this.draftEpoch += 1;
    this.draft = Object.freeze({
      token: `draft-${this.identity}-${this.draftEpoch}`,
      baseRevision: this.active.revision,
      scope,
      document: freezeDocument(document),
      stage: 'editing',
    });
    return this.draft;
  }
  currentDraft(): Draft | undefined {
    return this.draft;
  }
  // Only the registration adapter invokes these after matching helper replies.
  validated(token: string, valid: boolean): boolean {
    if (
      !this.draft ||
      this.draft.token !== token ||
      this.draft.stage !== 'editing' ||
      !valid
    )
      return false;
    this.draft = Object.freeze({ ...this.draft, stage: 'validated' });
    return true;
  }
  previewed(token: string, success: boolean): boolean {
    if (
      !this.draft ||
      this.draft.token !== token ||
      this.draft.stage !== 'validated' ||
      !success
    )
      return false;
    this.draft = Object.freeze({ ...this.draft, stage: 'previewed' });
    return true;
  }
  cancel(token: string): void {
    if (this.draft?.token === token) this.draft = undefined;
  }
  apply(token: string): ConfigResult {
    const draft = this.draft;
    if (!draft || draft.token !== token || draft.stage !== 'previewed')
      return Object.freeze({ ok: false, code: 'INVALID_STAGE' });
    if (draft.baseRevision !== this.active.revision)
      return Object.freeze({ ok: false, code: 'STALE_REVISION' });
    const previous = this.active;
    this.active = this.activate(draft.document, draft.scope);
    this.undo = Object.freeze({
      expectedRevision: this.active.revision,
      config: previous,
    });
    this.draft = undefined;
    return Object.freeze({ ok: true, config: this.active });
  }
  replaceApproved(
    document: ConfigDocument,
    scope: ConfigScope,
    expectedRevision: string,
  ): ConfigResult {
    if (this.active.revision !== expectedRevision)
      return Object.freeze({ ok: false, code: 'STALE_REVISION' });
    const previous = this.active;
    this.active = this.activate(document, scope);
    this.undo = Object.freeze({
      expectedRevision: this.active.revision,
      config: previous,
    });
    return Object.freeze({ ok: true, config: this.active });
  }
  revert(expectedRevision: string): ConfigResult {
    if (
      !this.undo ||
      this.active.revision !== expectedRevision ||
      this.undo.expectedRevision !== expectedRevision
    )
      return Object.freeze({ ok: false, code: 'STALE_REVISION' });
    this.active = this.activate(this.undo.config, this.undo.config.source);
    this.undo = undefined;
    this.draft = undefined;
    return Object.freeze({ ok: true, config: this.active });
  }
}

export function addRule(
  document: ConfigDocument,
  rule: import('../helper/src/config.ts').CustomRule,
): ConfigDocument | null {
  if (document.rules.some((existing) => existing.id === rule.id)) return null;
  return freezeDocument({ schemaVersion: 1, rules: [...document.rules, rule] });
}
export function removeRule(
  document: ConfigDocument,
  id: string,
): ConfigDocument | null {
  if (!document.rules.some((rule) => rule.id === id)) return null;
  return freezeDocument({
    schemaVersion: 1,
    rules: document.rules.filter((rule) => rule.id !== id),
  });
}

export function operationConfiguration(
  state: import('./state.ts').OperationSnapshot,
  config: ActiveConfiguration,
): Readonly<{
  protection: import('./state.ts').OperationSnapshot;
  config: ActiveConfiguration;
}> {
  return Object.freeze({ protection: Object.freeze({ ...state }), config });
}

export function replaceRule(
  document: ConfigDocument,
  originalId: string,
  edited: import('../helper/src/config.ts').CustomRule,
): ConfigDocument | null {
  if (
    document.rules.filter((rule) => rule.id === originalId).length !== 1 ||
    document.rules.some(
      (rule) => rule.id !== originalId && rule.id === edited.id,
    )
  )
    return null;
  return freezeDocument({
    schemaVersion: 1,
    rules: document.rules.map((rule) =>
      rule.id === originalId ? edited : rule,
    ),
  });
}

export function sharedNamesAction(
  document: ConfigDocument,
): import('../helper/src/config.ts').Action {
  return (
    document.rules.find((rule) => rule.kind === 'names')?.action ?? 'redact'
  );
}
export function setNamesAction(
  document: ConfigDocument,
  action: import('../helper/src/config.ts').Action,
): ConfigDocument {
  return freezeDocument({
    schemaVersion: 1,
    rules: document.rules.map((rule) =>
      rule.kind === 'names' ? { ...rule, action } : rule,
    ),
  });
}
