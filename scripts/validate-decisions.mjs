import { readdir, readFile } from 'node:fs/promises';
for (const name of await readdir(new URL('../docs/decisions/', import.meta.url))) {
  if (!name.endsWith('.md')) continue;
  const body = await readFile(new URL(`../docs/decisions/${name}`, import.meta.url), 'utf8');
  if (!/^---\n[\s\S]*?^scope: workspace\n/m.test(body)) throw new Error('DECISION_SCOPE_REQUIRED');
}
console.log('Workspace decision scopes validated.');
