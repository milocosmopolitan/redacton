import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';

const types = JSON.parse(
  await readFile(
    new URL('../helper/src/canonical-types.json', import.meta.url),
    'utf8',
  ),
);
await writeFile(
  new URL('../mod/canonical-types.ts', import.meta.url),
  `// Generated from helper/src/canonical-types.json.
export const canonicalTypes = ${JSON.stringify(types)} as const;
`,
);
await rm(new URL('../helper/dist', import.meta.url), {
  recursive: true,
  force: true,
});
execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.helper.json'],
  { stdio: 'inherit' },
);
