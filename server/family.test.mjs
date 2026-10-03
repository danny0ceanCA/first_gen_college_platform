import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {newDb,DataType} from 'pg-mem';
import {createFamilyHandler,createFamilyRepository,validateFamily} from './family.mjs';

async function fixture(){
 const db=newDb();
 db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:()=>crypto.randomUUID()});
 db.public.registerFunction({name:'btrim',args:[DataType.text],returns:DataType.text,implementation:value=>value.trim()});
 db.public.registerFunction({name:'length',args:[DataType.text],returns:DataType.integer,implementation:value=>value.length});
 db.public.registerFunction({name:'jsonb_typeof',args:[DataType.jsonb],returns:DataType.text,implementation:value=>Array.isArray(value)?'array':typeof value});
 for(const name of ['001_family_storage.sql','002_local_imports.sql'])db.public.none(await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8'));
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 return {pool,run:(subject,input)=>createFamilyRepository(pool)(subject,validateFamily(input))};
}
const student={id:'student-1',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'',color:'peach'};

test('family queries isolate accounts, including forged ownership and matching student IDs',async()=>{
 const {pool,run}=await fixture();
 try{
  await run('auth0|one',{action:'save-account',account:{firstName:'Daniel',email:'daniel@example.com'}});
  await run('auth0|one',{action:'save-student',student});
  const other=await run('auth0|two',{action:'load',subject:'auth0|one',accountId:'forged'});
  assert.deepEqual(other,{account:{firstName:'',email:''},students:[]});
  await assert.rejects(run('auth0|two',{action:'delete-student',id:student.id}),{status:404});
  await run('auth0|two',{action:'save-student',student:{...student,name:'Mateo',account_id:'forged'}});
  assert.equal((await run('auth0|one',{action:'load'})).students[0].name,'Sofia');
  assert.equal((await run('auth0|two',{action:'load'})).students[0].name,'Mateo');
  await run('auth0|one',{action:'delete-student',id:student.id});
  assert.equal((await run('auth0|two',{action:'load'})).students.length,1);
 }finally{await pool.end();}
});

test('one-time import preserves server edits and does not resurrect deleted students',async()=>{
 const {pool,run}=await fixture();
 const input={action:'import',source:'web',account:{firstName:'Local',email:'local@example.com'},students:[student]};
 try{
  await run('auth0|one',{action:'save-account',account:{firstName:'Server',email:'server@example.com'}});
  await run('auth0|one',{action:'save-student',student:{...student,name:'Server Sofia'}});
  const imported=await run('auth0|one',input);
  assert.equal(imported.account.firstName,'Server');assert.equal(imported.students[0].name,'Server Sofia');
  await run('auth0|one',{action:'delete-student',id:student.id});
  assert.equal((await run('auth0|one',input)).students.length,0);
  assert.equal((await run('auth0|two',input)).students[0].name,'Sofia');
 }finally{await pool.end();}
});

test('profile edits retain every supported field and account stores only first name/email',async()=>{
 const {pool,run}=await fixture();
 try{
  const saved=await run('auth0|one',{action:'save-student',student:{...student,entryTerm:'Fall 2027',institutions:'UC Davis',notes:'Shared by parent',goals:'Engineering'}});
  assert.equal(saved.students[0].entryTerm,'Fall 2027');assert.equal(saved.students[0].notes,'Shared by parent');
  const account=await run('auth0|one',{action:'save-account',account:{firstName:'  Daniel ',email:' a@example.com ',phoneNumber:'not-stored',lastName:'not-stored'}});
  assert.deepEqual(account.account,{firstName:'Daniel',email:'a@example.com'});
 }finally{await pool.end();}
});

test('invalid fields are rejected before opening a database connection',()=>{
 for(const input of [{action:'save-student',student:{...student,name:' '}},{action:'save-student',student:{...student,stage:'invented'}},{action:'save-student',student:{...student,gpa:'x'.repeat(31)}},{action:'save-account',account:{firstName:'Test',email:'invalid'}},{action:'import',source:'web',account:{firstName:'',email:''},students:[student,student]}])assert.throws(()=>validateFamily(input),{status:400});
});

async function request(handler,input,{authorized=true,subject='auth0|one'}={}){
 const req=Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/family',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:authorized,origenIdentity:{sub:subject}});
 let status,body;await handler(req,{writeHead:code=>status=code,end:text=>body=JSON.parse(text)},()=>assert.fail('route'));
 return {status,body};
}
test('family handler requires gateway authentication and hides database details',async()=>{
 const handler=createFamilyHandler(null,()=>{throw new Error('private database credentials');});
 assert.equal((await request(handler,{action:'load'},{authorized:false})).status,401);
 assert.deepEqual(await request(handler,{action:'load'}),{status:503,body:{error:'database_unavailable'}});
 assert.equal((await request(createFamilyHandler(null),{action:'load'})).status,503);
 const observed=[];
 await request(createFamilyHandler(null,async(subject,input)=>{observed.push({subject,input});return {account:{firstName:'',email:''},students:[]};}),{action:'load',subject:'auth0|victim'});
 assert.deepEqual(observed,[{subject:'auth0|one',input:{action:'load'}}]);
});
