export type Family =
  | 'github'
  | 'aws'
  | 'bearer'
  | 'connection'
  | 'private_key'
  | 'contextual'
  | 'obfuscation'
  | 'benign';
export type CredentialType =
  | 'github_token'
  | 'aws_access_key_id'
  | 'bearer_token'
  | 'connection_string_password'
  | 'private_key'
  | 'contextual_secret';
export interface Fixture {
  readonly id: string;
  readonly family: Family;
  readonly split: 'assessment' | 'heldout';
  readonly source: string;
  readonly text: string;
  readonly expectedTypes: readonly CredentialType[];
  readonly expectedText: string | null;
  readonly expectedStatus: 'ok' | 'blocked';
}
