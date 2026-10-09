import { hasOnlyDataKeys, isPlainRecord } from './validation.ts';

// Only the host-attested local user gesture authorizes reducing protection.
// Slash text and plugin-provided claims are never provenance.
export function isExplicitLocalUser(origin: unknown): boolean {
  return (
    isPlainRecord(origin) &&
    hasOnlyDataKeys(origin, ['kind']) &&
    origin.kind === 'composer'
  );
}
