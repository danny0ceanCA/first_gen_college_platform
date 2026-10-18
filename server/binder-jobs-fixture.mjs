// Disposable local PostgreSQL roles and synthetic accounts only.
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {grantMaintenanceAccess,assertMaintenanceAccess} from './maintenance-database.mjs';
import {isolateDatabase,runRetentionJob} from './account-isolation.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
import {createTopicRepository} from './topic-notes.mjs';
import {claimBinderJob} from './binder-jobs.mjs';
export async function binderFixture(){
 const f=await retrievalFixture(),role='binder_'+randomUUID().replaceAll('-','');let maintenance;
 try{
  await f.owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);await grantMaintenanceAccess(f.owner,role,{schema:f.schema});
  const url=new URL(process.env.DATABASE_TEST_URL);url.username=role;url.password='';maintenance=new pg.Pool({connectionString:url.href,max:2,options:`-c search_path=${f.schema}`});await assertMaintenanceAccess(maintenance,{schema:f.schema});
  const permission=createPermissionRepository(f.db);for(const sub of ['reader','other'])await f.as(sub,()=>permission.account(sub,{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
  const dispatch=isolateDatabase(maintenance,{schema:f.schema});return {...f,maintenance,permission,
   claim:()=>runRetentionJob(()=>claimBinderJob(dispatch)),
   notes:(sub='reader',studentId='alex')=>f.as(sub,()=>createTopicRepository(f.db)(sub,{action:'load',studentId})),
   close:async()=>{await maintenance?.end();await f.owner.query(`DROP OWNED BY ${role}`);await f.owner.query(`DROP ROLE ${role}`);await f.close();},
  };
 }catch(error){await maintenance?.end();await f.owner.query(`DROP OWNED BY ${role}`);await f.owner.query(`DROP ROLE IF EXISTS ${role}`);await f.close();throw error;}
}
