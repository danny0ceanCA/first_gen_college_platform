import {randomUUID} from 'node:crypto';
import {actionLibraryFixture} from './recommendation-library.mjs';
import {createRecommendationDeliveryRepository} from '../recommendation-delivery.mjs';
import {runAsCoordinatorActor} from '../account-isolation.mjs';
export async function recommendationEvaluationFixture(t){
 const f=await actionLibraryFixture(t);Object.assign(f.env,{ORIGEN_OUTCOME_EVIDENCE:'true',ORIGEN_RECOMMENDATION_EVALUATION:'true'});await f.grant();const template=await f.create();await f.publish(template.id,1);
 const command=(input,actor='other')=>f.httpCall(actor,'/api/recommendation-evaluation',{purpose:'recommendation_evaluation',contractVersion:1,studentId:'alex',...input});
 const prepare=async()=>{const state=await command({action:'load'});return(await command({action:'prepare',organizationId:f.org,version:state.permission?.version||0,operationId:randomUUID()})).preview;};
 const confirm=p=>command({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true});
 const consent=async()=>confirm(await prepare());
 const deliver=input=>f.as('other',()=>createRecommendationDeliveryRepository(f.db,f.env)('other',{studentId:'alex',...input}));
 const choose=()=>deliver({action:'select',request:{language:'en',intent:'next_action',goal:'understand_requirement',process:'office_contact',focus:null,episodes:[],timeZone:'America/Chicago'},answers:{document_requested:'unknown',document_prepared:'unknown',submission_reported:'unknown',decision_pending:'unknown'}});
 const receipts=async()=>(await f.owner.query('SELECT * FROM origen_recommendation_evaluation_receipts ORDER BY created_at')).rows;
 const reviewer=async()=>{const id=(await f.owner.query("SELECT id FROM origen_coordinator_profiles WHERE institution_id=$1 AND auth0_subject='staff'",[f.org])).rows[0].id;await f.owner.query("SELECT origen_recommendation_evaluation_grant($1,$2,clock_timestamp()+interval '30 days')",[f.org,id]);return id;};
 const report=(input={},actor='staff')=>f.httpCall(actor,'/api/recommendation-evaluation-report',{action:'report',purpose:'recommendation_evaluation',contractVersion:1,organizationId:f.org,...input});
 const bundle=()=>f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},async()=>(await f.db.query('SELECT origen_recommendation_evaluation_report($1::jsonb) AS result',[JSON.stringify({action:'load',purpose:'recommendation_evaluation',contractVersion:1,organizationId:f.org,enabled:true})])).rows[0].result));
 const previousMonth=async()=>{await f.owner.query("UPDATE origen_recommendation_evaluation_permissions SET started_at=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '10 days'");await f.owner.query("UPDATE origen_recommendation_evaluation_receipts SET created_at=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '2 days'");};
 return {...f,template,command,prepareEvaluation:prepare,confirmEvaluation:confirm,consent,deliver,choose,receipts,reviewer,report,bundle,previousMonth};
}
