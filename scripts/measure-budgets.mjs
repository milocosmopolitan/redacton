import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./build-helper.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const { LIMITS, POLICY_ID } = await import('../helper/dist/core.js');
const samples = 10;
const token = 'ghp_SYNTHETICREVOKED00000000000000000000';
const text = `Synthetic ordinary data\n${token}\n`;
const config = {
  schemaVersion: 1,
  rules: [],
  revision: 'budget-1',
  source: 'defaults',
  scope: 'defaults',
};
const request = (input) => ({
  protocolVersion: 2,
  requestId: 'budget-1',
  operation: 'sanitize',
  policyId: POLICY_ID,
  config,
  segments: [{ id: 's0', text: input }],
});
const namespace = await mkdtemp(join(tmpdir(), 'redacton-budget-'));
const round = (value) => Number(value.toFixed(3));
function summary(values, attempts = values.length) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    attempts,
    failures: attempts - values.length,
    p50Ms: sorted.length
      ? round(sorted[Math.ceil(sorted.length * 0.5) - 1])
      : null,
    p95Ms: sorted.length
      ? round(sorted[Math.ceil(sorted.length * 0.95) - 1])
      : null,
    maxMs: sorted.length ? round(sorted.at(-1)) : null,
  };
}
function run(argv, input, timeoutMs = LIMITS.timeoutMs, environment = {}) {
  const start = performance.now();
  const result = spawnSync(process.execPath, argv, {
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: LIMITS.outputBytes,
    env: { ...process.env, ...environment, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    /* Fixed failure below. */
  }
  return {
    ok:
      result.status === 0 &&
      !result.stderr &&
      !result.error &&
      value !== undefined,
    elapsedMs: performance.now() - start,
    value,
  };
}
// This fixture reports numeric timings and fixed booleans only. Input is stdin.
const worker = `import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
let body='';for await(const chunk of process.stdin)body+=chunk;const request=JSON.parse(body);
const timings={};let start=performance.now();
const engine=await import('@redact-secret/core');timings.moduleImportMs=performance.now()-start;
start=performance.now();await engine.initialize();timings.engineInitializationMs=performance.now()-start;
start=performance.now();const core=await import('./helper/core.js');const {SettingsStore}=await import('./helper/storage.js');timings.helperModuleImportMs=performance.now()-start;
start=performance.now();const first=await core.processRequest(request,engine);timings.firstScanMs=performance.now()-start;
start=performance.now();const warm=await core.processRequest(request,engine);timings.warmScanMs=performance.now()-start;
const store=new SettingsStore(join(import.meta.dirname,'settings'));
start=performance.now();const loaded=await store.load('personal',undefined,engine,core.CANONICAL_TYPES);timings.settingsLoadMs=performance.now()-start;
start=performance.now();const saved=await store.save('personal',undefined,true,loaded,{schemaVersion:1,rules:[]},engine,core.CANONICAL_TYPES);timings.settingsSaveMs=performance.now()-start;
const lock=join(import.meta.dirname,'settings','.settings.lock');
await writeFile(lock,JSON.stringify(await store.ownLease('11111111-1111-4111-8111-111111111111')));
start=performance.now();let busy=false;
try{await store.save('personal',undefined,true,saved,{schemaVersion:1,rules:[]},engine,core.CANONICAL_TYPES)}catch(error){busy=error.message==='SETTINGS_BUSY'}
timings.liveLockRefusalMs=performance.now()-start;await rm(lock);
console.log(JSON.stringify({timings,artifact:engine.artifact(),valid:first.status==='ok'&&warm.status==='ok'&&busy&&!first.segments[0].text.includes('ghp_SYNTHETICREVOKED00000000000000000000')}));`;
let load;
try {
  const packages = {};
  const available = run([
    '--input-type=module',
    '-e',
    "const engine=await import('@redact-secret/core');await engine.initialize();console.log(JSON.stringify(engine.artifact()))",
  ]);
  if (!available.ok || !['addon', 'wasm'].includes(available.value))
    throw new Error('BUDGET_ENGINE_UNAVAILABLE');
  const unavailableArtifacts = available.value === 'addon' ? [] : ['addon'];
  for (const artifact of available.value === 'addon'
    ? ['addon', 'wasm']
    : ['wasm']) {
    const directory = join(namespace, artifact);
    await mkdir(directory);
    await cp(join(root, 'helper/dist'), join(directory, 'helper'), {
      recursive: true,
    });
    if (artifact === 'addon')
      await symlink(
        join(root, 'node_modules'),
        join(directory, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    else {
      await mkdir(join(directory, 'node_modules/@redact-secret'), {
        recursive: true,
      });
      for (const name of ['core', 'wasm'])
        await cp(
          join(root, 'node_modules/@redact-secret', name),
          join(directory, 'node_modules/@redact-secret', name),
          { recursive: true },
        );
    }
    await writeFile(join(directory, 'measure.mjs'), worker);
    packages[artifact] = directory;
  }
  if (process.argv.includes('--cpu-load')) {
    // One finite competing process, not a daemon or a claimed VM/container quota.
    load = spawn(
      process.execPath,
      [
        '-e',
        'const end=Date.now()+30000;while(Date.now()<end){Math.sqrt(Math.random())}',
      ],
      {
        stdio: 'ignore',
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      },
    );
  }
  const baseline = [];
  for (let index = 0; index < samples; index++) {
    const result = run(['-e', 'console.log("true")']);
    if (result.ok) baseline.push(result.elapsedMs);
  }
  const artifacts = {};
  for (const [artifact, directory] of Object.entries(packages)) {
    const componentRuns = [],
      eventRuns = [],
      maxEventRuns = [],
      settingsLoadRuns = [],
      settingsSaveRuns = [];
    const maxText = `${token}\n${'a'.repeat(LIMITS.inputBytes - token.length - 1)}`;
    for (let index = 0; index < samples; index++) {
      const components = run(
        [join(directory, 'measure.mjs')],
        JSON.stringify(request(text)),
        10000,
      );
      componentRuns.push(
        components.ok &&
          components.value.valid &&
          components.value.artifact === artifact
          ? components.value.timings
          : null,
      );
      const settingsEnv = {
        REDACTON_SETTINGS_ROOT: join(directory, 'event-settings'),
      };
      const settingsRequest = {
        protocolVersion: 2,
        requestId: 'budget-settings',
        operation: 'load-config',
        policyId: POLICY_ID,
        storage: { scope: 'personal', approved: true },
      };
      const loaded = run(
        [join(directory, 'helper/index.js')],
        JSON.stringify(settingsRequest),
        LIMITS.timeoutMs,
        settingsEnv,
      );
      const loadValid =
        loaded.ok &&
        loaded.value.status === 'ok' &&
        loaded.value.artifact === artifact &&
        loaded.value.settings;
      settingsLoadRuns.push(loadValid ? loaded.elapsedMs : null);
      if (loadValid) {
        const saved = run(
          [join(directory, 'helper/index.js')],
          JSON.stringify({
            ...settingsRequest,
            operation: 'save-config',
            storage: {
              scope: 'personal',
              approved: true,
              expectedIdentity: loaded.value.settings.identity,
              expectedRevision: loaded.value.settings.revision,
              expectedDocument: loaded.value.settings.document,
              document: { schemaVersion: 1, rules: [] },
            },
          }),
          LIMITS.timeoutMs,
          settingsEnv,
        );
        settingsSaveRuns.push(
          saved.ok &&
            saved.value.status === 'ok' &&
            saved.value.artifact === artifact
            ? saved.elapsedMs
            : null,
        );
      } else settingsSaveRuns.push(null);
      const event = run(
        [join(directory, 'helper/index.js')],
        JSON.stringify(request(text)),
      );
      const valid =
        event.ok &&
        event.value.status === 'ok' &&
        event.value.artifact === artifact &&
        !event.value.segments[0].text.includes(token);
      eventRuns.push(valid ? event.elapsedMs : null);
      const maximum = run(
        [join(directory, 'helper/index.js')],
        JSON.stringify(request(maxText)),
      );
      const maxValid =
        maximum.ok &&
        maximum.value.status === 'ok' &&
        maximum.value.artifact === artifact &&
        !maximum.value.segments[0].text.includes(token);
      maxEventRuns.push(maxValid ? maximum.elapsedMs : null);
    }
    const metrics = [
      'moduleImportMs',
      'engineInitializationMs',
      'helperModuleImportMs',
      'firstScanMs',
      'warmScanMs',
      'settingsLoadMs',
      'settingsSaveMs',
      'liveLockRefusalMs',
    ];
    artifacts[artifact] = {
      components: Object.fromEntries(
        metrics.map((metric) => [
          metric,
          summary(
            componentRuns.filter(Boolean).map((row) => row[metric]),
            samples,
          ),
        ]),
      ),
      firstFreshProcessEventMs:
        eventRuns[0] === null ? null : round(eventRuns[0]),
      freshProcessEvents: summary(
        eventRuns.filter((value) => value !== null),
        samples,
      ),
      subsequentWarmFilesystemEvents: summary(
        eventRuns.slice(1).filter((value) => value !== null),
        samples - 1,
      ),
      firstComponentSample: componentRuns[0]
        ? Object.fromEntries(
            Object.entries(componentRuns[0]).map(([key, value]) => [
              key,
              round(value),
            ]),
          )
        : null,
      settingsLoadEvents: summary(
        settingsLoadRuns.filter((value) => value !== null),
        samples,
      ),
      settingsSaveEvents: summary(
        settingsSaveRuns.filter((value) => value !== null),
        samples,
      ),
      maximumInputEvents: summary(
        maxEventRuns.filter((value) => value !== null),
        samples,
      ),
    };
  }
  const helperSha256 = {};
  for (const name of ['index.js', 'core.js', 'storage.js'])
    helperSha256[name] = createHash('sha256')
      .update(await readFile(join(root, 'helper/dist', name)))
      .digest('hex');
  const report = {
    schemaVersion: 2,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    engineVersion: '0.1.0-beta.14',
    helperSha256,
    sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim(),
    unavailableArtifacts,
    samples,
    inputBytes: Buffer.byteLength(text),
    maxInputBytes: LIMITS.inputBytes,
    limits: { timeoutMs: LIMITS.timeoutMs, pending: 4 },
    load: load ? 'one finite competing CPU process' : 'sequential local idle',
    methodology:
      '10 fresh processes per artifact and operation; nearest-rank p50/p95 over successful attempts, failures retained separately. First sample is cold-process only, never claimed cold disk cache. Component worker separately times import, initialization, scan, settings and live-lock refusal; values cannot be subtracted from unrelated event samples. No process startup injection or original input in argv/env.',
    processStartupBaseline: summary(baseline, samples),
    artifacts,
    scope:
      'Direct Node helper and component fixtures; excludes Claude SDK dispatch, UI/model delivery, cancellation, VM/CPU quotas and unmeasured platforms. Lock contention refuses immediately rather than waiting. Native and forced WASM package copies removed in finally.',
  };
  const output = resolve(
    process.env.REDACTON_BUDGET_REPORT ??
      join(root, 'qualification/results/budgets.json'),
  );
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  const failed =
    baseline.length !== samples ||
    Object.values(artifacts).some(
      (row) =>
        row.freshProcessEvents.failures ||
        row.maximumInputEvents.failures ||
        row.settingsLoadEvents.failures ||
        row.settingsSaveEvents.failures ||
        Object.values(row.components).some((metric) => metric.failures),
    );
  console.log(
    JSON.stringify({
      status: failed ? 'failed' : 'passed',
      node: report.node,
      platform: report.platform,
      load: report.load,
      processStartupBaseline: report.processStartupBaseline,
      artifacts,
    }),
  );
  if (failed) process.exitCode = 1;
} catch {
  console.log(
    JSON.stringify({
      status: 'failed',
      errorCode: 'BUDGET_FIXTURE_UNAVAILABLE',
    }),
  );
  process.exitCode = 1;
} finally {
  if (load) {
    load.kill('SIGTERM');
    await new Promise((resolveExit) => load.once('close', resolveExit));
  }
  await rm(namespace, { recursive: true, force: true });
}
