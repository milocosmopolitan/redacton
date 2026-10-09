import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { ConfigDocument } from './config.js';
import { validateConfigDocument } from './config.js';
import type { Engine } from './core.js';
import { compileConfiguration, validateLiteralSafety } from './rules.js';

export interface SavedSettings {
  readonly scope: 'personal' | 'project';
  readonly identity: string;
  readonly revision: string;
  readonly document: ConfigDocument;
}
const EMPTY: ConfigDocument = Object.freeze({
  schemaVersion: 1,
  rules: Object.freeze([]),
});
const MAX_BYTES = 65536;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function code(error: unknown): string | undefined {
  return record(error) && typeof error.code === 'string'
    ? error.code
    : undefined;
}
function fail(message: string): never {
  throw new Error(message);
}
type FileIdentity = Readonly<{ dev: bigint; ino: bigint }>;
export function sameFileIdentity(
  left: FileIdentity,
  right: FileIdentity,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (
    ![left.dev, right.dev, left.ino, right.ino].every(
      (value) =>
        typeof value === 'bigint' && value >= -(1n << 63n) && value < 1n << 63n,
    )
  )
    return false;
  // Older Windows libuv returns 64-bit path serials and 32-bit handle serials.
  // Node exposes both IDs through signed BigInt64Array, including negative IDs.
  // Match corrected Windows device width, retaining the exact signed file ID.
  const device = (value: bigint) =>
    platform === 'win32' ? value & 0xffffffffn : value;
  return left.ino === right.ino && device(left.dev) === device(right.dev);
}

export async function pathSnapshotMatches(
  path: string,
  snapshot: BigIntStats,
  original: BigIntStats,
  maxBytes = MAX_BYTES,
  allowLinks = false,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const regular = (value: BigIntStats) =>
    value.isFile() &&
    !value.isSymbolicLink() &&
    (allowLinks || value.nlink === 1n) &&
    value.size <= BigInt(maxBytes);
  if (!regular(snapshot) || !regular(original)) return false;
  if (platform !== 'win32' || snapshot.dev !== 0n)
    return sameFileIdentity(snapshot, original, platform);
  // Windows path stats can omit the volume ID. Never treat zero as a wildcard:
  // independently reopen the path and compare two descriptor volume/file IDs.
  if (
    snapshot.ino !== original.ino ||
    !sameFileIdentity(snapshot, snapshot, platform) ||
    !sameFileIdentity(original, original, platform)
  )
    return false;
  const second = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const secondStat = await second.stat({ bigint: true });
    if (
      !regular(secondStat) ||
      !sameFileIdentity(secondStat, original, platform)
    )
      return false;
    const checked = await lstat(path, { bigint: true });
    return regular(checked) && sameFileIdentity(checked, snapshot, platform);
  } finally {
    await second.close();
  }
}

type LeaseOwner = Readonly<{
  version: 2;
  pid: number;
  nonce: string;
  host: string;
  start: string;
}>;
const execute = promisify(execFile);
let selfStart: Promise<string | null> | undefined;

// These are ownership metadata, never input/rule fingerprints or diagnostics.
async function hostIdentity(): Promise<string> {
  let namespace = `${process.platform}:${hostname()}`;
  if (process.platform === 'linux') {
    namespace += `:${await readFile('/proc/sys/kernel/random/boot_id', 'utf8')}:${await readlink('/proc/self/ns/pid')}`;
  }
  return createHash('sha256').update(namespace).digest('hex');
}
export function procfsProcessStart(
  value: string,
  expectedPid: number,
): string | null {
  const opening = value.indexOf(' (');
  const closing = value.lastIndexOf(') ');
  if (
    !Number.isSafeInteger(expectedPid) ||
    expectedPid < 1 ||
    opening < 1 ||
    closing <= opening ||
    value.slice(0, opening) !== String(expectedPid)
  )
    return null;
  // comm can contain spaces and parentheses; fields begin after its final close.
  const start = value.slice(closing + 2).split(' ')[19];
  return start && /^[0-9]+$/.test(start) ? start : null;
}
async function processStart(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      const self = await readFile('/proc/self/stat', 'utf8');
      const selfIdentity = procfsProcessStart(self, process.pid);
      // A host-mounted procfs can expose another PID numbering scheme. Never
      // treat unrelated process metadata as evidence that a live owner died.
      if (selfIdentity === null) return null;
      if (pid === process.pid) return selfIdentity;
      return procfsProcessStart(
        await readFile(`/proc/${pid}/stat`, 'utf8'),
        pid,
      );
    } catch {
      return null;
    }
  }
  try {
    const result =
      process.platform === 'darwin'
        ? await execute('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
            timeout: 500,
            maxBuffer: 1024,
            env: { LC_ALL: 'C', TZ: 'UTC' },
          })
        : process.platform === 'win32' && process.env.SystemRoot
          ? await execute(
              join(
                process.env.SystemRoot,
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe',
              ),
              [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
              ],
              {
                timeout: 1000,
                maxBuffer: 1024,
                windowsHide: true,
                env: { SystemRoot: process.env.SystemRoot },
              },
            )
          : null;
    const start = result?.stdout.trim();
    return start && start.length <= 128 ? start : null;
  } catch {
    return null;
  }
}

// State and rule bodies are written only here, never to logs, arguments or model context.
export class SettingsStore {
  constructor(
    private readonly namespace = process.env.REDACTON_SETTINGS_ROOT ??
      join(homedir(), '.config', 'redacton'),
  ) {}
  private async directory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== 'win32' &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      fail('SETTINGS_UNAVAILABLE');
  }
  private async readBounded(
    path: string,
    maxBytes = MAX_BYTES,
    allowLinks = false,
  ): Promise<string> {
    const before = await lstat(path, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (!allowLinks && before.nlink !== 1n) ||
      before.size > BigInt(maxBytes)
    )
      fail('SETTINGS_CORRUPT');
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat({ bigint: true });
      if (
        !stat.isFile() ||
        (!allowLinks && stat.nlink !== 1n) ||
        stat.size > BigInt(maxBytes) ||
        !(await pathSnapshotMatches(path, before, stat, maxBytes, allowLinks))
      )
        fail('SETTINGS_CORRUPT');
      const openedPath = await lstat(path, { bigint: true });
      if (
        !openedPath.isFile() ||
        openedPath.isSymbolicLink() ||
        !(await pathSnapshotMatches(
          path,
          openedPath,
          stat,
          maxBytes,
          allowLinks,
        ))
      )
        fail('SETTINGS_CORRUPT');
      const bytes = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          size,
          bytes.length - size,
          null,
        );
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      const after = await lstat(path, { bigint: true });
      if (
        size > maxBytes ||
        !after.isFile() ||
        after.isSymbolicLink() ||
        !(await pathSnapshotMatches(path, after, stat, maxBytes, allowLinks))
      )
        fail('SETTINGS_CORRUPT');
      return new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(0, size),
      );
    } finally {
      await handle.close();
    }
  }
  private async syncDirectory(path: string): Promise<void> {
    // Windows can reject directory handles. File bytes were synced before rename;
    // without directory fsync, power-loss durability of the rename is not promised.
    try {
      const directory = await open(path, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (
        process.platform === 'win32' &&
        ['EISDIR', 'EPERM'].includes(code(error) ?? '')
      )
        return;
      throw error;
    }
  }
  private async identity(
    scope: 'personal' | 'project',
    root: string,
  ): Promise<string> {
    if (!isAbsolute(this.namespace)) fail('SETTINGS_UNAVAILABLE');
    await this.directory(this.namespace);
    const path = join(this.namespace, '.identity');
    let seed: string;
    try {
      seed = await this.readBounded(path, 64, true);
    } catch (error) {
      if (code(error) !== 'ENOENT') throw error;
      const temporary = join(this.namespace, `.identity-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(randomBytes(32).toString('hex'));
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await link(temporary, path);
        } catch (error) {
          if (code(error) !== 'EEXIST') throw error;
        }
      } finally {
        await unlink(temporary).catch(() => {});
      }
      seed = await this.readBounded(path, 64, true);
    }
    if (!/^[0-9a-f]{64}$/.test(seed)) fail('SETTINGS_CORRUPT');
    // This identifies a scope location, never a rule body or scanned input.
    return createHmac('sha256', seed).update(`${scope}:${root}`).digest('hex');
  }
  private async location(
    scope: 'personal' | 'project',
    projectRoot?: string,
  ): Promise<{ directory: string; identity: string }> {
    const root = scope === 'personal' ? this.namespace : projectRoot;
    if (typeof root !== 'string' || !isAbsolute(root)) fail('INVALID_REQUEST');
    if (scope === 'personal') await this.directory(root);
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) fail('SETTINGS_UNAVAILABLE');
    return {
      directory:
        scope === 'personal' ? canonical : join(canonical, '.redacton'),
      identity: await this.identity(scope, canonical),
    };
  }
  private validateCore(
    document: ConfigDocument,
    engine: Engine,
    canonical: readonly string[],
  ): void {
    validateLiteralSafety(document, engine);
    const compiled = compileConfiguration(document, canonical);
    try {
      const result = engine.scanAndRedact('', {
        policy: compiled.policy,
        ...(compiled.validationRuleset
          ? { ruleset: compiled.validationRuleset }
          : {}),
        limits: { maxInputBytes: 262144, maxFindings: 1000 },
      });
      if (
        !record(result) ||
        result.text !== '' ||
        !Array.isArray(result.findings) ||
        result.findings.length !== 0
      )
        fail('INVALID_CONFIG');
    } catch {
      fail('INVALID_CONFIG');
    }
  }

  private async read(
    scope: 'personal' | 'project',
    location: { directory: string; identity: string },
    engine: Engine,
    canonical: readonly string[],
  ): Promise<SavedSettings> {
    try {
      const parent = await lstat(location.directory);
      if (!parent.isDirectory() || parent.isSymbolicLink())
        fail('SETTINGS_CORRUPT');
      const value: unknown = JSON.parse(
        await this.readBounded(join(location.directory, 'settings.json')),
      );
      if (
        !fields(value, ['schemaVersion', 'identity', 'revision', 'document']) ||
        value.schemaVersion !== 1 ||
        value.identity !== location.identity ||
        typeof value.revision !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(value.revision)
      )
        fail('SETTINGS_CORRUPT');
      const document = validateConfigDocument(value.document);
      this.validateCore(document, engine, canonical);
      return Object.freeze({
        scope,
        identity: location.identity,
        revision: value.revision,
        document,
      });
    } catch (error) {
      if (code(error) === 'ENOENT')
        return Object.freeze({
          scope,
          identity: location.identity,
          revision: 'absent',
          document: EMPTY,
        });
      fail('SETTINGS_CORRUPT');
    }
  }
  async load(
    scope: 'personal' | 'project',
    projectRoot: string | undefined,
    engine: Engine,
    canonical: readonly string[],
  ): Promise<SavedSettings> {
    return this.read(
      scope,
      await this.location(scope, projectRoot),
      engine,
      canonical,
    );
  }
  async import(
    scope: 'personal' | 'project',
    projectRoot: string | undefined,
    engine: Engine,
    canonical: readonly string[],
  ) {
    const location = await this.location(scope, projectRoot);
    const parent = await lstat(location.directory);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      fail('SETTINGS_CORRUPT');
    try {
      const value: unknown = JSON.parse(
        await this.readBounded(join(location.directory, 'transfer.json')),
      );
      const document = validateConfigDocument(value);
      this.validateCore(document, engine, canonical);
      return Object.freeze({ scope, identity: location.identity, document });
    } catch {
      fail('INVALID_CONFIG');
    }
  }
  async export(
    scope: 'personal' | 'project',
    projectRoot: string | undefined,
    approved: boolean,
    document: ConfigDocument,
    engine: Engine,
    canonical: readonly string[],
    expectedIdentity: string,
  ) {
    if (scope === 'project' && !approved) fail('PROJECT_TRUST_REQUIRED');
    const normalized = validateConfigDocument(document);
    this.validateCore(normalized, engine, canonical);
    const location = await this.location(scope, projectRoot);
    if (location.identity !== expectedIdentity) fail('SETTINGS_CONFLICT');
    await this.directory(location.directory);
    const target = join(location.directory, 'transfer.json');
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        fail('SETTINGS_CORRUPT');
    } catch (error) {
      if (code(error) !== 'ENOENT') throw error;
    }
    const bytes = JSON.stringify(normalized);
    if (Buffer.byteLength(bytes) > MAX_BYTES) fail('INVALID_CONFIG');
    const temporary = join(location.directory, `.transfer-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      await this.syncDirectory(location.directory);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return Object.freeze({
      scope,
      identity: location.identity,
      document: normalized,
    });
  }

  private owner(value: unknown): LeaseOwner {
    if (
      !fields(value, ['version', 'pid', 'nonce', 'host', 'start']) ||
      value.version !== 2 ||
      typeof value.pid !== 'number' ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      typeof value.nonce !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(value.nonce) ||
      typeof value.host !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.host) ||
      typeof value.start !== 'string' ||
      !value.start ||
      value.start.length > 128
    )
      fail('SETTINGS_BUSY');
    return value as unknown as LeaseOwner;
  }
  private async leaseOwner(path: string): Promise<LeaseOwner> {
    try {
      return this.owner(JSON.parse(await this.readBounded(path, 1024, true)));
    } catch {
      fail('SETTINGS_BUSY');
    }
  }
  private async ownLease(nonce: string): Promise<LeaseOwner> {
    selfStart ??= processStart(process.pid);
    const start = await selfStart;
    if (!start) fail('SETTINGS_UNAVAILABLE');
    return {
      version: 2,
      pid: process.pid,
      nonce,
      host: await hostIdentity(),
      start,
    };
  }
  private async abandoned(owner: LeaseOwner): Promise<boolean> {
    if (owner.host !== (await hostIdentity())) return false;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      // EPERM and unavailable identity are indeterminate, never proof of death.
      return code(error) === 'ESRCH';
    }
    const start = await processStart(owner.pid);
    return start !== null && start !== owner.start;
  }
  private sameOwner(left: LeaseOwner, right: LeaseOwner): boolean {
    return (
      left.pid === right.pid &&
      left.nonce === right.nonce &&
      left.host === right.host &&
      left.start === right.start
    );
  }
  private async acquirePath(lock: string, depth = 0): Promise<LeaseOwner> {
    if (depth > 4) fail('SETTINGS_BUSY');
    const owner = await this.ownLease(randomUUID());
    const candidate = `${lock}.${owner.nonce}.tmp`;
    try {
      const handle = await open(candidate, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner));
        await handle.sync();
      } finally {
        await handle.close();
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await link(candidate, lock);
          return owner;
        } catch (error) {
          if (code(error) !== 'EEXIST') throw error;
        }
        const old = await this.leaseOwner(lock);
        if (!(await this.abandoned(old))) fail('SETTINGS_BUSY');
        // A crashed claimant is itself a recoverable lease. Bound recursion so
        // adversarial debris cannot create unbounded work or unsafe deletion.
        const recovery = join(dirname(lock), `.recover-${old.nonce}`);
        const claim = await this.acquirePath(recovery, depth + 1);
        try {
          const current = await this.leaseOwner(lock);
          if (!this.sameOwner(current, old) || !(await this.abandoned(current)))
            fail('SETTINGS_BUSY');
          await unlink(lock);
        } finally {
          await this.releasePath(recovery, claim);
        }
      }
      fail('SETTINGS_BUSY');
    } finally {
      await unlink(candidate).catch(() => {});
    }
  }
  private async releasePath(lock: string, owner: LeaseOwner): Promise<void> {
    try {
      if (this.sameOwner(await this.leaseOwner(lock), owner))
        await unlink(lock);
    } catch {
      /* An unrelated or unreadable lease stays closed. */
    }
  }

  async save(
    scope: 'personal' | 'project',
    projectRoot: string | undefined,
    approved: boolean,
    expected: Pick<SavedSettings, 'identity' | 'revision' | 'document'>,
    document: ConfigDocument,
    engine: Engine,
    canonical: readonly string[],
  ): Promise<SavedSettings> {
    if (scope === 'project' && !approved) fail('PROJECT_TRUST_REQUIRED');
    const normalized = validateConfigDocument(document);
    this.validateCore(normalized, engine, canonical);
    const location = await this.location(scope, projectRoot);
    if (location.identity !== expected.identity) fail('SETTINGS_CONFLICT');
    await this.directory(location.directory);
    let lease: LeaseOwner | undefined;
    let temporary: string | undefined;
    try {
      lease = await this.acquirePath(
        join(location.directory, '.settings.lock'),
      );
      const current = await this.read(scope, location, engine, canonical);
      if (
        current.revision !== expected.revision ||
        JSON.stringify(current.document) !== JSON.stringify(expected.document)
      )
        fail('SETTINGS_CONFLICT');
      const settings: SavedSettings = Object.freeze({
        scope,
        identity: location.identity,
        revision: randomUUID(),
        document: normalized,
      });
      const value = {
        schemaVersion: 1,
        identity: settings.identity,
        revision: settings.revision,
        document: settings.document,
      };
      const bytes = JSON.stringify(value);
      if (Buffer.byteLength(bytes) > MAX_BYTES) fail('INVALID_CONFIG');
      temporary = join(location.directory, `.settings-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(location.directory, 'settings.json'));
      temporary = undefined;
      await this.syncDirectory(location.directory);
      return settings;
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
      if (lease)
        await this.releasePath(
          join(location.directory, '.settings.lock'),
          lease,
        );
    }
  }
}

export async function storageOperation(
  value: Record<string, unknown>,
  engine: Engine,
  canonical: readonly string[],
  engineVersion: string,
  policyId: string,
) {
  const requestId =
    typeof value.requestId === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(value.requestId)
      ? value.requestId
      : null;
  const base = { protocolVersion: 2, requestId, engineVersion, policyId };
  try {
    if (
      requestId === null ||
      !fields(value, [
        'protocolVersion',
        'requestId',
        'operation',
        'policyId',
        'storage',
      ]) ||
      value.policyId !== policyId
    )
      fail('INVALID_REQUEST');
    const storage = value.storage;
    if (
      !record(storage) ||
      (storage.scope !== 'personal' && storage.scope !== 'project') ||
      typeof storage.approved !== 'boolean'
    )
      fail('INVALID_REQUEST');
    const saving =
      value.operation === 'save-config' || value.operation === 'reset-config';
    const names = [
      'scope',
      'approved',
      ...(storage.scope === 'project' ? ['projectRoot'] : []),
      ...(saving
        ? ['expectedIdentity', 'expectedRevision', 'expectedDocument']
        : []),
      ...(value.operation === 'export-config' ? ['expectedIdentity'] : []),
      ...(value.operation === 'save-config' ||
      value.operation === 'export-config'
        ? ['document']
        : []),
    ];
    if (
      !fields(storage, names) ||
      (storage.scope === 'project' && typeof storage.projectRoot !== 'string')
    )
      fail('INVALID_REQUEST');
    if (engine.VERSION !== engineVersion) fail('ENGINE_VERSION');
    await engine.initialize();
    const artifact = engine.artifact();
    if (artifact !== 'addon' && artifact !== 'wasm') fail('ENGINE_UNAVAILABLE');
    const store = new SettingsStore();
    if (value.operation === 'import-config')
      return {
        ...base,
        status: 'ok',
        artifact,
        transfer: await store.import(
          storage.scope,
          typeof storage.projectRoot === 'string'
            ? storage.projectRoot
            : undefined,
          engine,
          canonical,
        ),
      };
    if (value.operation === 'export-config') {
      if (
        typeof storage.expectedIdentity !== 'string' ||
        !/^[0-9a-f]{64}$/.test(storage.expectedIdentity)
      )
        fail('INVALID_REQUEST');
      return {
        ...base,
        status: 'ok',
        artifact,
        transfer: await store.export(
          storage.scope,
          typeof storage.projectRoot === 'string'
            ? storage.projectRoot
            : undefined,
          storage.approved,
          validateConfigDocument(storage.document),
          engine,
          canonical,
          storage.expectedIdentity,
        ),
      };
    }
    let settings: SavedSettings;
    if (!saving)
      settings = await store.load(
        storage.scope,
        typeof storage.projectRoot === 'string'
          ? storage.projectRoot
          : undefined,
        engine,
        canonical,
      );
    else {
      if (
        typeof storage.expectedIdentity !== 'string' ||
        !/^[0-9a-f]{64}$/.test(storage.expectedIdentity) ||
        typeof storage.expectedRevision !== 'string' ||
        (storage.expectedRevision !== 'absent' &&
          !/^[0-9a-f-]{36}$/.test(storage.expectedRevision))
      )
        fail('INVALID_REQUEST');
      const expected = {
        identity: storage.expectedIdentity,
        revision: storage.expectedRevision,
        document: validateConfigDocument(storage.expectedDocument),
      };
      settings = await store.save(
        storage.scope,
        typeof storage.projectRoot === 'string'
          ? storage.projectRoot
          : undefined,
        storage.approved,
        expected,
        value.operation === 'reset-config'
          ? EMPTY
          : validateConfigDocument(storage.document),
        engine,
        canonical,
      );
    }
    return { ...base, status: 'ok', artifact, settings };
  } catch (error) {
    const allowed = [
      'INVALID_REQUEST',
      'INVALID_CONFIG',
      'NAMES_ACTION_CONFLICT',
      'ENGINE_VERSION',
      'ENGINE_UNAVAILABLE',
      'PROJECT_TRUST_REQUIRED',
      'SETTINGS_CONFLICT',
      'SETTINGS_BUSY',
      'SETTINGS_CORRUPT',
    ];
    const errorCode =
      error instanceof Error && allowed.includes(error.message)
        ? error.message
        : 'SETTINGS_UNAVAILABLE';
    return { ...base, status: 'failed', errorCode };
  }
}
