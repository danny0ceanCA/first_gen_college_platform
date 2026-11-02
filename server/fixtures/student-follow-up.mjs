import {randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './coordinator-pilot.mjs';
import {createPlanRepository,validatePlan} from '../plans.mjs';
const schedule={onOrAfter:null,timeZone:'America/Chicago'};
export async function studentFollowUpFixture(t){
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true});t.after(()=>f.close());
 Object.assign(f.env,{ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_PERSONALIZATION_MODE:'on'});
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
 const d=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:'Which insurance documents are accepted?',entries:[]})).request;
 const p=(await student({action:'preview',id:d.id,version:1,wording:'original'})).preview;
 const request=(await student({action:'submit',id:d.id,version:1,previewId:p.id,digest:p.digest,confirmed:true})).request;await f.sweep();
 const reply=(version=0)=>staff({action:'respond',id:request.id,publicationId:request.publication.id,version,operationId:randomUUID(),guidance:'PRIVATE_RESPONSE_NOT_COPIED: Check with the campus.',suggestedAction:'Ask which proof is accepted.',followUpOn:'2099-01-01'});await reply();await f.sweep();
 const source={kind:'review-response',requestId:request.id,responseVersion:1};
 const plans=(input={action:'load',studentId:'alex'})=>f.as('other',()=>createPlanRepository(f.db,f.env)('other',validatePlan(input)));
 const plan=(await plans({action:'create',requestId:randomUUID(),fromResponse:{source,stepId:'accepted',confirmed:true},plan:{studentId:'alex',title:'My own next step',goal:'',category:'financial',status:'active',summaryIds:[],steps:[{id:'accepted',title:'Ask the office',action:'Ask the insurance office which proof is accepted.',notes:'PRIVATE_PLAN_NOT_SHARED',status:'not-started',dueDate:'2099-01-01',sources:[]},{id:'sibling',title:'Another task',action:'Private unrelated action.',notes:'',status:'not-started',dueDate:null,sources:[]}]}})).plans[0];
 const target={planId:plan.id,stepId:'accepted'};
 const call=(input,subject='other')=>f.call(subject,'/api/student-follow-up',{studentId:'alex',target,...input});
 const load=()=>call({action:'load'});
 const prepare=async(extra={})=>(await call({action:'prepare',operationId:randomUUID(),revision:(await load()).revision,planVersion:(await plans()).plans[0].version,schedule,language:'en',...extra})).preview;
 const confirmInput=preview=>({action:'confirm',operationId:randomUUID(),previewId:preview.id,digest:preview.digest,confirmed:true});
 const enroll=async()=>{f.env.ORIGEN_STUDENT_FOLLOW_UP='true';return call(confirmInput(await prepare()));};
 const edit=async change=>{const current=(await plans()).plans[0];return (await plans({action:'update',id:current.id,version:current.version,plan:change(structuredClone(current))})).plans[0];};
 const seedReport=async()=>{const id=randomUUID();await f.owner.query("INSERT INTO origen_student_follow_up_reports(account_id,student_id,id,plan_id,step_id,response_state,reported_action,reported_outcome,detail,time_zone) VALUES($1,'alex',$2,$3,'accepted','answered','completed','pending','PRIVATE_REPORT_SENTINEL','America/Chicago')",[account,id,plan.id]);return id;};
 return {...f,httpRequest:f.request,httpCall:f.call,account,connection,student,staff,reply,request,source,plans,plan,target,call,load,prepare,confirmInput,enroll,edit,seedReport};
}
