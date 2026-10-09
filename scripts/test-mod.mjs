import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = new URL('../', import.meta.url)
const destination = await mkdtemp(join(tmpdir(), 'redacton-mod-tests-'))
try {
  for (const name of ['.claude-plugin/plugin.json', 'hooks', 'mod']) {
    await cp(new URL(name, root), join(destination, name), { recursive: true })
  }
  await mkdir(join(destination, 'tests'))
  const { readdir } = await import('node:fs/promises')
  for (const name of await readdir(new URL('tests/', root))) {
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) await cp(new URL(`tests/${name}`, root), join(destination, 'tests', name))
  }
  const command = process.argv.includes('--validate') ? ['validate', '--strict', destination] : ['test', destination]
  const result = spawnSync('rtk', ['proxy', 'claude', 'plugin', ...command], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally { await rm(destination, { recursive: true, force: true }) }
