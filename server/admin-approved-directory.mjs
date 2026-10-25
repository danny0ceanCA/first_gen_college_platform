const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function adminApprovedDirectory(database,input){
 const invalid=()=>Object.assign(new Error('invalid_directory_filter'),{status:400});
 if(input.action==='coordinator-overview'){
  if(typeof input.id!=='string'||!uuid.test(input.id)||![7,30,90].includes(input.days??30))throw invalid();
 }else if(!['organizations','coordinators'].includes(input.kind)||typeof(input.search??'')!=='string'||(input.search??'').length>200||/[\x00-\x1f\x7f]/.test(input.search??'')||(input.after&& (typeof input.after!=='string'||!uuid.test(input.after))))throw invalid();
 const args=input.action==='coordinator-overview'?{action:input.action,id:input.id,days:input.days??30}:{action:'approved-directory',kind:input.kind,search:(input.search??'').trim(),after:input.after||null};
 const result=(await database.query('SELECT origen_admin_approved_directory($1::jsonb) AS result',[JSON.stringify(args)])).rows[0]?.result;
 if(!result)throw Object.assign(new Error('coordinator_not_found'),{status:404});
 return result;
}
