import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateSource,validateExtraction,topicLabels,validLanguage } from '../../research/network-effects/contracts.mjs';
import { validateVerificationAudit,verificationContextHash,supportedVerificationVersions } from '../../research/network-effects/verification-contracts.mjs';
import { digest,itemId,episodeId,evidenceTime,fail,iso,presentJob,projectEpisodes } from './projection.mjs';

const schema='origen_network_effects';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actorHash=actor=>digest(typeof actor==='string'&&actor?actor:'system');
const diagnosticCodes=['provider_timeout','provider_failed','provider_refused','provider_incomplete','provider_cancelled','invalid_extraction',
  'unsupported_demo_source','budget_exhausted','network_budget_exhausted','network_request_already_reserved','network_pricing_bound_exceeded',
  'invalid_verification','invalid_verification_issue','invalid_verification_step','invalid_verification_decision',
  'verification_audit_conflict','verification_required','verification_context_changed','verification_candidate_mismatch',
  'verification_needs_review','verification_failed'];

/** Explicit migration only. Never called from application startup or voice code. */
export async function migrateNetworkEffects(pool) {
  const sql=await readFile(new URL('../../research/network-effects/postgres/001_foundation.sql',import.meta.url),'utf8');
  const c=await pool.connect();
  try {await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('origen-network-effects-migration',0))");await c.query(sql);await c.query('COMMIT');}
  catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

export function createNetworkEffectsRepository(pool,{clock=()=>Date.now()}={}) {
  if(!pool?.query||!pool?.connect)throw new Error('network_repository_pool_required');
  const now=()=>new Date(clock()).toISOString();
  async function tx(fn) {
    const c=await pool.connect();
    try {await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
    catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }
  const scopeLock=(c,scope)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`network-scope:${JSON.stringify([scope.accountId,scope.studentId])}`]);
  const sourceLock=(c,id)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`network-source:${id}`]);
  async function source(id,c=pool) {return (await c.query(`SELECT body FROM ${schema}.sources WHERE id=$1`,[id])).rows[0]?.body||null;}
  async function scopedState(c,scope=null) {
    const args=scope?[scope.accountId,scope.studentId]:[];
    const sourceWhere=scope?' WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2':'';
    const sourceIds=`SELECT id FROM ${schema}.sources${sourceWhere}`;
    const itemWhere=scope?` WHERE source_id IN (${sourceIds})`:'';
    const episodeIds=`SELECT DISTINCT episode_id FROM ${schema}.items${itemWhere}`;
    const sources=(await c.query(`SELECT body FROM ${schema}.sources${sourceWhere} ORDER BY id`,args)).rows.map(row=>row.body);
    const processingGaps=(await c.query(`SELECT * FROM ${schema}.processing_gaps${sourceWhere} ORDER BY source_id`,args)).rows
      .map(row=>({id:row.source_id,version:row.source_version,accountId:row.account_id,studentId:row.student_id,reporter:row.reporter,recordedAt:row.recorded_at}));
    const items=(await c.query(`SELECT body,episode_id FROM ${schema}.items${itemWhere} ORDER BY sequence`,args)).rows.map(row=>({...row.body,episodeId:row.episode_id}));
    const supersessions=(await c.query(`SELECT target_id,correction_id FROM ${schema}.supersessions${scope?` WHERE target_id IN (SELECT id FROM ${schema}.items${itemWhere})`:''}`,args)).rows;
    const invalidations=(await c.query(`SELECT * FROM ${schema}.invalidations${scope?` WHERE episode_id IN (${episodeIds})`:''}`,args)).rows;
    const reviews=(await c.query(`SELECT * FROM ${schema}.reviews${scope?` WHERE episode_id IN (${episodeIds})`:''} ORDER BY sequence`,args)).rows.map(row=>({id:row.id,episodeId:row.episode_id,revision:row.revision,decision:row.decision,note:row.note,recordedAt:iso(row.recorded_at)}));
    const jobs=(await c.query(`SELECT * FROM ${schema}.jobs${itemWhere} ORDER BY sequence`,args)).rows.map(presentJob);
    const episodes=projectEpisodes({sources,items,supersessions,invalidations,reviews,jobs,processingGaps});
    return {sources,episodes,reviews,sourceHistory:(await c.query(`SELECT body FROM ${schema}.source_versions${itemWhere} ORDER BY source_id,version`,args)).rows.map(row=>row.body),
      jobs};
  }
  async function rebuild(c,scope) {
    const snapshot=await scopedState(c,scope);
    await c.query(`DELETE FROM ${schema}.episodes WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2`,[scope.accountId,scope.studentId]);
    for(const episode of snapshot.episodes)await c.query(`INSERT INTO ${schema}.episodes
      (id,account_id,student_id,episode_key,topic,review_state,languages,pending,body,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[episode.id,episode.accountId,episode.studentId,episode.episodeKey,episode.topic,episode.reviewState,
      [...new Set(episode.items.map(item=>item.language))],episode.outcomeState==='pending'||['open','partial'].includes(episode.questionState),JSON.stringify(episode),now()]);
    return snapshot;
  }
  async function retainInvalidation(c,id,item) {
    await c.query(`INSERT INTO ${schema}.invalidations(source_id,episode_id,kind,source_version,reported_by,evidence_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_id,episode_id,kind,reported_by) DO UPDATE SET
      source_version=GREATEST(${schema}.invalidations.source_version,EXCLUDED.source_version),
      evidence_at=CASE WHEN ${schema}.invalidations.evidence_at IS NULL THEN NULL ELSE GREATEST(${schema}.invalidations.evidence_at,EXCLUDED.evidence_at) END`,
      [item.sourceId,id,item.kind,item.sourceVersion,item.reportedBy,evidenceTime(item)]);
  }
  async function invalidateSource(c,id) {
    for(const row of (await c.query(`SELECT episode_id,body FROM ${schema}.items WHERE source_id=$1`,[id])).rows)await retainInvalidation(c,row.episode_id,row.body);
  }
  async function ingest(raw,extractorVersion='network-effects-extraction-v1') {
    const input=validateSource(raw);
    if(typeof extractorVersion!=='string'||!/^[a-zA-Z0-9._-]{1,80}$/.test(extractorVersion))fail('invalid_extractor_version');
    return tx(async c=>{
      await scopeLock(c,input);await sourceLock(c,input.id);
      if((await c.query(`SELECT id FROM ${schema}.tombstones WHERE id=$1`,[input.id])).rows.length)fail('source_deleted',409);
      const old=await source(input.id,c);
      if(old&&(old.accountId!==input.accountId||old.studentId!==input.studentId||old.reporter!==input.reporter||old.kind!==input.kind))fail('source_scope_changed',409);
      if(old&&input.version<old.version)fail('stale_source_version',409);
      if(old&&input.version===old.version&&digest(input)!==digest(old))fail('source_version_conflict',409);
      const prior=(await c.query(`SELECT * FROM ${schema}.jobs WHERE source_id=$1 AND source_version=$2 AND extractor_version=$3`,[input.id,input.version,extractorVersion])).rows[0];
      if(prior)return presentJob(prior);
      if(old&&input.version>old.version)await invalidateSource(c,input.id);
      await c.query(`INSERT INTO ${schema}.sources(id,version,account_id,student_id,body,fingerprint) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,body=EXCLUDED.body,fingerprint=EXCLUDED.fingerprint`,[input.id,input.version,input.accountId,input.studentId,JSON.stringify(input),digest(input)]);
      await c.query(`INSERT INTO ${schema}.source_versions(source_id,version,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[input.id,input.version,JSON.stringify(input)]);
      await c.query(`UPDATE ${schema}.jobs SET status='obsolete',lease_token=NULL,lease_until=NULL WHERE source_id=$1 AND status IN ('queued','running','failed')`,[input.id]);
      const row=(await c.query(`INSERT INTO ${schema}.jobs(id,source_id,source_version,extractor_version,status,available_at,created_at)
        VALUES($1,$2,$3,$4,'queued',$5,$5) RETURNING *`,[randomUUID(),input.id,input.version,extractorVersion,now()])).rows[0];
      await rebuild(c,input);return presentJob(row);
    });
  }
  async function claim({leaseMs=60000,maxAttempts=3,jobId=null}={}) {
    if(!Number.isSafeInteger(leaseMs)||leaseMs<100||leaseMs>600000||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||jobId!==null&&!uuid.test(jobId))fail('invalid_claim');
    return tx(async c=>{
      // SKIP LOCKED also bounds recovery work when another worker is committing.
      await c.query(`UPDATE ${schema}.jobs SET status=CASE WHEN attempts >= $1 THEN 'failed' ELSE 'queued' END,
        error='lease_expired',lease_token=NULL,lease_until=NULL WHERE id IN
        (SELECT id FROM ${schema}.jobs WHERE status='running' AND lease_until <= $2 FOR UPDATE SKIP LOCKED)`,[maxAttempts,now()]);
      await c.query(`UPDATE ${schema}.jobs SET status='failed',error=COALESCE(error,'attempt_limit') WHERE id IN
        (SELECT id FROM ${schema}.jobs WHERE status='queued' AND attempts >= $1 FOR UPDATE SKIP LOCKED)`,[maxAttempts]);
      const row=(await c.query(`SELECT * FROM ${schema}.jobs WHERE status='queued' AND available_at <= $1 AND ($2::uuid IS NULL OR id=$2)
        ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 1`,[now(),jobId])).rows[0];
      if(!row)return null;
      const token=randomUUID();
      const updated=(await c.query(`UPDATE ${schema}.jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=$3 WHERE id=$1 RETURNING *`,[row.id,token,new Date(clock()+leaseMs).toISOString()])).rows[0];
      return {...presentJob(updated),token,source:await source(row.source_id,c)};
    });
  }
  async function leaseScope(c,job) {
    if(!job||!uuid.test(job.id)||!uuid.test(job.token))fail('stale_job_lease',409);
    const row=(await c.query(`SELECT source_id FROM ${schema}.jobs WHERE id=$1`,[job.id])).rows[0];
    const input=row&&await source(row.source_id,c);
    if(!input)fail('stale_job_lease',409);
    await scopeLock(c,input);await sourceLock(c,input.id);
    return input;
  }
  async function currentLease(c,job) {
    const row=(await c.query(`SELECT * FROM ${schema}.jobs WHERE id=$1 FOR UPDATE`,[job.id])).rows[0];
    if(!row||row.status!=='running'||row.lease_token!==job.token||new Date(row.lease_until).getTime()<=clock())fail('stale_job_lease',409);
    const input=await source(row.source_id,c);
    if(!input||input.version!==row.source_version)fail('stale_source_version',409);
    return {input,row};
  }
  async function contextFor(input,c=pool) {
    if(!input||typeof input.accountId!=='string'||(input.studentId!==null&&typeof input.studentId!=='string'))fail('invalid_context_scope');
    const episodes=(await c.query(`SELECT body FROM ${schema}.episodes WHERE account_id=$1 AND student_id IS NOT DISTINCT FROM $2 ORDER BY id`,[input.accountId,input.studentId])).rows.map(row=>row.body);
    return {episodes,existingItems:episodes.flatMap(episode=>episode.items.filter(item=>item.state==='current'))};
  }
  const presentVerification=row=>({attempt:row.attempt,recordedAt:iso(row.recorded_at),updatedAt:iso(row.updated_at),audit:row.audit});
  async function recordVerification(job,raw) {
    return tx(async c=>{
      await leaseScope(c,job);const {input,row}=await currentLease(c,job);
      const audit=validateVerificationAudit(raw,input,await contextFor(input,c));
      if(supportedVerificationVersions.indexOf(audit.version)<supportedVerificationVersions.indexOf(row.extractor_version))fail('verification_audit_conflict',409);
      const prior=(await c.query(`SELECT * FROM ${schema}.verification_audits WHERE job_id=$1 AND lease_token=$2`,[job.id,job.token])).rows[0];
      if(prior) {
        const previous=prior.audit;
        if(digest(previous)===digest(audit))return presentVerification(prior);
        if(previous.decision!=='pending'||audit.decision==='pending'
          ||previous.version!==audit.version||previous.schemaVersion!==audit.schemaVersion
          ||digest(previous.initial)!==digest(audit.initial)||previous.contextHash!==audit.contextHash
          ||digest(previous.reasons)!==digest(audit.reasons)
          ||audit.steps.length<previous.steps.length
          ||previous.steps.some((step,index)=>digest(step)!==digest(audit.steps[index])))fail('verification_audit_conflict',409);
        return presentVerification((await c.query(`UPDATE ${schema}.verification_audits SET audit=$3,updated_at=$4
          WHERE job_id=$1 AND lease_token=$2 RETURNING *`,[job.id,job.token,JSON.stringify(audit),now()])).rows[0]);
      }
      if(!['pending','skipped'].includes(audit.decision))fail('verification_required',409);
      const attempt=Number((await c.query(`SELECT COALESCE(max(attempt),0)+1 AS next FROM ${schema}.verification_audits WHERE job_id=$1`,[job.id])).rows[0].next);
      return presentVerification((await c.query(`INSERT INTO ${schema}.verification_audits(job_id,lease_token,attempt,audit,recorded_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$5) RETURNING *`,[job.id,job.token,attempt,JSON.stringify(audit),now()])).rows[0]);
    });
  }
  async function getVerification(id) {
    if(!uuid.test(id))fail('invalid_job_id');
    return tx(async c=>{
      const job=(await c.query(`SELECT * FROM ${schema}.jobs WHERE id=$1`,[id])).rows[0];
      if(!job)fail('job_not_found',404);
      const original=(await c.query(`SELECT body FROM ${schema}.source_versions WHERE source_id=$1 AND version=$2`,[job.source_id,job.source_version])).rows[0]?.body||null;
      const attempts=(await c.query(`SELECT * FROM ${schema}.verification_audits WHERE job_id=$1 ORDER BY attempt`,[id])).rows.map(presentVerification);
      return {job:presentJob(job),source:original,attempts};
    });
  }
  async function complete(job,raw,durationMs=0) {
    if(!Number.isFinite(durationMs)||durationMs<0||durationMs>2147483647)fail('invalid_job_duration');
    return tx(async c=>{
      await leaseScope(c,job);const {input,row}=await currentLease(c,job);
      const context=await contextFor(input,c),extraction=validateExtraction(raw,input,context);
      const audit=(await c.query(`SELECT audit FROM ${schema}.verification_audits WHERE job_id=$1 AND lease_token=$2`,[job.id,job.token])).rows[0]?.audit;
      if(!audit&&(supportedVerificationVersions.includes(row.extractor_version)||(await c.query(`SELECT 1 FROM ${schema}.verification_audits WHERE job_id=$1 LIMIT 1`,[job.id])).rows.length))fail('verification_required',409);
      if(audit) {
        if(!['kept','revised','skipped'].includes(audit.decision))fail('verification_required',409);
        if(audit.contextHash!==verificationContextHash(input,context))fail('verification_context_changed',409);
        if(digest(audit.final)!==digest(extraction))fail('verification_candidate_mismatch',409);
      }
      const localIds=new Map(extraction.items.map(item=>[item.key,itemId(input,item.key)]));
      const known=new Map(context.existingItems.map(item=>[item.id,item]));
      const normalized=extraction.items.map(item=>({...item,id:itemId(input,item.key),sourceId:input.id,sourceVersion:input.version,
        accountId:input.accountId,studentId:input.studentId,recordedAt:input.recordedAt,basis:input.kind,extractorVersion:row.extractor_version,
        linksTo:localIds.get(item.linksTo)||item.linksTo,corrects:localIds.get(item.corrects)||item.corrects}));
      for(const item of normalized)known.set(item.id,item);
      for(const item of normalized) {
        for(const field of ['linksTo','corrects']) {
          if(!item[field])continue;const target=known.get(item[field]);
          if(!target||target.id===item.id||target.episodeKey!==item.episodeKey||target.accountId!==input.accountId||target.studentId!==input.studentId)fail('invalid_evidence_link');
          if(field==='corrects'&&(target.kind!==item.kind||target.reportedBy!==item.reportedBy))fail('invalid_correction');
        }
        const seen=new Set([item.id]);let next=item.corrects;
        while(next){if(seen.has(next))fail('cyclic_correction');seen.add(next);next=known.get(next)?.corrects;}
      }
      await c.query(`DELETE FROM ${schema}.items WHERE source_id=$1 AND source_version=$2`,[input.id,input.version]);
      for(const item of normalized) {
        const id=episodeId(input,item.episodeKey);
        await c.query(`INSERT INTO ${schema}.items(id,source_id,source_version,episode_id,body) VALUES($1,$2,$3,$4,$5)`,[item.id,input.id,input.version,id,JSON.stringify(item)]);
        if(item.corrects)await c.query(`INSERT INTO ${schema}.supersessions(target_id,correction_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[item.corrects,item.id]);
        await c.query(`DELETE FROM ${schema}.invalidations WHERE source_id=$1 AND episode_id=$2 AND kind=$3 AND reported_by=$4 AND source_version<$5`,[input.id,id,item.kind,item.reportedBy,input.version]);
      }
      await c.query(`UPDATE ${schema}.jobs SET status='completed',completed_at=$2,duration_ms=$3,result_hash=$4,error=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1`,[job.id,now(),Math.round(durationMs),digest(extraction)]);
      await rebuild(c,input);return normalized.length;
    });
  }
  async function failure(job,error,{maxAttempts=3,retryDelayMs=1000}={}) {
    if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||!Number.isSafeInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>3600000)fail('invalid_retry_policy');
    return tx(async c=>{
      await leaseScope(c,job);const {row}=await currentLease(c,job);
      const code=diagnosticCodes.includes(error?.code)?error.code:'extraction_failed';
      const status=row.attempts>=maxAttempts?'failed':'queued';
      await c.query(`UPDATE ${schema}.jobs SET status=$2,error=$3,available_at=$4,lease_token=NULL,lease_until=NULL WHERE id=$1`,[job.id,status,code,new Date(clock()+retryDelayMs*row.attempts).toISOString()]);
      return status;
    });
  }
  async function retry(id) {
    if(!uuid.test(id))fail('invalid_job_id');
    const result=await pool.query(`UPDATE ${schema}.jobs SET status='queued',attempts=0,error=NULL,available_at=$2 WHERE id=$1 AND status='failed'`,[id,now()]);
    if(!result.rowCount)fail('job_not_retryable',409);
  }
  async function deleteSource(id) {
    return tx(async c=>{
      const initial=await source(id,c);if(initial)await scopeLock(c,initial);await sourceLock(c,id);
      const input=await source(id,c);
      if(!initial&&input)fail('source_changed_during_delete',409);
      if(input) {
        const snapshot=await scopedState(c,input);
        if(snapshot.jobs.some(job=>job.sourceId===id&&job.sourceVersion===input.version&&['queued','running','failed'].includes(job.status))) {
          await c.query(`INSERT INTO ${schema}.processing_gaps(source_id,source_version,account_id,student_id,reporter,recorded_at)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[id,input.version,input.accountId,input.studentId,input.reporter,input.recordedAt]);
        }
        // A deleted unprocessed correction cannot quietly restore earlier success.
        // The content-free invalidation remains after the source and jobs are erased.
        for(const episode of snapshot.episodes) if(episode.processingHolds.some(hold=>hold.sourceId===id)) {
          await retainInvalidation(c,episode.id,{sourceId:id,sourceVersion:input.version,kind:'unprocessed-source',reportedBy:input.reporter,occurredAt:null,recordedAt:null});
          await c.query(`DELETE FROM ${schema}.reviews WHERE episode_id=$1`,[episode.id]);
        }
        await invalidateSource(c,id);
        // Erase review prose attached to any concern containing removed evidence.
        await c.query(`DELETE FROM ${schema}.reviews WHERE episode_id IN (SELECT episode_id FROM ${schema}.items WHERE source_id=$1)`,[id]);
      }
      await c.query(`INSERT INTO ${schema}.tombstones(id,deleted_at) VALUES($1,$2) ON CONFLICT DO NOTHING`,[id,now()]);
      await c.query(`DELETE FROM ${schema}.sources WHERE id=$1`,[id]);
      if(input)await rebuild(c,input);
    });
  }
  async function state(scope=null) {
    return tx(async c=>{
      const snapshot=await scopedState(c,scope);
      return {mode:'network-effects-shadow',...snapshot,metrics:{sources:snapshot.sources.length,episodes:snapshot.episodes.length,
        items:snapshot.episodes.reduce((n,e)=>n+e.items.filter(i=>i.state==='current').length,0),
        pending:snapshot.episodes.filter(e=>e.outcomeState==='pending'||['open','partial'].includes(e.questionState)).length,
        failedJobs:snapshot.jobs.filter(job=>job.status==='failed').length}};
    });
  }
  async function overview() {
    const row=(await pool.query(`SELECT (SELECT count(*) FROM ${schema}.sources)::integer AS sources,
      (SELECT count(*) FROM ${schema}.episodes)::integer AS episodes,
      (SELECT count(*) FROM ${schema}.items i JOIN ${schema}.sources s ON s.id=i.source_id AND s.version=i.source_version WHERE NOT EXISTS(SELECT 1 FROM ${schema}.supersessions x WHERE x.target_id=i.id))::integer AS items,
      (SELECT count(*) FROM ${schema}.episodes WHERE pending)::integer AS pending,
      (SELECT count(*) FROM ${schema}.jobs WHERE status='failed')::integer AS "failedJobs",
      (SELECT count(*) FROM ${schema}.jobs WHERE status IN ('queued','running'))::integer AS "activeJobs",
      (SELECT count(*) FROM ${schema}.evaluations)::integer AS evaluations`)).rows[0];
    return {mode:'network-effects-shadow',metrics:row,generatedAt:now()};
  }
  function filters(input={},extra=[]) {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['page','pageSize',...extra].includes(key)))fail('invalid_network_filters');
    const page=input.page??1,pageSize=input.pageSize??20;
    if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail('invalid_network_pagination');
    return {page,pageSize,offset:(page-1)*pageSize};
  }
  async function listEpisodes(input={}) {
    const {page,pageSize,offset}=filters(input,['topic','language','status','query']);
    const args=[],where=[];const add=value=>{args.push(value);return `$${args.length}`;};
    if(input.topic){if(!Object.hasOwn(topicLabels,input.topic))fail('invalid_topic');where.push(`topic=${add(input.topic)}`);}
    if(input.language){if(!validLanguage(input.language))fail('invalid_language');where.push(`${add(input.language)}=ANY(languages)`);}
    if(input.status){if(!['unreviewed','reviewed','needs-review'].includes(input.status))fail('invalid_review_status');where.push(`review_state=${add(input.status)}`);}
    if(input.query){if(typeof input.query!=='string'||input.query.length>120)fail('invalid_query');where.push(`(body->>'episodeKey' ILIKE ${add('%'+input.query.replace(/[\\%_]/g,'\\$&')+'%')} OR body->>'accountId' ILIKE $${args.length} OR body->>'studentId' ILIKE $${args.length})`);}
    const clause=where.length?' WHERE '+where.join(' AND '):'';
    const total=Number((await pool.query(`SELECT count(*) AS n FROM ${schema}.episodes${clause}`,args)).rows[0].n);
    const rows=(await pool.query(`SELECT body - 'items' AS body,jsonb_array_length(body->'items') AS "itemCount" FROM ${schema}.episodes${clause} ORDER BY updated_at DESC,id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,pageSize,offset])).rows;
    return {items:rows.map(row=>({...row.body,itemCount:row.itemCount})),total,page,pageSize};
  }
  async function getEpisode(id) {
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_episode_id');
    const episode=(await pool.query(`SELECT body FROM ${schema}.episodes WHERE id=$1`,[id])).rows[0]?.body;
    if(!episode)fail('episode_not_found',404);
    const sourceIds=[...new Set([...episode.items.map(item=>item.sourceId),...(episode.processingHolds||[]).map(hold=>hold.sourceId),
      ...(episode.correctionCoverageHolds||[]).map(hold=>hold.correctionSourceId).filter(Boolean)])];
    const sourceHistory=(await pool.query(`SELECT body FROM ${schema}.source_versions WHERE source_id=ANY($1::text[]) ORDER BY source_id,version`,[sourceIds])).rows.map(row=>row.body);
    const reviews=(await pool.query(`SELECT id,revision,decision,note,recorded_at FROM ${schema}.reviews WHERE episode_id=$1 ORDER BY sequence`,[id])).rows.map(row=>({...row,episodeId:id,recordedAt:iso(row.recorded_at),recorded_at:undefined}));
    return {episode,sourceHistory,reviews};
  }
  async function listJobs(input={}) {
    const {page,pageSize,offset}=filters(input,['status']);
    if(input.status&&!['queued','running','failed','completed','obsolete'].includes(input.status))fail('invalid_job_status');
    const args=input.status?[input.status]:[],where=input.status?' WHERE status=$1':'';
    const total=Number((await pool.query(`SELECT count(*) AS n FROM ${schema}.jobs${where}`,args)).rows[0].n);
    const rows=(await pool.query(`SELECT * FROM ${schema}.jobs${where} ORDER BY sequence DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,pageSize,offset])).rows;
    return {items:rows.map(presentJob),total,page,pageSize};
  }
  async function listSources(input={}) {
    const {page,pageSize,offset}=filters(input);
    const total=Number((await pool.query(`SELECT count(*) AS n FROM ${schema}.sources`)).rows[0].n);
    return {items:(await pool.query(`SELECT body FROM ${schema}.sources ORDER BY id LIMIT $1 OFFSET $2`,[pageSize,offset])).rows.map(row=>row.body),total,page,pageSize};
  }
  async function review({episodeId:id,expectedRevision,decision,note=''},actor='system') {
    if(!['reviewed','needs-review'].includes(decision)||typeof note!=='string'||note.length>2000||typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('invalid_review');
    await tx(async c=>{
      const initial=(await c.query(`SELECT body FROM ${schema}.episodes WHERE id=$1`,[id])).rows[0]?.body;
      if(!initial)fail('episode_not_found',404);await scopeLock(c,initial);
      const episode=(await c.query(`SELECT body FROM ${schema}.episodes WHERE id=$1`,[id])).rows[0]?.body;
      if(!episode||episode.revision!==expectedRevision)fail('stale_review',409);
      await c.query(`INSERT INTO ${schema}.reviews(id,episode_id,revision,decision,note,actor_hash,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),id,expectedRevision,decision,note.trim(),actorHash(actor),now()]);
      await rebuild(c,episode);
    });
    return getEpisode(id);
  }
  async function recordEvaluation(report,{id=randomUUID(),actor='system'}={}) {
    if(!uuid.test(id)||!report||typeof report!=='object'||Array.isArray(report))fail('invalid_evaluation');
    const encoded=JSON.stringify(report);if(Buffer.byteLength(encoded)>8_000_000)fail('evaluation_too_large');
    const reportModel=report.model??report.configuration?.model;
    const model=typeof reportModel==='string'?reportModel.slice(0,120):null;
    const status=typeof report.status==='string'?report.status.slice(0,40):'recorded';
    const fingerprint=digest(report);
    return tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`network-evaluation:${id}`]);
      const existing=(await c.query(`SELECT fingerprint FROM ${schema}.evaluations WHERE id=$1`,[id])).rows[0];
      if(existing){if(existing.fingerprint!==fingerprint)fail('evaluation_conflict',409);return {id,replayed:true};}
      await c.query(`INSERT INTO ${schema}.evaluations(id,fingerprint,model,status,actor_hash,report,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,fingerprint,model,status,actorHash(actor),encoded,now()]);
      return {id,replayed:false};
    });
  }
  async function listEvaluations(input={}) {
    const {page,pageSize,offset}=filters(input);
    const total=Number((await pool.query(`SELECT count(*) AS n FROM ${schema}.evaluations`)).rows[0].n);
    const rows=(await pool.query(`SELECT id,model,status,created_at,report->'metrics' AS metrics,report->'summary' AS summary FROM ${schema}.evaluations ORDER BY sequence DESC LIMIT $1 OFFSET $2`,[pageSize,offset])).rows;
    return {items:rows.map(row=>({...row,createdAt:iso(row.created_at),created_at:undefined})),total,page,pageSize};
  }
  async function getEvaluation(id) {
    if(!uuid.test(id))fail('invalid_evaluation_id');
    const row=(await pool.query(`SELECT id,model,status,created_at,report FROM ${schema}.evaluations WHERE id=$1`,[id])).rows[0];
    if(!row)fail('evaluation_not_found',404);return {...row,createdAt:iso(row.created_at),created_at:undefined};
  }
  function money(value,round) {
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>10000)fail('invalid_budget_amount');
    return round(value*1_000_000);
  }
  async function reserveBudget({budgetId,limitUsd,reservationId,amountUsd}) {
    if(typeof budgetId!=='string'||typeof reservationId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(budgetId)||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(reservationId))fail('invalid_budget_identity');
    const limit=money(limitUsd,Math.floor),amount=money(amountUsd,Math.ceil);
    return tx(async c=>{
      await c.query(`INSERT INTO ${schema}.budgets(id,limit_micros,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[budgetId,limit,now()]);
      const budget=(await c.query(`SELECT * FROM ${schema}.budgets WHERE id=$1 FOR UPDATE`,[budgetId])).rows[0];
      if(Number(budget.limit_micros)!==limit)fail('budget_limit_conflict',409);
      const prior=(await c.query(`SELECT * FROM ${schema}.budget_reservations WHERE id=$1`,[reservationId])).rows[0];
      if(prior){if(prior.budget_id!==budgetId||Number(prior.reserved_micros)!==amount)fail('reservation_conflict',409);return {accepted:false,duplicate:true,reservationId};}
      const charged=Number((await c.query(`SELECT COALESCE(sum(charged_micros),0) AS n FROM ${schema}.budget_reservations WHERE budget_id=$1`,[budgetId])).rows[0].n);
      if(charged+amount>limit)return {accepted:false,duplicate:false,reservationId,chargedUsd:charged/1e6,limitUsd:limit/1e6};
      await c.query(`INSERT INTO ${schema}.budget_reservations(id,budget_id,reserved_micros,charged_micros,created_at) VALUES($1,$2,$3,$3,$4)`,[reservationId,budgetId,amount,now()]);
      return {accepted:true,duplicate:false,reservationId,reservedUsd:amount/1e6,chargedUsd:(charged+amount)/1e6,limitUsd:limit/1e6};
    });
  }
  async function settleBudget({reservationId,actualUsd}) {
    if(typeof reservationId!=='string')fail('invalid_budget_identity');
    const actual=money(actualUsd,Math.ceil);
    return tx(async c=>{
      const row=(await c.query(`SELECT * FROM ${schema}.budget_reservations WHERE id=$1 FOR UPDATE`,[reservationId])).rows[0];
      if(!row)fail('reservation_not_found',404);
      if(actual>Number(row.reserved_micros))fail('reservation_exceeded',409);
      if(row.settled&&actual!==Number(row.charged_micros))fail('settlement_conflict',409);
      await c.query(`UPDATE ${schema}.budget_reservations SET charged_micros=$2,settled=true WHERE id=$1`,[reservationId,actual]);
      return {reservationId,chargedUsd:actual/1e6,settled:true};
    });
  }
  async function recordJobDiagnostic(job,data={}) {
    const safe={responseId:typeof data.responseId==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(data.responseId)?data.responseId:null,
      model:typeof data.model==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(data.model)?data.model:null,
      durationMs:Number.isFinite(data.durationMs)&&data.durationMs>=0?Math.min(Math.round(data.durationMs),2147483647):null,
      outcome:typeof data.outcome==='string'&&/^[a-z_]{1,40}$/.test(data.outcome)?data.outcome:'unknown',
      errorCode:diagnosticCodes.includes(data.errorCode)?data.errorCode:null,
      sent:typeof data.sent==='boolean'?data.sent:null,
      usage:data.usage&&Number.isSafeInteger(data.usage.inputTokens)&&data.usage.inputTokens>=0&&Number.isSafeInteger(data.usage.outputTokens)&&data.usage.outputTokens>=0?{inputTokens:data.usage.inputTokens,outputTokens:data.usage.outputTokens}:null};
    return tx(async c=>{await leaseScope(c,job);await currentLease(c,job);await c.query(`UPDATE ${schema}.jobs SET diagnostic=$2 WHERE id=$1`,[job.id,JSON.stringify(safe)]);return safe;});
  }
  return {ingest,claim,complete,failure,retry,source,contextFor,deleteSource,state,overview,listEpisodes,getEpisode,listJobs,listSources,review,recordEvaluation,listEvaluations,getEvaluation,reserveBudget,settleBudget,recordJobDiagnostic,recordVerification,getVerification};
}
