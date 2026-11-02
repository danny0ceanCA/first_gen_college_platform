import {randomUUID} from 'node:crypto';
import {outcomeAssessmentFixture} from './outcome-assessment.mjs';
import {runAsCoordinatorActor} from '../account-isolation.mjs';
export async function outcomeEvaluationFixture(t,{historical=false}={}){
 const f=await outcomeAssessmentFixture(t);f.env.ORIGEN_OUTCOME_EVALUATION='true';
 const saved=await f.record({eventOn:'2026-10-01',statement:'PRIVATE_EVALUATION_SENTINEL: I submitted the letter.'});
 if(historical){
  // Synthetic fixture only: insert the same episode as a historical record.
  // Keep normal database guards active; do this before any evaluation approval.
  const episode=(await f.owner.query('SELECT to_jsonb(e) AS row FROM origen_outcome_episodes e WHERE id=$1',[saved.episodeId])).rows[0].row;
  const evidence=(await f.owner.query('SELECT to_jsonb(v) AS row FROM origen_outcome_evidence v WHERE episode_id=$1',[saved.episodeId])).rows.map(r=>r.row);
  const at=(await f.owner.query("SELECT (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 day') AT TIME ZONE 'UTC' AS at")).rows[0].at;
  await f.owner.query('DELETE FROM origen_outcome_episodes WHERE id=$1',[saved.episodeId]);
  await f.owner.query('INSERT INTO origen_outcome_episodes SELECT * FROM jsonb_populate_record(NULL::origen_outcome_episodes,$1::jsonb)',[JSON.stringify({...episode,recorded_at:at})]);
  for(const row of evidence)await f.owner.query('INSERT INTO origen_outcome_evidence SELECT * FROM jsonb_populate_record(NULL::origen_outcome_evidence,$1::jsonb)',[JSON.stringify(row)]);
 }
 const command=(input,actor='other')=>f.httpCall(actor,'/api/outcome-evaluation',{purpose:'service_quality',contractVersion:1,studentId:'alex',episodeId:saved.episodeId,...input});
 const prepare=async()=>{const v=(await command({action:'load'})).permission?.version||0;return (await command({action:'prepare',version:v,operationId:randomUUID()})).preview;};
 const confirm=p=>command({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true});
 const grantEvaluation=valid=>f.owner.query("SELECT origen_outcome_evaluation_grant($1,$2,CASE WHEN $3 THEN clock_timestamp()+interval '30 days' ELSE NULL END)",[f.org,f.coordinator,valid]);
 const report=(extra={},actor='staff')=>f.httpCall(actor,'/api/outcome-evaluation-report',{action:'report',organizationId:f.org,definitionId:'document_submitted',purpose:'service_quality',contractVersion:1,...extra});
 const bundle=()=>f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},async()=>{
  const c=await f.db.connect();try{return(await c.query('SELECT origen_service_quality_command($1::jsonb) AS result',[JSON.stringify({action:'load',organizationId:f.org,definitionId:'document_submitted',purpose:'service_quality',contractVersion:1,enabled:true})])).rows[0].result;}finally{c.release();}
 }));
 return {...f,saved,command,prepareEvaluation:prepare,confirmEvaluation:confirm,grantEvaluation,qualityReport:report,qualityBundle:bundle};
}
