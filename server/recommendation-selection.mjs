import {assessPrivateEpisodes} from './outcome-assessment.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {recommendationsEnabled} from './recommendation-contract.mjs';
import {outcomeEvidenceEnabled} from './outcome-evidence.mjs';
import {withRequestDeadline} from '../src/requestDeadline.mjs';
import {selectBinderRecommendation,recommendationRequestAllowed} from './binder-next-step.mjs';
import {validateRecommendationSelectionRequest,unknownRecommendationFacts,selectionDigest,recommendationTextKey,unavailableRecommendation,preserveStudentPriority,recommendationSelectionLimits} from './recommendation-policy.mjs';

const scope=organizationId=>({campus:{state:'unknown',id:null},term:{state:'unknown',value:null},organizationId:organizationId||null});
const instant=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const decisionRevision=result=>selectionDigest({...result.decision,candidate:result.decision.candidate?{...result.decision.candidate,expiresAt:null}:null,clarification:result.clarification?.code||null});
// Only exact, explicitly selected private episodes belonging to this action
// contribute. Shared observations, generic helpfulness and prose are not joined.
export function recommendationOutcomeFacts(bundle,{now=Date.now()}={}){
 const facts=unknownRecommendationFacts();if(!bundle)return {facts,goalChanged:false};
 if(bundle.episodes.length>8||bundle.evidence.length>100)return {facts,limited:true,goalChanged:false};
 const scopes=new Set(bundle.episodes.map(e=>JSON.stringify([e.plan_id,e.step_id,e.institution,e.term,e.cycle,e.window_start,e.window_end,e.time_zone])));
 if(scopes.size>1){facts.submission_reported='conflict';return {facts,goalChanged:false};}
 const assessments=assessPrivateEpisodes(bundle,new Date(now)),values={submission_reported:new Set(),decision_pending:new Set(),decision_received:new Set()};let goalChanged=false;
 for(const a of assessments){
  if(['disputed','ambiguous','multiple_events'].includes(a.state)){facts.submission_reported='conflict';continue;}
  if(a.state!=='student_reported')continue;
  for(const claim of a.supportedClaims){
   const source=a.evidence.find(e=>e.reference.id===claim.reference.id&&e.reference.version===claim.reference.version);
   if(!source||source.origin!=='student_reported'||source.responseState!=='answered')continue;
   const recorded=Date.parse(source.recordedAt);if(!Number.isFinite(recorded)||recorded>now)continue;
   if(claim.claim.status==='goal_changed'){goalChanged=true;continue;}
   // Pending is a time-sensitive student report. Old silence is never proof
   // that the decision is still pending; the seven-day bound only removes use.
   if(a.definition.id==='decision_received'){
    if(claim.claim.status==='pending'&&now-recorded<=7*86400000){values.decision_pending.add('yes');values.decision_received.add('no');}
    if(claim.claim.status==='occurred'){values.decision_received.add('yes');values.decision_pending.add('no');}
   }
   if(a.definition.id==='document_submitted'&&['occurred','not_occurred'].includes(claim.claim.status))values.submission_reported.add(claim.claim.status==='occurred'?'yes':'no');
  }
 }
 for(const [key,set] of Object.entries(values))if(facts[key]!=='conflict')facts[key]=set.size>1?'conflict':set.size===1?[...set][0]:'unknown';
 return {facts,goalChanged};
}

export function assembleRecommendationContext(request,snapshot,{now=Date.now(),reportedFacts={}}={}){
 const data=snapshot.inputs,{facts,goalChanged,limited}=recommendationOutcomeFacts(data.outcomes,{now});
 for(const [key,value] of Object.entries(reportedFacts)){
  if(!['document_requested','document_prepared','submission_reported','decision_pending'].includes(key)||!['yes','no','unknown'].includes(value))throw Error('invalid_reported_prerequisite');
  if(value!=='unknown')facts[key]=facts[key]==='unknown'||facts[key]===value?value:'conflict';
 }
 const candidates=[];
 for(const row of data.templates){
  const v=row.content;
  // The database intentionally supplies only general questions here. A future
  // campus verifier must resolve an exact identity and fresh official claims;
  // labels in saved outcome episodes cannot stand in for that verifier.
  if(v.mode!=='general_question'||row.requiresOfficialLookup||v.campus!==null||v.term!==null)throw Error('unverified_institutional_template');
  candidates.push({candidate:{contractVersion:1,source:row.source,action:v.action,explanation:v.explanation,goal:v.goal,process:v.process,prerequisites:v.prerequisites,exclusions:v.exclusions,scope:scope(),support:[],reviewedAt:v.reviewedOn+'T00:00:00.000Z',expiresAt:v.reviewBy+'T23:59:59.999Z'},
   sourceRevision:row.sourceRevision,studentId:request.studentId,availability:'current',state:goalChanged?'goal_changed':'available',deadline:null,official:null});
 }
 if(request.intent==='revisit_action'&&data.selected){
  const s=data.selected,updated=instant(s.updatedAt),accepted=s.source.kind==='accepted-action';
  if(!updated||typeof s.action!=='string'||!s.action.trim()||s.action.length>750||/[\x00-\x1f\x7f]/.test(s.action)||s.state==='unavailable')throw Error('selected_action_unavailable');
  const author=typeof s.authorName==='string'&&s.authorName.trim()?s.authorName.trim():null;
  if(author&&(author.length>120||/[\x00-\x1f\x7f]/.test(author)))throw Error('selected_author_unavailable');
  // These labels are bilingual; the quoted private wording remains verbatim.
  // No translation is invented, and no conditional clause is silently cut.
  const action=accepted?{en:`Revisit your saved action: “${s.action}”`,es:`Retoma tu acción guardada: «${s.action}»`}:{en:`${author||'Your coordinator'} suggested: “${s.action}”`,es:`Tu coordinador${author?` (${author})`:''} sugirió: «${s.action}»`};
  const explanation=accepted?{en:'This is your existing action in its saved wording. Revisiting it does not change its status or schedule a check-in.',es:'Esta es tu acción existente, con el texto que guardaste. Retomarla no cambia su estado ni programa un seguimiento.'}:{en:'This remains your coordinator’s suggestion, not an accepted action or verified institutional requirement.',es:'Esto sigue siendo una sugerencia de tu coordinador, no una acción aceptada ni un requisito institucional verificado.'};
  candidates.push({candidate:{contractVersion:1,source:s.source,action,explanation,goal:request.goal,process:request.process,prerequisites:[],exclusions:['already_completed','declined','deferred','conflicting_evidence','expired_requirement'],scope:scope(s.source.organizationId),support:[],reviewedAt:updated,expiresAt:new Date(now+recommendationSelectionLimits.receiptLifetimeMs).toISOString()},
   sourceRevision:s.sourceRevision,studentId:request.studentId,availability:'current',state:goalChanged?'goal_changed':s.state,deadline:s.personalTargetDate?{kind:'personal',on:s.personalTargetDate,timeZone:request.timeZone,sourceId:null}:null,official:null});
 }
 // Normalize in one runtime, independent of PostgreSQL's deployment collation
 // (not all locales lowercase Spanish accents identically). Private duplicate
 // wording stays inside this server projection and never reaches the decision.
 const duplicates=data.duplicates.map(d=>({keys:[recommendationTextKey(d.action)],state:d.state}));
 return {studentId:request.studentId,goal:request.goal,process:request.process,scope:scope(request.focus?.organizationId),facts,timeZone:request.timeZone,intent:request.intent,focus:request.focus,limited:limited===true,requiresScope:data.requiresScope,evidenceRevision:snapshot.revision,candidates,duplicates};
}

// Internal server entry point. The caller must provide the authenticated current
// student request in `interaction`; no browser/model can provide this through a
// route or tool. Step 4 connects independently captured voice/binder intent.
export function createRecommendationSelector(database,env={}){return async(subject,raw,{interaction,signal,now=Date.now(),client:transactionClient,reportedFacts={}}={})=>{
 const request=validateRecommendationSelectionRequest(raw);
 if(!recommendationsEnabled(env,subject))return unavailableRecommendation('paused');
 if(!recommendationRequestAllowed(interaction,request))return preserveStudentPriority();
 if(!database)return unavailableRecommendation();
 if(request.episodes.length&&!outcomeEvidenceEnabled(env,subject))return unavailableRecommendation('source_unavailable');
 const command={studentId:request.studentId,intent:request.intent,goal:request.goal,process:request.process,focus:request.focus,episodes:request.episodes};
 try{return await withRequestDeadline(async abort=>{
  const c=transactionClient||await database.connect();let active=false;
  try{
   abort.throwIfAborted();if(!transactionClient){await c.query('BEGIN');active=true;}
   await c.query("SET LOCAL statement_timeout='3000ms'");await guardAccountTransaction(c,subject);abort.throwIfAborted();
   await c.query("SELECT set_config('origen.recommendations','true',true),set_config('origen.recommendation_outcomes',$1,true)",[outcomeEvidenceEnabled(env,subject)?'true':'false']);
   const read=async()=>{abort.throwIfAborted();return (await c.query('SELECT origen_recommendation_selection_inputs($1::jsonb) AS result',[JSON.stringify(command)])).rows[0].result;};
   const first=await read();abort.throwIfAborted();
   if(first.error)return unavailableRecommendation(first.error==='recommendation_paused'?'paused':'source_unavailable');
   if(first.status!=='current')return unavailableRecommendation(first.reason==='limit_exceeded'?'limit_exceeded':'source_unavailable');
   const result=selectBinderRecommendation(interaction,assembleRecommendationContext(request,first,{now,reportedFacts}),{now});
   // A new READ COMMITTED statement re-resolves *all* considered inputs, not
   // just the winner. A withdrawal, correction or competing publication during
   // loading cannot leave a result selected from a stale snapshot.
   const second=await read();abort.throwIfAborted();
   if(second.status!=='current'||second.revision!==first.revision)return unavailableRecommendation('source_unavailable');
   await guardAccountTransaction(c,subject);abort.throwIfAborted();
   if(!recommendationsEnabled(env,subject))return unavailableRecommendation('paused');
   if(request.episodes.length&&!outcomeEvidenceEnabled(env,subject))return unavailableRecommendation('source_unavailable');
   if(!transactionClient)await c.query('COMMIT');active=false;abort.throwIfAborted();
   if(!recommendationRequestAllowed(interaction,request))return preserveStudentPriority();
   if(!recommendationsEnabled(env,subject))return unavailableRecommendation('paused');
   if(request.episodes.length&&!outcomeEvidenceEnabled(env,subject))return unavailableRecommendation('source_unavailable');
   return {...result,guard:{policyVersion:result.decision.policyVersion,revision:first.revision,requestRevision:selectionDigest(Object.keys(reportedFacts).length?{request,reportedFacts}:request),decisionRevision:decisionRevision(result),expiresAt:new Date(Math.min(now+recommendationSelectionLimits.receiptLifetimeMs,result.decision.candidate?Date.parse(result.decision.candidate.expiresAt):Infinity)).toISOString()}};
  }finally{if(active)await c.query('ROLLBACK').catch(()=>{});if(!transactionClient)c.release();}
 },{signal,timeoutMs:recommendationSelectionLimits.deadlineMs});}
 catch(error){if(error.status===403)throw error;return unavailableRecommendation(error.code==='54000'?'limit_exceeded':'lookup_failed');}
};}

// A freshness receipt is not acceptance or consent. Recheck with the same
// authenticated request/interaction before future delivery, even inside its TTL.
export function createRecommendationVerifier(database,env={}){const select=createRecommendationSelector(database,env);return async(subject,raw,guard,options={})=>{
 const request=validateRecommendationSelectionRequest(raw),now=options.now??Date.now();
 if(!guard||typeof guard!=='object'||Array.isArray(guard)||Object.keys(guard).sort().join(',')!=='decisionRevision,expiresAt,policyVersion,requestRevision,revision'||guard.policyVersion!=='evidence-informed-v1'||!Number.isFinite(Date.parse(guard.expiresAt))||Date.parse(guard.expiresAt)<=now||Date.parse(guard.expiresAt)>now+recommendationSelectionLimits.receiptLifetimeMs||guard.requestRevision!==selectionDigest(request)||!/^[a-f0-9]{64}$/.test(guard.revision)||!/^[a-f0-9]{64}$/.test(guard.decisionRevision))return {status:'unavailable'};
 const result=await select(subject,request,{...options,now});
 return result.guard?.revision===guard.revision&&result.guard?.requestRevision===guard.requestRevision&&result.guard?.decisionRevision===guard.decisionRevision&&result.decision.status==='recommended'?{status:'current',decision:result.decision}:{status:'unavailable'};
};}
