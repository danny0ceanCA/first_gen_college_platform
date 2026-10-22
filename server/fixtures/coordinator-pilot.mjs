// Disposable test transport only. Never mount this identity shim in the app.
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import pg from 'pg';
import {retrievalFixture} from '../history-retrieval-fixture.mjs';
import {createInstitutionRepository,validateInstitution} from '../institutions.mjs';
import {createCoordinatorHandler} from '../coordinator-access.mjs';
import {createCoordinatorConnectionsHandler} from '../coordinator-connections.mjs';
import {createBinderSharingHandler} from '../binder-sharing.mjs';
import {createCoordinatorBindersHandler} from '../coordinator-binders.mjs';
import {createCoordinatorFeedbackHandler} from '../coordinator-feedback.mjs';
import {createCoordinatorNotificationsHandler,maintainCoordinators} from '../coordinator-notifications.mjs';
import {grantMaintenanceAccess} from '../maintenance-database.mjs';
import {isolateDatabase,runRetentionJob} from '../account-isolation.mjs';
import {MFA_TIME_CLAIM} from '../staff-access.mjs';
import {AUTH_TIME_CLAIM} from '../recent-auth.mjs';
import {coordinatorFlags} from '../binder-sharing-policy.mjs';

export async function coordinatorPilotFixture({language='en',permission='adult',runtimePoolSize=3,productionTimeouts=false,followThrough=false}={}){
 const f=await retrievalFixture({runtimePoolSize,productionTimeouts}),org=randomUUID(),transportSecret=randomUUID();let server,maintenance,maintenanceRole;
 const actors=new Set(['other','reader','owner','staff','colleague','reviewer']);
 const actor=sub=>{if(!/^sharing-stress-\d+$/.test(sub))throw Error('synthetic_actor_required');actors.add(sub);};
 const cleanup=async()=>{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});if(maintenance){await maintenance.end();await f.owner.query(`DROP OWNED BY ${maintenanceRole}`);await f.owner.query(`DROP ROLE ${maintenanceRole}`);}await f.close();};
 try{
  const env={AUTH0_DOMAIN:'synthetic.example',...Object.fromEntries(coordinatorFlags.map(k=>[k,'true'])),...(followThrough?{ORIGEN_DERIVED_BINDER_SHARING:'true',ORIGEN_COORDINATOR_FOLLOW_THROUGH:'true'}:{})};
  const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
  for(const sub of ['owner','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[sub,`${sub}@example.test`,'Synthetic']);
  await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Synthetic Community Center'}]);
  await f.owner.query("INSERT INTO origen_institution_members VALUES($1,'owner','owner')",[org]);
  const institution=(sub,input,identity)=>f.as(sub,()=>createInstitutionRepository(f.db,['reviewer'])(sub,validateInstitution(input),identity));
  // Exercise actual invitation storage and recipient verification before enabling staff.
  for(const sub of ['staff','colleague']){const inv=await institution('owner',{action:'invite',id:org,email:`${sub}@example.test`,role:'outreach'});await institution(sub,{action:'accept-invite',token:inv.token},{sub,email:`${sub}@example.test`,email_verified:true,given_name:sub});}
  const provider=async(_url,options)=>{const sub=options.headers.Authorization?.replace('Bearer ','')||options.headers.authorization?.replace('Bearer ','');return new Response(JSON.stringify({sub,email:`${sub}@example.test`,email_verified:true}),{status:200,headers:{'Content-Type':'application/json'}});};
  const handlers=[createCoordinatorHandler(f.db,env,provider),createCoordinatorConnectionsHandler(f.db,env,provider),createBinderSharingHandler(f.db,env),createCoordinatorBindersHandler(f.db,env,provider),createCoordinatorFeedbackHandler(f.db,env,provider),createCoordinatorNotificationsHandler(f.db,env,provider)];
  server=createServer((req,res)=>{
   const sub=req.headers['x-synthetic-actor'];
   if(req.headers['x-synthetic-secret']!==transportSecret||!actors.has(sub)){res.writeHead(401);return res.end();}
   const seconds=Math.floor(Date.now()/1000);req.origenAuthorized=true;req.origenIdentity={sub,iat:seconds,[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds,permissions:sub==='reviewer'?['manage:institutions']:[]};req.headers.authorization=`Bearer ${sub}`;
   f.as(sub,async()=>{let i=0;const next=()=>i<handlers.length?handlers[i++](req,res,next):(res.writeHead(404),res.end());await next();}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(sub,path,input)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-actor':sub,'x-synthetic-secret':transportSecret},body:JSON.stringify(input)});const body=await response.json();return {status:response.status,body,cache:response.headers.get('cache-control')};};
  const call=async(sub,path,input)=>{const r=await request(sub,path,input);if(r.status!==200)throw Object.assign(new Error(r.body.error||'synthetic_request_failed'),{status:r.status});return r.body;};
  await call('reviewer','/api/coordinator-access',{action:'approve-organization',id:org});
  for(const subject of ['staff','colleague'])await call('owner','/api/coordinator-access',{action:'enable-member',id:org,subject});
  await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[createHash('sha256').update('other').digest('hex')]);
  if(permission==='approved')await f.owner.query("UPDATE origen_eligibility SET age_band='13to17',status='approved',permission_expires_at=now()+interval '30 days' WHERE subject_hash=$1",[createHash('sha256').update('other').digest('hex')]);
 const notes=[];
  for(const [topic,content] of [['options',language==='es'?'Comparar programas de biología.':'Compare biology programs.'],['costs',language==='es'?'Preguntar por becas locales.':'Ask about local scholarships.'],['options','UNPUBLISHED_SENTINEL'],['options','FAMILY_DERIVED_SENTINEL']]){const id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic,kind:'note',content,language}},'other');notes.push(id);}
  await f.owner.query("UPDATE origen_binder_source_lineage SET classification='family' WHERE source_id=$1",[notes[3]]);
  await f.save('private-family','FAMILY_CONVERSATION_SENTINEL',{studentId:null,sub:'other'});
  await f.save('private-global','GLOBAL_SUMMARY_SENTINEL',{studentId:'alex',sub:'other'});
  maintenanceRole=`pilot_maint_${randomUUID().replaceAll('-','')}`;await f.owner.query(`CREATE ROLE ${maintenanceRole} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);await grantMaintenanceAccess(f.owner,maintenanceRole,{schema:f.schema});
  const url=new URL(process.env.DATABASE_TEST_URL);url.username=maintenanceRole;url.password='';maintenance=new pg.Pool({connectionString:url.href,options:`-c search_path=${f.schema}`,max:1});
  const sweep=()=>runRetentionJob(()=>maintainCoordinators(isolateDatabase(maintenance,{schema:f.schema})));
  return {...f,org,env,notes,base,transportSecret,actor,request,call,institution,maintenance,sweep,close:cleanup};
 }catch(error){await cleanup();throw error;}
}
