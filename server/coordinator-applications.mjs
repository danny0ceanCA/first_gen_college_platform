const fail=()=>Object.assign(new Error('invalid_coordinator_request'),{status:400});
export const applicationActions=['application-status','submit-application','withdraw-application','applications','application-organizations','approve-application','decline-application'];
export const applicantActions=applicationActions.slice(0,3);
export function validateApplication(input){
 const out={action:input.action};
 const text=(key,max)=>{if(typeof input[key]!=='string'||!input[key].trim()||input[key].trim().length>max||/[\x00-\x1f]/.test(input[key]))throw fail();out[key]=input[key].trim();};
 const uuid=key=>{if(typeof input[key]!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input[key]))throw fail();out[key]=input[key];};
 if(out.action==='submit-application'){
  for(const [key,max] of [['displayName',100],['organizationName',200],['organizationWebsite',2000],['jobRole',200]])text(key,max);
  let url;try{url=new URL(out.organizationWebsite);}catch{throw fail();}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw fail();
  out.organizationWebsite=url.href;
 }
 if(['applications','application-organizations'].includes(out.action)&&input.after)uuid('after');
 if(['withdraw-application','application-organizations'].includes(out.action))uuid('id');
 if(out.action==='application-organizations'&&input.search)text('search',200);
 if(['approve-application','decline-application'].includes(out.action)){uuid('id');text('reviewNote',1000);}
 if(out.action==='approve-application')uuid('institutionId');
 return out;
}
export async function runApplicationCommand(database,input){
 return (await database.query('SELECT origen_coordinator_application_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result;
}
