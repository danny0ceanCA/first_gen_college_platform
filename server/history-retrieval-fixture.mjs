import {createTestLogin,useTestLogin} from './fixtures/postgres-test-login.mjs';
// Synthetic PostgreSQL fixture. All objects and roles are disposable; callers
// must supply DATABASE_TEST_URL, never the application DATABASE_URL.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {isolateDatabase,runAsAccount,assertRuntimeIsolation} from './account-isolation.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createHistoryRepository} from './history.mjs';
import {createMemoryRepository} from './student-memory.mjs';
import {createTopicRepository,validateTopicRequest} from './topic-notes.mjs';
import {retrieveStudentHistory} from './history-retrieval.mjs';

export async function retrievalFixture({migrationDirectory,runtimePoolSize=3,productionTimeouts=false}={}){
 if(!Number.isInteger(runtimePoolSize)||runtimePoolSize<1||runtimePoolSize>30)throw new Error('invalid_test_pool_size');
 if(!process.env.DATABASE_TEST_URL)throw new Error('DATABASE_TEST_URL required');
 const suffix=randomUUID().replaceAll('-',''),schema=`recall_${suffix}`,role=`recall_user_${suffix}`;
 const owner=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:2,options:`-c search_path=${schema}`});let runtime;
 const close=async()=>{await runtime?.end();await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`);await owner.end();};
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await createTestLogin(owner,role);
  await migrateDatabase(owner,migrationDirectory);await grantRuntimeAccess(owner,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);useTestLogin(url,role);runtime=new pg.Pool({connectionString:url.href,max:runtimePoolSize,...(productionTimeouts?{statement_timeout:15000,connectionTimeoutMillis:5000}:{}),options:`-c search_path=${schema}`});await assertRuntimeIsolation(runtime,{schema});
  const db=isolateDatabase(runtime,{schema}),as=(sub,work)=>runAsAccount({sub},work);
  const family=(sub,input)=>as(sub,()=>createFamilyRepository(db)(sub,validateFamily(input)));
  for(const sub of ['reader','other']){
   await family(sub,{action:'save-account',account:{firstName:'Synthetic',email:'',role:sub==='reader'?'parent':'student'}});
   for(const id of ['alex','sam'])await family(sub,{action:'save-student',student:{id,name:id,stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
  }
  const history=(input,sub='reader')=>as(sub,()=>createHistoryRepository(db)(sub,input));
  return {owner,runtime,db,schema,role,as,family,history,close,
   save:(id,content,{studentId='alex',sub='reader',date='2020-01-01T00:00:00Z',mode='planning'}={})=>history({action:'save',item:{id,studentId,summary:content,mode,date,sources:[]}},sub),
   memory:(input,sub='reader')=>as(sub,()=>createMemoryRepository(db)(sub,input)),
   note:(input,sub='reader')=>as(sub,()=>createTopicRepository(db)(sub,validateTopicRequest(input))),
   retrieve:(query,options={},sub='reader')=>as(sub,()=>retrieveStudentHistory(db,sub,{studentId:'alex',query,...options})),
  };
 }catch(error){await close();throw error;}
}
