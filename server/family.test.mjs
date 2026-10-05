import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';

import {createFamilyHandler,validateFamily} from './family.mjs';

const student={id:'student-1',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'',color:'peach'};

test('first registration saves account and student together and retries without duplicates',async()=>{
 const {pool,run}=await fixture();
 try{
  const input={action:'complete-onboarding',account:{firstName:'Daniel',email:'',role:'parent'},student};
  const saved=await run('auth0|new',input);
  assert.equal(saved.account.role,'parent');
  assert.equal(saved.account.firstName,'Daniel');assert.equal(saved.students[0].name,'Sofia');
  assert.equal((await run('auth0|new',input)).students.length,1);
  assert.throws(()=>validateFamily({...input,student:{...student,stage:'invalid'}}),{status:400});
  assert.throws(()=>validateFamily({...input,account:{firstName:' ',email:''}}),{status:400});
  const skipped=await run('auth0|later',{action:'complete-onboarding',account:{firstName:'Alex',email:'',role:'student'}});
  assert.equal(skipped.account.firstName,'Alex');assert.equal(skipped.students.length,0);
  assert.equal(skipped.account.role,'student');
 }finally{await pool.end();}
});

test('registration requires an explicit role and account role persists without settings erasing it',async()=>{
 const {pool,run}=await fixture();
 try{
  for(const role of [undefined,null,'admin','Parent',''])assert.throws(()=>validateFamily({action:'complete-onboarding',account:{firstName:'Alex',email:'',role}}),{status:400});
  await run('auth0|student',{action:'complete-onboarding',account:{firstName:'Alex',email:'',role:'student'}});
  assert.equal((await run('auth0|student',{action:'load'})).account.role,'student');
  assert.equal((await run('auth0|student',{action:'save-account',account:{firstName:'Alexis',email:''}})).account.role,'student');
  assert.equal((await run('auth0|student',{action:'save-account',account:{firstName:'Alexis',email:'',role:'parent'}})).account.role,'parent');
  assert.equal((await run('auth0|other',{action:'load'})).account.role,undefined);
  await run('auth0|student',{action:'import',source:'mobile',account:{firstName:'Old',email:'',role:'student'},students:[]});
  assert.equal((await run('auth0|student',{action:'load'})).account.role,'parent');
 }finally{await pool.end();}
});

test('family queries isolate accounts, including forged ownership and matching student IDs',async()=>{
 const {pool,run}=await fixture();
 try{
  await run('auth0|one',{action:'save-account',account:{firstName:'Daniel',email:'daniel@example.com'}});
  await run('auth0|one',{action:'save-student',student});
  const other=await run('auth0|two',{action:'load',subject:'auth0|one',accountId:'forged'});
  assert.deepEqual(other,{account:{firstName:'',email:'',welcomeHeard:false,usedVoice:false},students:[]});
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

test('profile edits retain every supported field and account excludes unsupported personal fields',async()=>{
 const {pool,run}=await fixture();
 try{
  const saved=await run('auth0|one',{action:'save-student',student:{...student,entryTerm:'Fall 2027',institutions:'UC Davis',notes:'Shared by parent',goals:'Engineering'}});
  assert.equal(saved.students[0].entryTerm,'Fall 2027');assert.equal(saved.students[0].notes,'Shared by parent');
  const account=await run('auth0|one',{action:'save-account',account:{firstName:'  Daniel ',email:' a@example.com ',phoneNumber:'not-stored',lastName:'not-stored'}});
  assert.deepEqual(account.account,{firstName:'Daniel',email:'a@example.com',welcomeHeard:false,usedVoice:false});
 }finally{await pool.end();}
});

test('voice usage and welcome receipts persist separately per account and cannot be erased by profile edits',async()=>{
 const {pool,run}=await fixture();
 try{
  let result=await run('auth0|one',{action:'voice-used'});
  assert.equal(result.account.usedVoice,true);assert.equal(result.account.welcomeHeard,false);
  await run('auth0|one',{action:'welcome-heard'});
  await run('auth0|one',{action:'welcome-heard'});
  result=await run('auth0|one',{action:'save-account',account:{firstName:'Daniel',email:'',welcomeHeard:false,usedVoice:false}});
  assert.equal(result.account.welcomeHeard,true);assert.equal(result.account.usedVoice,true);
  assert.equal((await run('auth0|one',{action:'load'})).account.welcomeHeard,true);
  assert.equal((await run('auth0|two',{action:'load',subject:'auth0|one'})).account.welcomeHeard,false);
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

test('account settings cannot erase the name used to recognize completed onboarding',()=>{
 for(const firstName of ['', '   '])assert.throws(()=>validateFamily({action:'save-account',account:{firstName,email:''}}),{status:400});
 assert.equal(validateFamily({action:'save-account',account:{firstName:' Alex ',email:''}}).account.firstName,'Alex');
});
