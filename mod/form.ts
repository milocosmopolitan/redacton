import { validateConfigDocument } from '../helper/src/config.ts';
import {
  addRule,
  type ConfigDocument,
  type CustomRule,
  freezeDocument,
  replaceRule,
  setNamesAction,
  type TokenRule,
} from './config.ts';
export interface RuleForm {
  mode: 'config' | 'add' | 'remove' | 'project';
  kind: 'token' | 'names';
  id: string;
  prefix: string;
  names: string;
  action: 'redact' | 'block';
  alphabet: TokenRule['alphabet'];
  runKind: 'exact' | 'at-least';
  length: string;
  specificity: 'contextual' | 'entropy';
  validator: 'none' | 'trailing-lower-hex';
  notice: string;
  busy: boolean;
  durableBusy: boolean;
  editingId: string | null;
  namesGroupAction: boolean;
  resetScope: 'personal' | 'project' | null;
  tab: 'rules' | 'storage' | 'transfer';
  details: boolean;
}
export function freshForm(): RuleForm {
  return {
    mode: 'config',
    kind: 'token',
    id: '',
    prefix: '',
    names: '',
    action: 'redact',
    alphabet: 'alnum',
    runKind: 'exact',
    length: '16',
    specificity: 'contextual',
    validator: 'none',
    notice: '',
    busy: false,
    durableBusy: false,
    editingId: null,
    namesGroupAction: false,
    resetScope: null,
    tab: 'rules',
    details: false,
  };
}
export function formRule(form: RuleForm): CustomRule | null {
  const rule =
    form.kind === 'token'
      ? {
          kind: 'token',
          id: form.id,
          action: form.action,
          prefix: form.prefix,
          alphabet: form.alphabet,
          run: { kind: form.runKind, length: Number(form.length) },
          specificity: form.specificity,
          validator: form.validator,
        }
      : {
          kind: 'names',
          id: form.id,
          action: form.action,
          names: form.names.split(',').map((name) => name.trim()),
        };
  try {
    return (
      validateConfigDocument({ schemaVersion: 1, rules: [rule] }).rules[0] ??
      null
    );
  } catch {
    return null;
  }
}
export function candidateConfiguration(
  document: ConfigDocument,
  token: string,
): import('./config.ts').ActiveConfiguration {
  return Object.freeze({
    ...freezeDocument(document),
    revision: token,
    source: 'session',
    scope: 'session',
  });
}

export function populateForm(rule: CustomRule): RuleForm {
  const form = freshForm();
  form.mode = 'add';
  form.editingId = rule.id;
  form.kind = rule.kind;
  form.id = rule.id;
  form.action = rule.action;
  if (rule.kind === 'token') {
    form.prefix = rule.prefix;
    form.alphabet = rule.alphabet;
    form.runKind = rule.run.kind;
    form.length = String(rule.run.length);
    form.specificity = rule.specificity;
    form.validator = rule.validator;
  } else form.names = rule.names.join(', ');
  return form;
}
export function candidateDocument(
  active: ConfigDocument,
  form: RuleForm,
): ConfigDocument | null {
  const rule = formRule(form);
  if (!rule) return null;
  const document =
    form.editingId === null
      ? addRule(active, rule)
      : replaceRule(active, form.editingId, rule);
  if (!document) return null;
  try {
    return validateConfigDocument(
      rule.kind === 'names' && form.namesGroupAction
        ? setNamesAction(document, rule.action)
        : document,
    );
  } catch {
    return null;
  }
}
