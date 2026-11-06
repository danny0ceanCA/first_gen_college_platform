import { createHash } from 'node:crypto';
import { latestState, episodeProcessingHolds, processingHoldWarning, mixedStateWarning,
  correctionCoverageIndex, episodeCorrectionCoverageHolds, correctionCoverageWarning } from '../../research/network-effects/projection-state.mjs';
export { latestState } from '../../research/network-effects/projection-state.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const itemId = (source, key) => `${source.id}@${source.version}#${key}`;
export const episodeId = (source, key) => digest([source.accountId,source.studentId,key]);
export const evidenceTime = item => item.occurredAt || item.recordedAt;
export const fail = (code,status=400) => { throw Object.assign(new Error(code),{code,status}); };
export const iso = value => value instanceof Date ? value.toISOString() : value;
export function presentJob(row) {
  return {id:row.id,sourceId:row.source_id,sourceVersion:row.source_version,extractorVersion:row.extractor_version,
    status:row.status,attempts:row.attempts,error:row.error,createdAt:iso(row.created_at),
    completedAt:iso(row.completed_at),durationMs:row.duration_ms,diagnostic:row.diagnostic||null};
}
export function projectEpisodes({sources,items,supersessions,invalidations,reviews,jobs=[],processingGaps=[]}) {
  const versions=new Map(sources.map(source=>[source.id,source.version]));
  const retainedIds=new Set(items.map(item=>item.id));
  const corrected=new Set(supersessions.map(row=>row.target_id));
  const correctionCoverage=correctionCoverageIndex(items,supersessions);
  const activeIds=new Set(items.filter(item=>versions.get(item.sourceId)===item.sourceVersion&&!corrected.has(item.id)).map(item=>item.id));
  const grouped=new Map();
  for(const item of items) {
    const entry={...item,state:activeIds.has(item.id)?'current':'superseded',linkState:item.linksTo&&!activeIds.has(item.linksTo)
      &&!(item.linksTo===item.corrects&&retainedIds.has(item.corrects))?'unresolved':'supported'};
    const entries=grouped.get(item.episodeId)||[];entries.push(entry);grouped.set(item.episodeId,entries);
  }
  return [...grouped].map(([id,entries])=>{
    entries.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id));
    const current=entries.filter(item=>item.state==='current'),first=entries[0];
    const removed=invalidations.filter(row=>row.episode_id===id&&!current.some(item=>item.sourceId!==row.source_id&&item.kind===row.kind&&item.reportedBy===row.reported_by&&row.evidence_at&&evidenceTime(item)>row.evidence_at))
      .sort((a,b)=>a.source_id.localeCompare(b.source_id)||a.kind.localeCompare(b.kind)||a.reported_by.localeCompare(b.reported_by));
    const invalidKinds=new Set(removed.map(row=>row.kind));
    const processingHolds=episodeProcessingHolds(entries,sources,jobs,processingGaps);
    const correctionCoverageHolds=episodeCorrectionCoverageHolds(current,correctionCoverage);
    const processingUnresolved=processingHolds.length>0||invalidKinds.has('unprocessed-source');
    const revision=digest({entries,invalidations:removed,processingHolds,correctionCoverageHolds});
    const latestReview=reviews.filter(review=>review.episodeId===id).at(-1);
    const questionState=processingUnresolved||invalidKinds.has('question')?'unknown':latestState(current,'question')||'unknown';
    const actionState=processingUnresolved||invalidKinds.has('action')?'unknown':latestState(current,'action');
    const outcomeState=processingUnresolved||correctionCoverageHolds.length>0||invalidKinds.has('outcome')?'unknown':latestState(current,'outcome');
    const mixed=[questionState,actionState,outcomeState].includes('mixed');
    const uncertain=current.some(item=>item.linkState==='unresolved')||[questionState,actionState,outcomeState].includes('conflicting')||removed.length>0||processingUnresolved||correctionCoverageHolds.length>0;
    const reviewState=uncertain?'needs-review':latestReview?.revision===revision?latestReview.decision:'unreviewed';
    return {id,revision,accountId:first.accountId,studentId:first.studentId,episodeKey:first.episodeKey,topic:current.at(-1)?.topic||first.topic,
      barriers:[...new Set(current.map(item=>item.barrier).filter(Boolean))],questionState,actionState,outcomeState,
      reviewState,analysisEligible:!uncertain&&reviewState!=='needs-review',processingHolds,correctionCoverageHolds,
      evidenceWarnings:[...(removed.length?['Earlier source evidence changed or was removed. Review this concern before drawing conclusions.']:[]),
        ...(processingUnresolved?[processingHoldWarning]:[]),...(mixed?[mixedStateWarning]:[]),
        ...(correctionCoverageHolds.length?[correctionCoverageWarning]:[])],items:entries};
  });
}
