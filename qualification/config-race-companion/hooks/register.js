// The pinned SDK process hook returns { value: ProcessResult }; no output is retained.
export function helperOutcome(answer, request, elapsedMs, rejected = false) {
  const value = answer?.value;
  const result = { outcome: 'PROCESS_SHAPE_INVALID', exitCode: null, elapsedBucket: elapsedMs < 250 ? 0 : elapsedMs < 1000 ? 1 : elapsedMs < 2000 ? 2 : elapsedMs < 5000 ? 3 : 4, stdoutTruncated: value?.isStdoutTruncated === true, stderrTruncated: value?.isStderrTruncated === true, stderrPresent: typeof value?.stderr === 'string' && value.stderr.length > 0, identityMatched: false };
  if (rejected) { result.outcome = 'PROCESS_REJECTED'; return result; }
  if (answer?.deny) { result.outcome = 'PROCESS_DENIED'; return result; }
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'exitCode,isStderrTruncated,isStdoutTruncated,stderr,stdout' || !Number.isInteger(value.exitCode) || value.exitCode < -2147483648 || value.exitCode > 2147483647 || typeof value.stdout !== 'string' || typeof value.stderr !== 'string' || typeof value.isStdoutTruncated !== 'boolean' || typeof value.isStderrTruncated !== 'boolean') return result;
  result.exitCode = value.exitCode;
  if (value.exitCode !== 0) result.outcome = 'PROCESS_EXIT_NONZERO';
  else if (result.stdoutTruncated) result.outcome = 'STDOUT_TRUNCATED';
  else if (result.stderrTruncated) result.outcome = 'STDERR_TRUNCATED';
  else if (result.stderrPresent) result.outcome = 'STDERR_PRESENT';
  else {
    if (value.stdout.length > 1048576) return result;
    let reply;
    try { reply = JSON.parse(value.stdout); } catch { result.outcome = 'INVALID_JSON'; return result; }
    result.identityMatched = [1, 2].includes(request?.protocolVersion) && typeof request?.requestId === 'string' && typeof request?.policyId === 'string' && typeof request?.config?.revision === 'string' && reply?.protocolVersion === request.protocolVersion && reply?.requestId === request.requestId && reply?.policyId === request.policyId && reply?.engineVersion === '0.1.0-beta.14' && reply?.configRevision === request.config.revision;
    result.outcome = reply?.status === 'failed' && reply?.errorCode === 'TIMEOUT' ? 'DECLARED_TIMEOUT' : reply?.status === 'failed' && reply?.errorCode === 'ENGINE_UNAVAILABLE' ? 'DECLARED_ENGINE_UNAVAILABLE' : !result.identityMatched ? 'IDENTITY_MISMATCH' : reply.status === 'ok' ? 'DECLARED_OK' : reply.status === 'blocked' ? 'DECLARED_BLOCKED' : reply.status === 'failed' ? 'DECLARED_FAILED' : 'STATUS_UNKNOWN';
  }
  return result;
}

export function register(on) {
  const observations = [];
  const helperOutcomes = [];
  let reports = 0;
  let stdoutSanitizes = 0;
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'config-race-report', description: 'Fixed synthetic captured configuration metadata' });
    return next(e);
  });
  on('process.run', async (_$, e, next) => {
    let measuredRequest;
    let measuredIndex = -1;
    try {
      const request = JSON.parse(e.init?.stdin ?? '{}');
      if (request.operation === 'sanitize' && request.segments.some(segment => segment.id === 'stdout')) {
        stdoutSanitizes = Math.min(3, stdoutSanitizes + 1);
        if (helperOutcomes.length < 2) {
          measuredIndex = helperOutcomes.length;
          measuredRequest = request;
          helperOutcomes.push(null);
        }
        const config = request.config;
        if (observations.length < 2 && /^cfg-[0-9]{1,6}-[0-9]{1,6}$/.test(config.revision) && Array.isArray(config.rules) && config.rules.length <= 1) {
          const rule = config.rules[0];
          const exactRule = !rule || (rule.kind === 'token' && rule.id === 'config-race-token' && rule.prefix === 'syntheticcred_' && rule.alphabet === 'alnum' && rule.run.kind === 'exact' && rule.run.length === 16 && rule.action === 'redact');
          observations.push({ revision: config.revision, rules: config.rules.length, exactRule });
        }
      }
    } catch {}
    const started = Date.now();
    let answer;
    try { answer = await next(e); }
    catch (error) {
      if (measuredIndex !== -1) helperOutcomes[measuredIndex] = helperOutcome(null, measuredRequest, Date.now() - started, true);
      throw error;
    }
    if (measuredIndex !== -1) helperOutcomes[measuredIndex] = helperOutcome(answer, measuredRequest, Date.now() - started);
    return answer;
  });
  on('command.run', { command: 'config-race-report' }, () => ({
    text: `${helperOutcomes.map((value, index) => value ? `CONFIG_HELPER_${index + 1}_${value.outcome}_${value.exitCode ?? 'N'}_${value.elapsedBucket}_${Number(value.stdoutTruncated)}_${Number(value.stderrTruncated)}_${Number(value.stderrPresent)}_${Number(value.identityMatched)}` : '').join('\n')}\nCONFIG_RACE_REPORT_${++reports}_${stdoutSanitizes}_${observations.length}_${observations.map(value => `${value.revision}_${value.rules}_${value.exactRule ? 1 : 0}`).join('_')}`,
  }));
}
