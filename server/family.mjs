import {progressEnabled,observeProfile} from './progress-history.mjs';
import {safeErrorCode} from './api-logging.mjs';
import {accountClosed} from './account-lifecycle.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {sharedColumns} from './account-links.mjs';
const profileFields={name:100,stage:40,interest:2000,gpa:30,color:40,institutions:2000,entryTerm:2000,school:2000,activities:2000,goals:2000,needs:2000,notes:2000};
const columns=['name','stage','interest','gpa','color','institutions','entry_term','school','activities','goals','needs','notes'];
const stages=['','9th grade','10th grade','11th grade','12th grade','Community college','College'];
const invalid=()=>{throw Object.assign(new Error('invalid_family_request'),{status:400});};
const notFound=()=>{throw Object.assign(new Error('student_not_found'),{status:404});};
export function validateFamily(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return invalid();
 const account=value=>{
  if(!value||typeof value.firstName!=='string'||typeof value.email!=='string')return invalid();
  const firstName=value.firstName.trim(),email=value.email.trim();
  if(firstName.length>100||email.length>320||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return invalid();
  if(value.role!==undefined&&!['parent','student'].includes(value.role))return invalid();
  return {firstName,email,...(value.role===undefined?{}:{role:value.role})};
 };
 const id=value=>{if(typeof value!=='string'||!value.trim()||value.length>128)return invalid();return value;};
 const student=value=>{
  if(!value||typeof value!=='object')return invalid();
  const out={id:id(value.id)};
  for(const [field,max] of Object.entries(profileFields)){
   const text=value[field]??(field==='color'?'peach':'');
   if(typeof text!=='string'||text.length>max)return invalid();out[field]=text;
  }
  out.name=out.name.trim();if(!out.name||!stages.includes(out.stage))return invalid();
  return out;
 };
 switch(input.action){
  case 'load':return {action:'load'};
  case 'onboarding-start':return {action:'onboarding-start'};
  case 'voice-used':return {action:'voice-used'};
  case 'welcome-heard':return {action:'welcome-heard'};
  case 'save-account':{const details=account(input.account);if(!details.firstName)return invalid();return {action:input.action,account:details};}
  case 'complete-onboarding':{
   const details=account(input.account);if(!details.firstName||!details.role)return invalid();
   return {action:input.action,account:details,...(input.student===undefined?{}:{student:student(input.student)})};
  }
  case 'save-student':return {action:input.action,student:student(input.student)};
  case 'delete-student':return {action:input.action,id:id(input.id)};
  case 'import':{
   if(!['web','mobile'].includes(input.source)||!Array.isArray(input.students)||input.students.length>100)return invalid();
   const students=input.students.map(student);
   if(new Set(students.map(s=>s.id)).size!==students.length)return invalid();
   return {action:'import',source:input.source,account:account(input.account),students};
  }
  default:return invalid();
 }
}

export function createFamilyRepository(database,env=process.env){
 return async(subject,input)=>{
  const client=await database.connect();let transaction=false;
  try{
   await client.query('BEGIN');transaction=true;
   await guardAccountTransaction(client,subject);
   await client.query('INSERT INTO origen_accounts(auth0_subject) VALUES ($1) ON CONFLICT (auth0_subject) DO NOTHING',[subject]);
   const accountRow=(await client.query('SELECT id, first_name, email FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
   const owner=accountRow.id;
   if(await accountClosed(client,subject))throw Object.assign(new Error('account_closed'),{status:403});
   const saveStudent=async(student,importing=false)=>{
    const link=(await client.query('SELECT * FROM origen_student_links WHERE member_account_id=$1 AND member_student_id=$2 FOR UPDATE',[owner,student.id])).rows[0];
    if(link){
     if(importing)return;
     const sharedFields=Object.keys(profileFields).filter(field=>!['needs','notes'].includes(field));
     const sharedHistory=progressEnabled(env)?await observeProfile(client,link.owner_account_id,link.owner_student_id,Object.fromEntries(sharedColumns.map((column,i)=>[column,student[sharedFields[i]]]).filter(([column])=>!['name','color'].includes(column))),'linked-account'):null;
     await client.query(`UPDATE origen_students SET ${sharedColumns.map((c,i)=>`${c}=$${i+3}`).join(',')},updated_at=now() WHERE account_id=$1 AND id=$2`,[link.owner_account_id,link.owner_student_id,...sharedFields.map(field=>student[field])]);
     // Private annotations belong to the signed-in account, never the other person.
     await client.query('UPDATE origen_students SET needs=$3,notes=$4,updated_at=now() WHERE account_id=$1 AND id=$2',[owner,student.id,student.needs,student.notes]);
     await sharedHistory?.();
     return;
    }
    const values=[owner,student.id,...Object.keys(profileFields).map(field=>student[field])];
    const history=progressEnabled(env)?await observeProfile(client,owner,student.id,Object.fromEntries(columns.filter(column=>!['name','color','needs','notes'].includes(column)).map(column=>[column,student[column==='entry_term'?'entryTerm':column]])),importing?'imported':'user-reported'):null;
    const existed=importing?(await client.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,student.id])).rows.length:false;
    await client.query(`INSERT INTO origen_students(account_id,id,${columns.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (account_id,id) ${importing?'DO NOTHING':`DO UPDATE SET ${columns.map(c=>`${c}=EXCLUDED.${c}`).join(',')}, updated_at=now()`}`,values);
    if(!existed)await history?.();
   };
   if(input.action==='save-account'||input.action==='complete-onboarding')await client.query('UPDATE origen_accounts SET first_name=$2,email=$3,updated_at=now() WHERE id=$1',[owner,input.account.firstName,input.account.email]);
   if((input.action==='save-account'||input.action==='complete-onboarding')&&input.account.role)await client.query('UPDATE origen_accounts SET role=$2 WHERE id=$1',[owner,input.account.role]);
   if(input.action==='complete-onboarding'&&input.student)await saveStudent(input.student);
   if(input.action==='onboarding-start')await client.query('UPDATE origen_accounts SET onboarding_started_at=COALESCE(onboarding_started_at,now()) WHERE id=$1',[owner]);
   if(input.action==='complete-onboarding')await client.query('UPDATE origen_accounts SET onboarding_completed_at=COALESCE(onboarding_completed_at,now()) WHERE id=$1',[owner]);
   if(input.action==='save-student')await saveStudent(input.student);
   if(input.action==='delete-student'){
    if((await client.query('SELECT id FROM origen_student_links WHERE owner_account_id=$1 AND owner_student_id=$2',[owner,input.id])).rows.length)throw Object.assign(new Error('unlink_before_deleting'),{status:409});
    const result=await client.query('DELETE FROM origen_students WHERE account_id=$1 AND id=$2 RETURNING id',[owner,input.id]);
    if(!result.rows.length)notFound();
   }
   if(input.action==='import'){
    const receipt=await client.query('INSERT INTO origen_local_imports(account_id,source) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING source',[owner,input.source]);
    if(receipt.rows.length){
     for(const student of input.students)await saveStudent(student,true);
     await client.query("UPDATE origen_accounts SET first_name=CASE WHEN first_name='' THEN $2 ELSE first_name END, email=CASE WHEN email='' THEN $3 ELSE email END, updated_at=now() WHERE id=$1",[owner,input.account.firstName,input.account.email]);
     if(input.account.role)await client.query('UPDATE origen_accounts SET role=COALESCE(role,$2) WHERE id=$1',[owner,input.account.role]);
    }
   }
   if(input.action==='voice-used'||input.action==='welcome-heard')await client.query('UPDATE origen_accounts SET voice_used_at=COALESCE(voice_used_at,now()),updated_at=now() WHERE id=$1',[owner]);
   if(input.action==='welcome-heard')await client.query('UPDATE origen_accounts SET welcome_heard_at=COALESCE(welcome_heard_at,now()) WHERE id=$1',[owner]);
   const row=(await client.query('SELECT first_name,email,role,welcome_heard_at,voice_used_at FROM origen_accounts WHERE id=$1',[owner])).rows[0];
   const students=(await client.query(`SELECT m.id,${sharedColumns.map(c=>`COALESCE(s.${c},m.${c}) AS "${c==='entry_term'?'entryTerm':c}"`).join(',')},m.needs,m.notes FROM origen_students m LEFT JOIN origen_student_links l ON l.member_account_id=m.account_id AND l.member_student_id=m.id LEFT JOIN origen_students s ON s.account_id=l.owner_account_id AND s.id=l.owner_student_id WHERE m.account_id=$1 ORDER BY m.created_at,m.id`,[owner])).rows;
   await client.query('COMMIT');transaction=false;
   return {account:{firstName:row.first_name,email:row.email,...(row.role?{role:row.role}:{}),welcomeHeard:!!row.welcome_heard_at,usedVoice:!!row.voice_used_at},students};
  }catch(error){if(transaction)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 };
}

export function createFamilyHandler(database,repository=database?createFamilyRepository(database):null){
 return async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/api/family')return next();
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(!req.origenAuthorized||typeof req.origenIdentity?.sub!=='string')return send(401,{error:'authentication_required'});
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!repository)return send(503,{error:'database_not_ready'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2_000_000)return send(413,{error:'request_too_large'});}
   let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_family_request'});}
   const operation=validateFamily(input);
   return send(200,await repository(req.origenIdentity.sub,operation));
  }catch(error){const known=[400,403,404,409].includes(error.status);if(!known)req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'database_unavailable'});}
 };
}
