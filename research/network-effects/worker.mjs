import { performance } from 'node:perf_hooks';

/** Runs one durable job. No application or voice service participates in this path. */
export async function runJob(store, extract, options = {}) {
  const job = store.claim(options);
  if (!job) return null;
  const started = performance.now();
  try {
    const result = await extract(job.source, store.contextFor(job.source));
    const items = store.complete(job, result, performance.now() - started);
    return { id: job.id, status: 'completed', items };
  } catch (error) {
    if (['stale_job_lease', 'stale_source_version'].includes(error.code)) return { id: job.id, status: 'obsolete' };
    try { return { id: job.id, status: store.failure(job, error, options) }; }
    catch (commitError) {
      if (['stale_job_lease', 'stale_source_version'].includes(commitError.code)) return { id: job.id, status: 'obsolete' };
      throw commitError;
    }
  }
}

export async function drainJobs(store, extract, { maxJobs = 100, ...options } = {}) {
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 10000) throw new Error('invalid_job_limit');
  const results = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const result = await runJob(store, extract, options);
    if (!result) break;
    results.push(result);
  }
  return results;
}
