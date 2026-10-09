import type { DetectedSecretFinding, SecretPolicy } from '@redact-secret/core';
import type { ConfigDocument, CustomRule } from './config.js';
import type { Engine } from './core.js';

export interface CompiledConfiguration {
  readonly ruleset: string | undefined;
  readonly validationRuleset: string | undefined;
  readonly policy: SecretPolicy;
  readonly types: ReadonlySet<string>;
}
export function compileConfiguration(
  document: ConfigDocument,
  canonical: readonly string[],
): CompiledConfiguration {
  const types = new Set(canonical);
  const actions = new Map<string, 'redact' | 'block'>();
  let namesAction: 'redact' | 'block' = 'redact';
  const lines = ['ruleset-revision: 1'];
  const identities: string[] = [];
  for (const rule of document.rules) {
    if (types.has(rule.id)) throw new Error('INVALID_CONFIG');
    if (rule.kind === 'token') {
      types.add(rule.id);
      actions.set(rule.id, rule.action);
      lines.push(
        `detector: ${rule.id}`,
        `specificity: ${rule.specificity}`,
        `prefix: "${rule.prefix}"`,
        `alphabet: ${rule.alphabet}`,
        `run: ${rule.run.kind} ${rule.run.length}`,
        `validator: ${rule.validator}`,
      );
    } else {
      identities.push(
        `detector: ${rule.id}\nspecificity: entropy\nprefix: "REDACTON_CHECK_"\nalphabet: digit\nrun: exact 1\nvalidator: none`,
      );
      namesAction = rule.action;
      lines.push(
        'names: ambiguous',
        ...rule.names.map((name) => `name: ${name}`),
      );
    }
  }
  const ruleset = document.rules.length ? `${lines.join('\n')}\n` : undefined;
  if (ruleset && new TextEncoder().encode(ruleset).length > 65536)
    throw new Error('INVALID_CONFIG');
  const policy: SecretPolicy = Object.freeze({
    evaluate: (finding: DetectedSecretFinding) => {
      if (finding.type === 'private_key') return 'block';
      if (finding.detector === 'generic-token-ruleset-names')
        return namesAction;
      return actions.get(finding.type) ?? 'redact';
    },
  });
  const validationRuleset =
    ruleset && identities.length
      ? `${ruleset}${identities.join('\n')}\n`
      : ruleset;
  return Object.freeze({ ruleset, validationRuleset, policy, types });
}

// Examples stay inside the helper; responses project actions and types, never patterns or text.
export function syntheticExamples(rule: CustomRule): readonly [string, string] {
  if (rule.kind === 'names')
    return [
      `${rule.names[0]}=SyntheticPass7x9Q2m4N6p8R0s2T`,
      'ordinary harmless text',
    ];
  const characters =
    rule.validator === 'trailing-lower-hex' ||
    rule.alphabet === 'digit' ||
    rule.alphabet === 'upper-alnum'
      ? '1234567890'
      : rule.alphabet === 'lower-hex'
        ? 'abcdef1234567890'
        : 'SyntheticRevoked123456789';
  const run = characters.repeat(
    Math.ceil((rule.run.length + 1) / characters.length),
  );
  const positive = `${rule.prefix}${run.slice(0, rule.run.length)}`;
  const negativeLength =
    rule.run.kind === 'exact' ? rule.run.length + 1 : rule.run.length - 1;
  return [positive, `${rule.prefix}${run.slice(0, negativeLength)}`];
}

// Baseline detectors reject recognized secret values in declarative literal fields.
export function validateLiteralSafety(
  document: ConfigDocument,
  engine: Engine,
): void {
  for (const rule of document.rules) {
    const literals =
      rule.kind === 'token' ? [rule.id, rule.prefix] : [rule.id, ...rule.names];
    for (const literal of literals) {
      const result = engine.scanAndRedact(literal, {
        policy: { evaluate: () => 'redact' },
        limits: { maxInputBytes: 262144, maxFindings: 1000 },
      });
      if (
        result === null ||
        typeof result !== 'object' ||
        !('findings' in result) ||
        !Array.isArray(result.findings) ||
        result.findings.length !== 0 ||
        !('text' in result) ||
        result.text !== literal
      )
        throw new Error('INVALID_CONFIG');
    }
  }
}
