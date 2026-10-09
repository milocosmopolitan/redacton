import type { CredentialType, Family, Fixture } from './fixtures.ts';

// Freeze labels before execution. All credential-shaped values are generated synthetic fixtures.
const github = 'ghp_SYNTHETICREVOKED00000000000000000000';
const aws = 'AKIASYNTHETIC0000000';
if (aws.length !== 20) throw new Error('INVALID_SYNTHETIC_AWS_LENGTH');
const bearer = 'SyntheticRevokedToken7x9Q2m4N6p8R0s2T';
const password = 'SyntheticRevokedPass7Q9x2M4n';
const pem =
  '-----BEGIN PRIVATE KEY-----\nU1lOVEhFVElDX1JFVk9LRURfRklYVFVSRQ==\n-----END PRIVATE KEY-----';
const rows: Fixture[] = [];
const positive = (
  id: string,
  family: Family,
  text: string,
  expectedText: string | null,
  type: CredentialType,
  source = 'original',
): number =>
  rows.push({
    id,
    family,
    split: 'assessment',
    source,
    text,
    expectedTypes: [type],
    expectedText,
    expectedStatus: type === 'private_key' ? 'blocked' : 'ok',
  });
const negative = (
  id: string,
  family: Family,
  text: string,
  source = 'original',
): number =>
  rows.push({
    id,
    family,
    split: 'assessment',
    source,
    text,
    expectedTypes: [],
    expectedText: text,
    expectedStatus: 'ok',
  });
positive(
  'github-prompt',
  'github',
  `Please inspect ${github} without using it.`,
  'Please inspect <SECRET_1> without using it.',
  'github_token',
);
positive(
  'github-unicode',
  'github',
  `앞🙂 ${github} 뒤`,
  '앞🙂 <SECRET_1> 뒤',
  'github_token',
);
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell reference is a negative fixture.
negative('github-placeholder', 'github', 'GITHUB_TOKEN=${GITHUB_TOKEN}');
positive(
  'aws-stdout',
  'aws',
  `AccessKeyId=${aws}`,
  'AccessKeyId=<SECRET_1>',
  'aws_access_key_id',
  'aws-cli-shape',
);
positive(
  'aws-json',
  'aws',
  `{"AccessKeyId":"${aws}"}`,
  '{"AccessKeyId":"<SECRET_1>"}',
  'aws_access_key_id',
  'aws-cli-shape',
);
negative(
  'aws-placeholder',
  'aws',
  'AccessKeyId=<AWS_ACCESS_KEY_ID>',
  'aws-cli-shape',
);
positive(
  'bearer-header',
  'bearer',
  `Authorization: Bearer ${bearer}`,
  'Authorization: Bearer <SECRET_1>',
  'bearer_token',
  'rfc6750-shape',
);
positive(
  'bearer-crlf',
  'bearer',
  `GET /check HTTP/1.1\r\nAuthorization: Bearer ${bearer}\r\n`,
  'GET /check HTTP/1.1\r\nAuthorization: Bearer <SECRET_1>\r\n',
  'bearer_token',
  'rfc6750-shape',
);
negative(
  'bearer-reference',
  'bearer',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell reference is a negative fixture.
  'Authorization: Bearer ${ACCESS_TOKEN}',
  'rfc6750-shape',
);
positive(
  'database-uri',
  'connection',
  `postgresql://demo:${password}@localhost:5432/test`,
  'postgresql://demo:<SECRET_1>@localhost:5432/test',
  'connection_string_password',
  'rfc3986-shape',
);
positive(
  'database-quoted',
  'connection',
  `DATABASE_URL="postgresql://demo:${password}@localhost/test"`,
  'DATABASE_URL="postgresql://demo:<SECRET_1>@localhost/test"',
  'connection_string_password',
  'rfc3986-shape',
);
negative(
  'database-no-password',
  'connection',
  'postgresql://localhost:5432/test',
  'rfc3986-shape',
);
positive('pem-file', 'private_key', pem, null, 'private_key');
positive(
  'pem-stdout',
  'private_key',
  `output\n${pem}\ncomplete`,
  null,
  'private_key',
);
negative(
  'pem-documentation',
  'private_key',
  'A PRIVATE KEY header alone is not a complete PEM block.',
);
positive(
  'contextual-env',
  'contextual',
  `API_SECRET=${password}`,
  'API_SECRET=<SECRET_1>',
  'contextual_secret',
);
positive(
  'contextual-json',
  'contextual',
  `{"password":"${password}"}`,
  '{"password":"<SECRET_1>"}',
  'contextual_secret',
);
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell reference is a negative fixture.
negative('contextual-reference', 'contextual', 'API_SECRET=${API_SECRET}');
// These intentionally demand recognition across encoding/obfuscation; misses stay in the report.
positive(
  'github-zero-width',
  'obfuscation',
  `${github.slice(0, 8)}\u200b${github.slice(8)}`,
  '<SECRET_1>',
  'github_token',
);
positive(
  'github-base64',
  'obfuscation',
  Buffer.from(github).toString('base64'),
  '<SECRET_1>',
  'github_token',
);
negative(
  'benign-uuid',
  'benign',
  'request_id=00000000-1111-4222-8333-444444444444',
);
// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell reference is a negative fixture.
negative('benign-shell', 'benign', 'printf "%s" "${CONFIG_VALUE}"');
negative('benign-unicode', 'benign', '문서 🙂 café, ordinary harmless text.');
export default Object.freeze(rows.map((row) => Object.freeze(row)));
