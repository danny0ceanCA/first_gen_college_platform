import {assessPrivateEpisodes} from './outcome-assessment.mjs';
export function recommendationEvaluationRows(bundle){
 return bundle.items.map(r=>{
  const single=r.outcomes.length===1?r.outcomes[0]:null;
  const assessment=single?assessPrivateEpisodes({episodes:[single.episode],evidence:single.evidence,definitions:bundle.definitions},new Date(bundle.cutoff))[0]:null;
  return {key:r.key,participant:r.participant,sourceKey:r.sourceKey,status:r.status,considered:r.considered,eligible:r.eligible,channel:r.channel,language:r.language,latencyMs:r.latencyMs,displayed:r.displayed,played:r.played,accepted:r.accepted,
   outcome:r.outcomes.length>1?'ambiguous':assessment?.state||'not_recorded',episodeKey:single?.episode.id||null,
   reportedAttempt:single?.evidence.some(e=>['attempted','completed'].includes(e.reported_action))||false,
   pending:single?.evidence.some(e=>e.claim_status==='pending')||false,adverse:assessment?.reasonCodes.includes('decision_is_denial')||false,
   unknown:single?.evidence.some(e=>e.response_state==='unknown'||e.claim_status==='unknown')||false,
   declinedOutcome:single?.evidence.some(e=>e.response_state==='declined')||false,
   supportedOutcome:!!assessment?.supportedClaims.some(c=>c.claim.status==='occurred')};
 });
}
export function recommendationQualityReport(rows,{period,limited=false,synthetic=false}={}){
 if(!Array.isArray(rows)||rows.length>1000||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('invalid_recommendation_quality');
 const seen=new Set(),sources=new Set(),participants=new Set();
 const normalized=rows.map(r=>{if(!/^[a-f0-9]{64}$/.test(r.key)||!/^[a-f0-9]{64}$/.test(r.participant)||seen.has(r.key)||!['recommended','clarification_required','no_applicable_candidate','unavailable'].includes(r.status)||!['binder','voice'].includes(r.channel)||!['en','es'].includes(r.language)||!Number.isFinite(r.latencyMs)||r.latencyMs<0||r.latencyMs>60000)throw Error('invalid_recommendation_quality');seen.add(r.key);participants.add(r.participant);const key=r.sourceKey&&`${r.participant}:${r.sourceKey}`,repeated=!!key&&sources.has(key);if(key)sources.add(key);return {...r,repeated};});
 const suppressed=limited||participants.size<10;
 const predicates={candidate_considered:r=>r.considered>0,applicable_candidate:r=>r.eligible>0,recommendation_returned:r=>r.status==='recommended',clarification:r=>r.status==='clarification_required',no_applicable_candidate:r=>r.status==='no_applicable_candidate',lookup_unavailable:r=>r.status==='unavailable',display_observed:r=>r.displayed,complete_playback_observed:r=>r.played,accepted:r=>r.accepted,repeated_source:r=>r.repeated,reported_attempt:r=>r.reportedAttempt,current_outcome:r=>!!r.episodeKey,supported_reported_outcome:r=>r.supportedOutcome,pending:r=>r.pending,adverse:r=>r.adverse,unknown_outcome:r=>r.unknown,explicit_outcome_decline:r=>r.declinedOutcome,ambiguous_or_disputed:r=>['ambiguous','disputed'].includes(r.outcome),outcome_not_recorded:r=>r.outcome==='not_recorded',selection_within_four_seconds:r=>r.latencyMs<=4000};
 const metrics={};for(const [name,predicate] of Object.entries(predicates)){const yes=normalized.filter(predicate),no=normalized.filter(r=>!predicate(r));const hidden=suppressed||new Set(yes.map(r=>r.participant)).size<10||new Set(no.map(r=>r.participant)).size<10;metrics[name]={count:hidden?null:yes.length,denominator:hidden?null:rows.length,rate:hidden?null:yes.length/rows.length,suppressed:hidden};}
 return {contract:'recommendation-quality-v1',purpose:'recommendation_evaluation',synthetic,policyVersion:'evidence-informed-v1',period,status:limited?'incomplete':suppressed?'suppressed':'available',minimumParticipants:10,
  participants:suppressed?null:participants.size,selections:suppressed?null:rows.length,metrics,
  unit:'one_prospectively_recorded_selection',outcomeUnit:'at_most_one_current_explicitly_linked_episode_per_accepted_action',
  population:'voluntary_currently_permitted_receipts_in_previous_UTC_calendar_month',
  outcomeMeaning:'An occurred claim concerns its episode’s own definition. Different definitions are not a common success measure or proof of effectiveness.',
  missingness:'No display, playback, acceptance or return event means not observed, never a failure. Multiple current outcomes are excluded from outcome counts as ambiguous.',
  unmeasured:['all_eligible_students','evaluation_declines','requests_without_receipts','comprehension','institution_verified_outcome','inappropriate_action_rate_in_live_use','causal_effect','policy_effectiveness'],
  limitations:['At least ten distinct accounts are required in each released cell and its complement; this is a privacy threshold, not statistical power.','Episodes are not independent students; repeated selections are not additional participants.','Current permission, source versions and exact outcome relationships are rechecked; corrections and withdrawals can change this population.','One report per organization per UTC day; no arbitrary date, demographic, campus, policy or individual filters and no retained report cache.','Reported outcomes describe volunteers who returned; they do not establish that a recommendation caused a result.','Language/layout and inappropriate-action checks belong to the separate held-out reference review. No automatic promotion, training, ranking or partner export is authorized.']};
}
