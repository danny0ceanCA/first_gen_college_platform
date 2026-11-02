// Versioned definitions describe claims, never infer them from prose or task status.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const definitions=[
 ['office_contacted','Contacted the office','Me comuniqué con la oficina','Reached the relevant office and exchanged information; an unanswered call is only an attempt.',['document_submitted','document_accepted','decision_received','waiver_approved']],
 ['document_submitted','Submitted the document','Entregué el documento','Sent the specified requested document through the intended channel; acceptance is a separate claim.',['document_accepted','decision_received','waiver_approved']],
 ['document_accepted','Document accepted','Documento aceptado','The relevant office indicated that the specified document meets its submission requirements.',['decision_received','waiver_approved']],
 ['decision_received','Received a decision','Recibí una decisión','Received a decision for this specific process and term; approval, denial and another decision remain distinct.',['waiver_approved']],
 ['waiver_approved','Insurance waiver approved','Exención del seguro aprobada','The institution issued an approval for this student’s insurance waiver for the specified term. A policy page or submission receipt does not establish approval.',['financial_aid_awarded','advice_caused_success']]
];
export const outcomeDefinitions=freeze(definitions.map(([id,en,es,criterion,doesNotEstablish])=>({id,version:1,label:{en,es},criterion,scope:'institution-term-cycle',observationWindow:{kind:'explicit-local-dates',maxDays:366,afterWindow:'unknown-unless-explicitly-reported'},freshness:'exact-source-version-and-scope',bases:['student_account','direct_observation','declared_record_review'],doesNotEstablish})));
export const outcomeEvidenceContract=freeze({version:1,origins:['student_reported','coordinator_observation'],bases:['student_account','direct_observation','declared_record_review'],assessment:['not_assessed','supports','contradicts','does_not_establish'],currency:['current','stale','disputed','unavailable'],datePrecision:['day','unknown'],purposes:['private_record'],institutionVerified:false,evaluationAllowed:false});
export const phase3OutcomeCompatibility=freeze({reportedAction:'Task activity only; no specific outcome is inferred.',reportedOutcome:'Retain the student’s generic result; do not infer document acceptance or approval.',helpfulness:'Optional subjective feedback, separate from an outcome or causal effect.',missingReport:'Missing, not a decline or an unsuccessful outcome.',sharedUpdate:'Separate approved snapshot; no private report identity or verification is inferred.',coordinatorResponse:'Advice or response, not outcome verification.',mapping:'New exact student approval is required to associate a report with a definition and cycle.'});
export const outcomeDefinition=(id,version)=>outcomeDefinitions.find(d=>d.id===id&&d.version===version);
const fail=()=>{throw Object.assign(Error('invalid_outcome_evidence'),{status:400});};
const object=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();};
const str=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0&&v<=2147483647;
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='1900-01-01'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const zone=v=>{if(!str(v,100))fail();try{return new Intl.DateTimeFormat('en',{timeZone:v}).resolvedOptions().timeZone;}catch{fail();}};
export function validateOutcomeEpisode(value){
 object(value,['definitionId','definitionVersion','scope','window']);
 if(!outcomeDefinition(value.definitionId,value.definitionVersion))fail();
 object(value.scope,['institution','term','cycle']);
 if(!str(value.scope.institution,200)||!str(value.scope.term,100)||!str(value.scope.cycle,128))fail();
 object(value.window,['start','end','timeZone']);
 const {start,end}=value.window,timeZone=zone(value.window.timeZone);
 if(!day(start)||!day(end)||end<start||(Date.parse(end)-Date.parse(start))/86400000>=366)fail();
 return {...value,scope:Object.fromEntries(Object.entries(value.scope).map(([k,v])=>[k,v.trim()])),window:{start,end,timeZone}};
}
// A proposal shape for step 2, not a write API or proof of consent. Source text,
// dates, author, provenance, permissions and verification are resolved server-side.
export function validateOutcomeReportLink(value){
 object(value,['episode','report','responseState','claimStatus','decision']);
 const episode=validateOutcomeEpisode(value.episode);object(value.report,['id','version']);
 if(!uuid(value.report.id)||!positive(value.report.version)||!['answered','declined','unknown'].includes(value.responseState))fail();
 if(value.responseState==='answered'){
  if(!['occurred','not_occurred','pending','unknown','goal_changed'].includes(value.claimStatus))fail();
  if(episode.definitionId==='decision_received'&&value.claimStatus==='occurred'){
   if(!['approved','denied','other','unknown'].includes(value.decision))fail();
  }else if(value.decision!==null)fail();
 }else if(value.claimStatus!==null||value.decision!==null)fail();
 return {...value,episode,report:{id:value.report.id.toLowerCase(),version:value.report.version}};
}
export function validateOutcomeEventDate(value,now=new Date()){
 object(value,['on','precision','timeZone']);const timeZone=zone(value.timeZone);
 if(!Number.isFinite(now.getTime()))fail();
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`;
 if(value.precision==='unknown'?value.on!==null:value.precision!=='day'||!day(value.on)||value.on>today)fail();
 return {...value,timeZone};
}
