// Only aggregate, source-bound local verification evidence belongs in this record.
export const outcomeReleaseStages=Object.freeze(['accepted-action','heard-private-readback','private-report','heard-outcome-readback','private-outcome','approved-disclosure','coordinator-observation','audience-assessment','guarded-voice','evaluation-excluded','private-correction','source-invalidation']);
export const outcomeExternalChecks=Object.freeze(['deployed-authentication-and-staff-verification','physical-device-live-and-realtime-listening-interruption-and-audibility','institutional-process-and-definition-review','deployment-database-maintenance-and-restore-rehearsal','evaluation-purpose-notice-and-reviewer-authorization']);
export const outcomeBrowserCounts=Object.freeze({'outcome-connected':12,'outcome-evaluation':6,'outcome-observation':6,'outcome-evidence':6,workflow:12,notebook:6,delivery:6,navigation:7,connected:8,choices:6,followups:6,'student-follow-up':6,'private-follow-up':6,'shared-updates':6,'follow-up-connected':12});
export function outcomeBrowserComplete(record){
 if(record?.kind!=='outcome-evidence-connected-browser-verification'||record.schemaVersion!==1||record.passed!==true||record.syntheticIdentity!==true||record.syntheticSpeech!==true||record.disposablePostgres!==true||!Array.isArray(record.journeys)||record.journeys.length!==12)return false;
 return [1280,390,320].every(width=>['en','es'].every(language=>['live','realtime'].every(entry=>{
  const rows=record.journeys.filter(r=>r?.width===width&&r.language===language&&r.entry===entry);
  return rows.length===1&&rows[0].passed===true&&JSON.stringify(rows[0].stages)===JSON.stringify(outcomeReleaseStages);
 })));
}
const only=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
export function outcomeReleaseComplete(record){
 const fields=['kind','schemaVersion','localOnly','startedAt','sourceFingerprint','disposablePostgres','syntheticIdentity','syntheticSpeech','browserConcurrency','suites','browsers','typecheck','build','logging','sourceUnchanged','passed','productionEnabled','runtime','caseReview','checkedAt','externalChecksNotPerformed'];
 if(!record||Object.keys(record).some(k=>!fields.includes(k))||record.kind!=='outcome-evidence-local-verification'||record.schemaVersion!==1||record.localOnly!==true||record.disposablePostgres!==true||record.syntheticIdentity!==true||record.syntheticSpeech!==true||record.productionEnabled!==false||record.browserConcurrency!==2||!record.sourceUnchanged||!/^[a-f\d]{64}$/.test(record.sourceFingerprint))return false;
 if(!Number.isFinite(Date.parse(record.startedAt))||!Number.isFinite(Date.parse(record.checkedAt))||Date.parse(record.startedAt)>Date.parse(record.checkedAt))return false;
 if(!only(record.suites,['server','operations'])||!only(record.browsers,Object.keys(outcomeBrowserCounts))||!only(record.runtime,['node','postgres','playwright','chromium']))return false;
 if(!['typecheck','build','logging'].every(k=>record[k]===true)||!['server','operations'].every(id=>{const s=record.suites?.[id];return only(s,['tests','pass','fail','skipped','cancelled','todo','passed'])&&s?.passed===true&&Number.isSafeInteger(s.tests)&&s.tests>0&&s.pass===s.tests&&s.fail===0&&s.skipped===0&&s.cancelled===0&&s.todo===0;}))return false;
 if(!Object.entries(outcomeBrowserCounts).every(([id,count])=>only(record.browsers?.[id],['journeys','passed'])&&record.browsers[id].passed===true&&record.browsers[id].journeys===count))return false;
 const c=record.caseReview;if(!only(c,['kind','version','ruleVersion','referenceReview','institutionalReview','passed','cases','matched','disagreements'])||c?.kind!=='outcome-definition-case-review'||c.version!==1||c.ruleVersion!=='outcome-assessment-v1'||c.referenceReview!=='engineering_contract_review'||c.institutionalReview!=='not_performed'||c.passed!==true||!Number.isSafeInteger(c.cases)||c.cases!==26||c.matched!==c.cases||!Array.isArray(c.disagreements)||c.disagreements.length)return false;
 return JSON.stringify(record.externalChecksNotPerformed)===JSON.stringify(outcomeExternalChecks);
}
