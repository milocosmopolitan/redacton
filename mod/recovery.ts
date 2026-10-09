// Only fixed protocol/local codes receive operation-local treatment.
export function failureScope(
  operation: string,
  code: string,
): 'operation' | 'scanner' {
  if (
    operation === 'sanitize' &&
    new Set([
      'INPUT_LIMIT',
      'OUTPUT_LIMIT',
      'FINDING_LIMIT',
      'PRIVATE_KEY_BLOCKED',
      'RULE_BLOCKED',
      'CANCELLED',
      'QUEUE_SATURATED',
      'UNSUPPORTED_SHAPE',
    ]).has(code)
  )
    return 'operation';
  return 'scanner';
}

export function settingsRemediation(code: string): string {
  if (
    new Set([
      'SETTINGS_CORRUPT',
      'INVALID_CONFIG',
      'NAMES_ACTION_CONFLICT',
    ]).has(code)
  )
    return 'Saved settings require local repair: restore a valid approved personal settings file, or explicitly remove that scope file to reset its custom rules, then run /redacton. Active rules are unchanged until recovery succeeds.';
  return code
    ? `Settings: ${code}. Remove the local fault, then run /redacton for one recovery attempt.`
    : 'Run /redacton for one scanner self-check recovery attempt.';
}
