// Read-only release checks. A passing report never enables coordinator access.
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createDatabase} from '../server/database.mjs';
import {assertRuntimeIsolation} from '../server/account-isolation.mjs';
import {createMaintenanceDatabase,assertMaintenanceAccess} from '../server/maintenance-database.mjs';
import {coordinatorFlags,coordinatorConfigurationIssues} from '../server/binder-sharing-policy.mjs';
import {assertCoordinatorProvisioningReady} from '../server/coordinator-access.mjs';
import {assertCoordinatorLinkingReady} from '../server/coordinator-connections.mjs';
import {assertBinderSharingReady} from '../server/binder-sharing.mjs';
import {assertCoordinatorViewingReady} from '../server/coordinator-binders.mjs';
import {assertCoordinatorFeedbackReady} from '../server/coordinator-feedback.mjs';
import {assertCoordinatorLifecycleReady} from '../server/coordinator-notifications.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const nonempty=v=>typeof v==='string'&&v.trim().length>0&&v.length<=500;
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export const pilotGates=Object.freeze(['staging-configuration','auth0-live','bilingual-workflow','accessibility','incident-disable','restore-rehearsal','provider-retention','partner-training','cohort-approval']);
export async function coordinatorSourceFingerprint(directory=root){
 const files=[];
 async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('release_symlink_unsupported');const full=resolve(path,entry.name);if(entry.isDirectory())await walk(full);else if(/\.(?:mjs|cjs|js|jsx|ts|tsx|css|sql|json|html|svg)$/.test(entry.name))files.push(full);}}
 for(const name of ['server','src','scripts','ops','auth0','public'])await walk(resolve(directory,name));
 for(const name of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json'])files.push(resolve(directory,name));
 const hashes=[];for(const file of files.sort())hashes.push([relative(directory,file).replaceAll('\\','/'),sha((await readFile(file,'utf8')).replaceAll('\r\n','\n'))]);
 return sha(JSON.stringify(hashes));
}

export async function checkCoordinatorDatabase(runtime,maintenance,{schema='public',env={},migrationDirectory=new URL('../server/migrations/',import.meta.url)}={}){
 const checks=[];
 const check=async(id,work)=>{try{await work();checks.push({id,passed:true});}catch{checks.push({id,passed:false});}};
 await check('flag-dependencies',()=>{if(coordinatorConfigurationIssues(env).length)throw new Error('invalid_flags');});
 await check('runtime-isolation',()=>assertRuntimeIsolation(runtime,{schema}));
 await check('maintenance-isolation',()=>assertMaintenanceAccess(maintenance,{schema}));
 await check('same-database-separate-roles',async()=>{
  const sql='SELECT current_database() AS db, current_user AS role, current_schema() AS schema, inet_server_addr()::text AS host, inet_server_port() AS port';
  const a=(await runtime.query(sql)).rows[0],b=(await maintenance.query(sql)).rows[0];
  if(a.role===b.role||a.db!==b.db||a.host!==b.host||a.port!==b.port||a.schema!==schema||b.schema!==schema)throw new Error('database_mismatch');
 });
 await check('migration-checksums',async()=>{
  const applied=new Map((await runtime.query('SELECT name,checksum FROM origen_schema_migrations')).rows.map(r=>[r.name,r.checksum]));
  const files=(await readdir(migrationDirectory)).filter(n=>/^\d{3}_[a-z0-9_-]+\.sql$/.test(n));
  if(applied.size!==files.length)throw new Error('migration_set_mismatch');
  for(const name of files)if(applied.get(name)!==sha((await readFile(new URL(name,migrationDirectory),'utf8')).replaceAll('\r\n','\n')))throw new Error('migration_mismatch');
 });
 // Check every implemented capability even when the actual rollout flags are off.
 const all=Object.fromEntries(coordinatorFlags.map(k=>[k,'true']));
 for(const [id,fn] of [['provisioning',assertCoordinatorProvisioningReady],['linking',assertCoordinatorLinkingReady],['publication',assertBinderSharingReady],['viewing',assertCoordinatorViewingReady],['guidance',assertCoordinatorFeedbackReady]])await check(id,()=>fn(runtime,all));
 await check('lifecycle',()=>assertCoordinatorLifecycleReady(runtime,all,maintenance));
 return {kind:'coordinator-database-check',schemaVersion:1,checkedAt:new Date().toISOString(),passed:checks.every(c=>c.passed),checks,flags:Object.fromEntries(coordinatorFlags.map(k=>[k,env[k]==='true'])),changesApplied:false};
}

export function assessCoordinatorPilot(record,verification,{sourceFingerprint,now=new Date()}={}){
 const reasons=[];
 const add=(ok,reason)=>{if(!ok)reasons.push(reason);};
 const fresh=value=>{const time=Date.parse(value);return Number.isFinite(time)&&time<=now.getTime()&&now.getTime()-time<=7*86400000;};
 add(record?.schemaVersion===1,'record-version');
 add(record?.stage==='staging','staging-record-required');
 add(/^[a-f\d]{40}$/i.test(record?.release?.revision||''),'release-revision');
 add(/^[a-f\d]{64}$/.test(sourceFingerprint||'')&&record?.release?.sourceFingerprint===sourceFingerprint,'source-fingerprint');
 add(nonempty(record?.release?.deploymentRef),'deployment-reference');
 add(verification?.kind==='coordinator-local-verification'&&verification.schemaVersion===1,'local-verification-required');
 add(verification?.sourceFingerprint===sourceFingerprint,'local-verification-source');
 add(fresh(verification?.checkedAt),'local-verification-stale');
 const suites=verification?.suites;
 for(const id of ['server','operations']){const s=suites?.[id];add(Number.isInteger(s?.tests)&&s.tests>0&&s.pass===s.tests&&s.fail===0&&s.skipped===0&&s.cancelled===0,`${id}-tests-incomplete`);}
 add(verification?.build===true&&verification?.logging===true&&verification?.sourceUnchanged===true,'build-logging-source');
 add(verification?.disposablePostgres===true,'real-postgres-required');
 const cohort=record?.cohort;
 add(uuid(cohort?.organizationId)&&cohort?.organizationCount===1,'one-approved-organization');
 add(Number.isInteger(cohort?.coordinators)&&cohort.coordinators>=2&&cohort.coordinators<=3,'coordinator-cohort-size');
 add(Number.isInteger(cohort?.students)&&cohort.students>=5&&cohort.students<=10,'student-cohort-size');
 add(cohort?.adultStudentOwnedOnly===true&&cohort?.consentConfirmed===true&&cohort?.testAccountBypass===false,'adult-consenting-cohort');
 add(record?.knownRevocationOrDeletionDefects===0&&record?.unauthorizedDisclosures===0,'unresolved-privacy-defects');
 for(const id of pilotGates){
  const matches=Array.isArray(record?.gates)?record.gates.filter(g=>g?.id===id):[];
  if(matches.length!==1){reasons.push(`${id}:missing-or-duplicate`);continue;}
  const g=matches[0];
  add(g.status==='verified'&&nonempty(g.owner)&&nonempty(g.reviewedBy)&&Array.isArray(g.evidence)&&g.evidence.length>0&&g.evidence.every(nonempty),`${id}:unverified`);
  add(fresh(g.checkedAt)&&Date.parse(g.expiresAt)>now.getTime()&&Date.parse(g.expiresAt)>Date.parse(g.checkedAt),`${id}:stale`);
  add(g.revision===record?.release?.revision&&g.sourceFingerprint===sourceFingerprint,`${id}:release-mismatch`);
 }
 const matrix=record?.workflowMatrix;
 for(const language of ['en','es'])for(const device of ['mobile','desktop'])add(Array.isArray(matrix)&&matrix.filter(r=>r?.language===language&&r?.device===device&&r.passed===true&&r.liveAuth0===true&&r.liveVoice===true&&nonempty(r.evidence)).length===1,`workflow-${language}-${device}`);
 add(Number.isInteger(record?.backup?.recoveryHorizonDays)&&record.backup.recoveryHorizonDays>0&&Number.isInteger(record.backup.deletionEvidenceDays)&&record.backup.deletionEvidenceDays>=record.backup.recoveryHorizonDays,'backup-deletion-evidence-horizon');
 return {schemaVersion:1,kind:'coordinator-pilot-readiness',assessedAt:now.toISOString(),ready:reasons.length===0,blockingReasons:reasons,changesApplied:false,limitation:'Validates recorded evidence, not its authenticity. An authorized owner must review it before enabling the named cohort. No configuration or permissions were changed.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,...args]=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
 try{
  let result;
  if(command==='database'){
   const runtime=createDatabase(),maintenance=createMaintenanceDatabase(process.env);
   if(!runtime||!maintenance)throw new Error('database_configuration_required');
   try{result=await checkCoordinatorDatabase(runtime,maintenance,{env:process.env});}finally{await runtime.end();await maintenance.end();}
   result.sourceFingerprint=await coordinatorSourceFingerprint();
  }else if(command==='assess'&&args.includes('--record')&&args.includes('--verification')){
   const record=JSON.parse(await readFile(value('--record'),'utf8')),verification=JSON.parse(await readFile(value('--verification'),'utf8'));
   result=assessCoordinatorPilot(record,verification,{sourceFingerprint:await coordinatorSourceFingerprint()});
  }else throw new Error('usage');
  if(args.includes('--output'))await writeFile(value('--output'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result,null,2));if(!(result.passed??result.ready))process.exitCode=2;
 }catch{console.error('Coordinator readiness check could not complete. Check command arguments, input files and restricted database configuration. No configuration was changed.');process.exitCode=1;}
}
