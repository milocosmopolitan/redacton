export type Action = 'redact' | 'block';
export type ConfigScope = 'defaults' | 'personal' | 'project' | 'session';
export interface TokenRule {
  readonly kind: 'token';
  readonly id: string;
  readonly action: Action;
  readonly prefix: string;
  readonly alphabet:
    | 'alnum'
    | 'alnum-dash'
    | 'alnum-dash-dot'
    | 'upper-alnum'
    | 'digit'
    | 'lower-hex'
    | 'base64-body';
  readonly run: Readonly<{ kind: 'exact' | 'at-least'; length: number }>;
  readonly specificity: 'contextual' | 'entropy';
  readonly validator: 'none' | 'trailing-lower-hex';
}
export interface NamesRule {
  readonly kind: 'names';
  readonly id: string;
  readonly action: Action;
  readonly names: readonly string[];
}
export type CustomRule = TokenRule | NamesRule;
export interface ConfigDocument {
  readonly schemaVersion: 1;
  readonly rules: readonly CustomRule[];
}
export interface ActiveConfiguration extends ConfigDocument {
  readonly revision: string;
  readonly source: ConfigScope;
  readonly scope: ConfigScope;
}

const ALPHABETS = new Set([
  'alnum',
  'alnum-dash',
  'alnum-dash-dot',
  'upper-alnum',
  'digit',
  'lower-hex',
  'base64-body',
]);
const RULE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
function array(input: unknown): input is unknown[] {
  return Array.isArray(input);
}
function fields(
  input: unknown,
  names: readonly string[],
): input is Record<string, unknown> {
  return (
    record(input) &&
    Object.keys(input).length === names.length &&
    names.every((name) => Object.hasOwn(input, name))
  );
}
function invalid(): never {
  throw new Error('INVALID_CONFIG');
}
function action(input: unknown): Action {
  return input === 'redact' || input === 'block' ? input : invalid();
}

// The core parser remains authoritative for reserved detector IDs and normalization.
export function validateConfigDocument(input: unknown): ConfigDocument {
  if (
    !fields(input, ['schemaVersion', 'rules']) ||
    input.schemaVersion !== 1 ||
    !array(input.rules) ||
    input.rules.length > 64
  )
    invalid();
  const rules: CustomRule[] = [];
  const ids = new Set<string>();
  let namesCount = 0;
  let namesAction: Action | undefined;
  for (const raw of input.rules) {
    if (
      !record(raw) ||
      typeof raw.id !== 'string' ||
      raw.id.length > 64 ||
      !RULE_ID.test(raw.id) ||
      ids.has(raw.id)
    )
      invalid();
    ids.add(raw.id);
    const selectedAction = action(raw.action);
    if (raw.kind === 'token') {
      if (
        !fields(raw, [
          'kind',
          'id',
          'action',
          'prefix',
          'alphabet',
          'run',
          'specificity',
          'validator',
        ]) ||
        typeof raw.prefix !== 'string' ||
        /["\\\r\n\p{Cc}\p{Cf}]/u.test(raw.prefix)
      )
        invalid();
      const bytes = new TextEncoder().encode(raw.prefix).length;
      if (
        bytes < 3 ||
        bytes > 64 ||
        typeof raw.alphabet !== 'string' ||
        !ALPHABETS.has(raw.alphabet) ||
        !fields(raw.run, ['kind', 'length']) ||
        (raw.run.kind !== 'exact' && raw.run.kind !== 'at-least') ||
        typeof raw.run.length !== 'number' ||
        !Number.isSafeInteger(raw.run.length) ||
        raw.run.length < 1 ||
        raw.run.length > 4096 ||
        (raw.specificity !== 'contextual' && raw.specificity !== 'entropy') ||
        (raw.validator !== 'none' && raw.validator !== 'trailing-lower-hex')
      )
        invalid();
      const alphabet = raw.alphabet;
      if (
        alphabet !== 'alnum' &&
        alphabet !== 'alnum-dash' &&
        alphabet !== 'alnum-dash-dot' &&
        alphabet !== 'upper-alnum' &&
        alphabet !== 'digit' &&
        alphabet !== 'lower-hex' &&
        alphabet !== 'base64-body'
      )
        invalid();
      rules.push(
        Object.freeze({
          kind: 'token',
          id: raw.id,
          action: selectedAction,
          prefix: raw.prefix,
          alphabet,
          run: Object.freeze({ kind: raw.run.kind, length: raw.run.length }),
          specificity: raw.specificity,
          validator: raw.validator,
        }),
      );
    } else if (raw.kind === 'names') {
      if (
        !fields(raw, ['kind', 'id', 'action', 'names']) ||
        !array(raw.names) ||
        raw.names.length === 0
      )
        invalid();
      if (namesAction !== undefined && namesAction !== selectedAction)
        throw new Error('NAMES_ACTION_CONFLICT');
      namesAction = selectedAction;
      const names: string[] = [];
      for (const name of raw.names) {
        if (typeof name !== 'string' || name.length > 64 || !NAME.test(name))
          invalid();
        names.push(name);
      }
      namesCount += names.length;
      if (namesCount > 32) invalid();
      rules.push(
        Object.freeze({
          kind: 'names',
          id: raw.id,
          action: selectedAction,
          names: Object.freeze(names),
        }),
      );
    } else invalid();
  }
  return Object.freeze({ schemaVersion: 1, rules: Object.freeze(rules) });
}
