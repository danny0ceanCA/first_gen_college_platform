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
  return {firstName,email};
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
  case 'save-account':return {action:input.action,account:account(input.account)};
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

export function createFamilyRepository(database){
 return async(subject,input)=>{
  const client=await database.connect();let transaction=false;
  try{
   await client.query('BEGIN');transaction=true;
   await client.query('INSERT INTO origen_accounts(auth0_subject) VALUES ($1) ON CONFLICT (auth0_subject) DO NOTHING',[subject]);
   const accountRow=(await client.query('SELECT id, first_name, email FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0];
   const owner=accountRow.id;
   const saveStudent=async(student,importing=false)=>{
    const values=[owner,student.id,...Object.keys(profileFields).map(field=>student[field])];
    await client.query(`INSERT INTO origen_students(account_id,id,${columns.join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (account_id,id) ${importing?'DO NOTHING':`DO UPDATE SET ${columns.map(c=>`${c}=EXCLUDED.${c}`).join(',')}, updated_at=now()`}`,values);
   };
   if(input.action==='save-account')await client.query('UPDATE origen_accounts SET first_name=$2,email=$3,updated_at=now() WHERE id=$1',[owner,input.account.firstName,input.account.email]);
   if(input.action==='save-student')await saveStudent(input.student);
   if(input.action==='delete-student'){
    const result=await client.query('DELETE FROM origen_students WHERE account_id=$1 AND id=$2 RETURNING id',[owner,input.id]);
    if(!result.rows.length)notFound();
   }
   if(input.action==='import'){
    const receipt=await client.query('INSERT INTO origen_local_imports(account_id,source) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING source',[owner,input.source]);
    if(receipt.rows.length){
     for(const student of input.students)await saveStudent(student,true);
     await client.query("UPDATE origen_accounts SET first_name=CASE WHEN first_name='' THEN $2 ELSE first_name END, email=CASE WHEN email='' THEN $3 ELSE email END, updated_at=now() WHERE id=$1",[owner,input.account.firstName,input.account.email]);
    }
   }
   const row=(await client.query('SELECT first_name,email FROM origen_accounts WHERE id=$1',[owner])).rows[0];
   const students=(await client.query(`SELECT id, name, stage, interest, gpa, color, institutions, entry_term AS "entryTerm", school, activities, goals, needs, notes FROM origen_students WHERE account_id=$1 ORDER BY created_at,id`,[owner])).rows;
   await client.query('COMMIT');transaction=false;
   return {account:{firstName:row.first_name,email:row.email},students};
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
  }catch(error){return send(error.status===400||error.status===404?error.status:503,{error:error.status===400||error.status===404?error.message:'database_unavailable'});}
 };
}
