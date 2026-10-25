import {normalizeCoordinatorWebsite} from '../src/coordinatorWebsite.mjs';
const fail=()=>Object.assign(new Error('invalid_coordinator_request'),{status:400});
export const applicantActions=['application-status','submit-application','withdraw-application','save-organization-registration'];
export const applicationActions=[...applicantActions,'applications','application-organizations','approve-application','decline-application'];
export function validateApplication(input){
 const out={action:input.action};
 const text=(key,max,multiline=false)=>{if(typeof input[key]!=='string'||!input[key].trim()||input[key].trim().length>max||(multiline?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/:/[\x00-\x1f]/).test(input[key]))throw fail();out[key]=input[key].trim();};
 const uuid=key=>{if(typeof input[key]!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input[key]))throw fail();out[key]=input[key];};
 if(out.action==='submit-application'){
  for(const [key,max] of [['displayName',100],['organizationName',200],['jobRole',200]])text(key,max);
  try{out.organizationWebsite=normalizeCoordinatorWebsite(input.organizationWebsite);}catch{throw fail();}
 }
 if(out.action==='save-organization-registration'||out.action==='submit-application'&&input.organizationRegistration!==undefined){
  const draft=input.organizationRegistration;
  if(!draft||draft.authorized!==true||typeof draft.description!=='string'||!draft.description.trim()||draft.description.trim().length>5000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(draft.description))throw fail();
  out.organizationRegistration={description:draft.description.trim(),authorized:true};
 }
 if(['applications','application-organizations'].includes(out.action)&&input.after)uuid('after');
 if(['withdraw-application','application-organizations','save-organization-registration'].includes(out.action))uuid('id');
 if(out.action==='application-organizations'&&input.search)text('search',200);
 if(['approve-application','decline-application'].includes(out.action)){uuid('id');text('reviewNote',1000,true);}
 if(out.action==='approve-application')uuid('institutionId');
 return out;
}
export async function runApplicationCommand(database,input){
 return (await database.query('SELECT origen_coordinator_application_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
}
