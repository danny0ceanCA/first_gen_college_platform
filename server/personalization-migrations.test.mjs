import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createPlanRepository as legacyRepository,validatePlan as legacyValidate} from './fixtures/plans-before-personalization.mjs';

test('043 to current additive migrations support scoped fallback and old plan operations; rollback must retain the new enum-compatible backend',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'origen-old-migrations-'));let f;
 try{
  for(const name of await readdir(new URL('./migrations/',import.meta.url)))if(/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))<=43)await copyFile(new URL('./migrations/'+name,import.meta.url),join(directory,name));
  f=await retrievalFixture({migrationDirectory:pathToFileURL(directory+'/')});
  const p={studentId:'alex',title:'Existing plan',goal:'',category:'education',status:'active',summaryIds:[],steps:[{id:'step',title:'Existing step',action:'Email counselor',notes:'',status:'not-started',dueDate:null,sources:[]}]};
  const oldRun=body=>f.as('reader',()=>legacyRepository(f.db)('reader',legacyValidate(body)));
  const newRun=body=>f.as('reader',()=>createPlanRepository(f.db)('reader',validatePlan(body)));
  const old=(await oldRun({action:'create',plan:p})).plans[0];
  await f.save('previous','Scoped saved summary before migration.');let config,status;
  const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',ORIGEN_PERSONALIZATION_MODE:'on'},async(u,o)=>{config=JSON.parse(o.body.get('session'));return new Response('v=0');},()=>{},f.db);
  const req=Readable.from([JSON.stringify({sdp:'v=0',language:'en',role:'parent',mode:'planning',studentId:'alex',enableLiveMemory:true})]);Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reader'}});
  await f.as('reader',()=>handler(req,{writeHead(s){status=s;},end(){}},()=>{}));assert.equal(status,200);assert.match(config.instructions,/Scoped saved summary before migration/);assert.ok(!config.tools.some(t=>t.name==='save_student_memory'));
  await migrateDatabase(f.owner);await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});await migrateDatabase(f.owner);
  const names=(await f.owner.query("SELECT name FROM origen_schema_migrations WHERE name>='044' AND name<'050' ORDER BY name")).rows.map(r=>r.name);assert.deepEqual(names,['044_student_memory.sql','045_historical_retrieval.sql','046_live_memory.sql','047_adaptive_guidance.sql','048_voice_preparation.sql','049_binder_jobs.sql']);
  assert.equal((await oldRun({action:'load',studentId:'alex'})).plans[0].id,old.id);
  const updated=(await oldRun({action:'update',id:old.id,version:old.version,plan:{...old,title:'Updated by old backend'}})).plans[0];assert.equal(updated.title,'Updated by old backend');
  const current=(await newRun({action:'update',id:updated.id,version:updated.version,plan:{...updated,category:'applications',steps:[{...updated.steps[0],status:'deferred'}]}})).plans[0];
  assert.equal((await oldRun({action:'load',studentId:'alex'})).plans[0].steps[0].status,'deferred');
  assert.throws(()=>legacyValidate({action:'update',id:current.id,version:current.version,plan:current}),{status:400});
  const resumed=(await newRun({action:'update',id:current.id,version:current.version,plan:{...current,steps:[{...current.steps[0],status:'not-started'}]}})).plans[0];assert.equal(resumed.category,'applications');
  assert.equal((await f.history({action:'load',studentId:'alex'})).items[0].id,'previous');
 }finally{await f?.close();await rm(directory,{recursive:true,force:true});}
});
