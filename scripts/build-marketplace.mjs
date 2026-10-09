import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Wraps the already-built artifact in a self-contained plugin marketplace.
// Run `npm run build` first; the plugin payload is the prebuilt artifact
// (bundled helper plus pinned engine), so no install-time scripts are needed.
const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const plugin = JSON.parse(
  await readFile(resolve('.claude-plugin/plugin.json'), 'utf8'),
);
if (plugin.version !== pkg.version)
  throw new Error('ARTIFACT_VERSION_MISMATCH');
const source = resolve('artifacts', `redacton-${pkg.version}`);
const root = resolve('artifacts', 'marketplace');
try {
  await readFile(join(source, 'PROVENANCE.json'));
} catch {
  throw new Error('ARTIFACT_MISSING: run npm run build first');
}
await rm(root, { recursive: true, force: true });
await mkdir(join(root, '.claude-plugin'), { recursive: true });
await cp(source, join(root, 'plugins', plugin.name), {
  recursive: true,
  dereference: false,
});
await writeFile(
  join(root, '.claude-plugin/marketplace.json'),
  `${JSON.stringify(
    {
      name: 'redacton',
      owner: { name: 'Redacton contributors' },
      metadata: {
        description:
          'Unqualified candidate marketplace. Host qualification is platform-specific; Desktop is unsupported.',
      },
      plugins: [
        {
          name: plugin.name,
          source: `./plugins/${plugin.name}`,
          description: plugin.description,
          version: plugin.version,
        },
      ],
    },
    null,
    2,
  )}\n`,
);
console.log(
  JSON.stringify({ marketplace: 'artifacts/marketplace', plugin: plugin.name }),
);
