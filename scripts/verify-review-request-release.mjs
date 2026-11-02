// All mutations are confined to disposable schemas and roles. This command
// produces local evidence; it never changes deployment flags or production data.
import {spawn} from 'node:child_process';
import pg from 'pg';
import {mkdir,open,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {outcomeBrowserComplete,outcomeReleaseComplete,outcomeExternalChecks} from '../ops/outcome-release-verification.mjs';
import {coordinatorSourceFingerprint} from '../ops/coordinator-readiness.mjs';
import {reviewVerificationEnvironment,reviewVerificationCounts,reviewBrowserComplete,reviewResponseBrowserComplete,followUpBrowserComplete} from '../ops/review-request-verification.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),directory=args[args.indexOf('--output')+1];
let env;try{if(!args.includes('--disposable-database')||!args.includes('--output')||!directory||directory.startsWith('--'))throw Error();env=reviewVerificationEnvironment(process.env);}catch{console.error('Use --disposable-database --output <new-directory> and a dedicated loopback DATABASE_TEST_URL.');process.exit(1);}
const output=resolve(directory);await mkdir(output); // Never overwrite old evidence.
const report={kind:'outcome-evidence-local-verification',schemaVersion:1,localOnly:true,startedAt:new Date().toISOString(),sourceFingerprint:await coordinatorSourceFingerprint(),disposablePostgres:true,syntheticIdentity:true,syntheticSpeech:true,browserConcurrency:2,suites:{},browsers:{},typecheck:false,build:false,logging:false,sourceUnchanged:false,passed:false,productionEnabled:false};
async function run(id,argv,extra={}){
 const path=resolve(output,`${id}.log`),file=await open(path,'wx');
 const code=await new Promise(resolve=>{
  const child=spawn(process.execPath,argv,{cwd:root,env:{...env,...extra},stdio:['ignore',file.fd,file.fd]});let done=false,killTimer;
  const timer=setTimeout(()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);},(id==='browser-outcome-connected'?15:10)*60*1000);
  const finish=code=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);resolve(code);};child.on('error',()=>finish(1));child.on('close',finish);
 });await file.close();const data=await readFile(path,'utf8');console.log(`${id}: ${code===0?'completed':'failed'}`);return {code,data};
}
let preview;
async function startPreview(){
 const file=await open(resolve(output,'preview.log'),'wx');
 const child=spawn(process.execPath,['--input-type=module','-e',"import{createServer}from'vite';const server=await createServer({configFile:false,envDir:false,esbuild:{jsx:'automatic'},server:{hmr:false,host:'127.0.0.1',port:0}});await server.listen();console.log(JSON.stringify({reviewPreview:server.resolvedUrls.local[0]}));process.on('SIGTERM',async()=>{await server.close();process.exit(0);});"],{cwd:root,env,stdio:['ignore','pipe',file.fd]});
 preview={child,file};let buffer='';
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('preview_start_timeout')),20000);
  child.stdout.on('data',chunk=>{void file.write(chunk);buffer+=chunk;for(const line of buffer.split('\n'))try{const value=JSON.parse(line);if(value.reviewPreview){clearTimeout(timer);const url=new URL(value.reviewPreview);if(url.hostname!=='127.0.0.1')throw Error();resolve(url.origin);}}catch{}buffer=buffer.slice(buffer.lastIndexOf('\n')+1);});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('preview_start_failed'));});child.on('exit',()=>{clearTimeout(timer);reject(new Error('preview_exited'));});
 });
}
try{
 const pool=new pg.Pool({connectionString:env.DATABASE_TEST_URL,max:1});try{report.runtime={node:process.version,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,playwright:JSON.parse(await readFile(resolve(root,'node_modules/playwright/package.json'),'utf8')).version};}finally{await pool.end();}
 const serverFiles=['review-requests','review-request-submission','review-request-notebook','review-request-voice','review-request-voice-client','review-request-delivery','review-request-release','review-response-connections','review-response-context','review-response-context-client','review-response-voice','review-response-choices','review-response-followups','student-follow-up','outcome-evidence','outcome-recording','outcome-observations','outcome-assessment','outcome-evaluation','outcome-quality','outcome-release','follow-up-conversations','student-shared-updates','conversation-opening','binder-next-step','adaptive-guidance','voice-workspace','conversation-continuity','voice-prompt-structure','personalization-release','coordinator-lifecycle','coordinator-feedback','coordinator-pilot','account-lifecycle','binder-sharing-policy','production-config','profile-voice','student-live-session'].map(name=>`server/${name}.test.mjs`);
 for(const [id,files] of [['server',[...serverFiles,'src/studentLiveChannel.test.mjs','src/followUpOpening.test.mjs','src/followUpVoiceTools.test.mjs','src/studentLivePlayback.test.mjs']],['operations',['ops/review-request-verification.test.mjs','ops/coordinator-readiness.test.mjs','ops/outcome-release-verification.test.mjs','ops/outcome-definition-review.test.mjs']]]){
  const result=await run(id,['--test','--test-concurrency=2','--test-reporter=tap',...files]);report.suites[id]=reviewVerificationCounts(result.data,result.code);
 }
 const definitions=await run('outcome-definitions',['scripts/review-outcome-definitions.mjs',resolve(output,'outcome-definitions.json')]);
 try{report.caseReview=JSON.parse(await readFile(resolve(output,'outcome-definitions.json'),'utf8'));if(definitions.code!==0)report.caseReview.passed=false;}catch{report.caseReview={passed:false};}
 report.logging=(await run('logging',['scripts/check-logging-policy.mjs'])).code===0;
 const types=await run('typecheck',['node_modules/typescript/bin/tsc','-b']);report.typecheck=types.code===0;report.build=report.typecheck&&(await run('build',['--input-type=module','-e',"import{build}from'vite';await build({configFile:false,envDir:false});"])).code===0;
 const origin=await startPreview();
 const browserChecks=[['outcome-connected','student-follow-up-release-smoke.cjs',12],['outcome-evaluation','outcome-evaluation-smoke.cjs',6],['outcome-observation','outcome-observation-smoke.cjs',6],['outcome-evidence','outcome-evidence-smoke.cjs',6],['workflow','review-request-release-smoke.cjs',12],['notebook','review-request-notebook-smoke.cjs',6],['delivery','review-request-delivery-smoke.cjs',6],['navigation','coordinator-workspace-navigation-smoke.cjs',7],['connected','review-response-release-smoke.cjs',8],['choices','review-response-choices-smoke.cjs',6],['followups','review-response-followups-smoke.cjs',6],['student-follow-up','student-follow-up-smoke.cjs',6],['private-follow-up','private-follow-up-smoke.cjs',6],['shared-updates','student-shared-update-smoke.cjs',6],['follow-up-connected','student-follow-up-release-smoke.cjs',12]];
 async function checkBrowser([id,script,expected]){
  const folder=resolve(output,id),r=await run(`browser-${id}`,[`scripts/${script}`,...(id==='outcome-connected'?['--outcome-evidence']:[])],{ORIGEN_PREVIEW_URL:origin,ORIGEN_SMOKE_OUTPUT:folder});
  if(id==='outcome-connected'){
   let record;try{record=JSON.parse(await readFile(resolve(folder,'results.json'),'utf8'));}catch{}
   report.browsers[id]={passed:r.code===0&&outcomeBrowserComplete(record),journeys:record?.journeys?.length||0};if(typeof record?.browserVersion==='string')report.runtime.chromium=record.browserVersion;
  }else if(['outcome-evidence','outcome-observation','outcome-evaluation'].includes(id)){
   let record;try{record=JSON.parse(await readFile(resolve(folder,'results.json'),'utf8'));}catch{}
   report.browsers[id]={passed:r.code===0&&record?.kind===`${id}-browser-verification`&&record.realDatabase===true&&record.passed===true&&record.journeys?.length===6&&new Set(record.journeys.filter(j=>j.passed===true&&[1280,390,320].includes(j.width)&&['en','es'].includes(j.language)).map(j=>j.width+':'+j.language)).size===6,journeys:record?.journeys?.length||0};
  }else if(id==='follow-up-connected'){
   let record;try{record=JSON.parse(await readFile(resolve(folder,'results.json'),'utf8'));}catch{}
   report.browsers[id]={passed:r.code===0&&followUpBrowserComplete(record),journeys:record?.journeys?.length||0};if(typeof record?.browserVersion==='string')report.runtime.chromium=record.browserVersion;
  }else if(id==='workflow'){
   let record;try{record=JSON.parse(await readFile(resolve(folder,'journeys.json'),'utf8'));}catch{}
   report.browsers[id]={passed:r.code===0&&reviewBrowserComplete(record),journeys:record?.journeys?.length||0};
  }else if(['connected','choices','followups','student-follow-up','private-follow-up','shared-updates'].includes(id)){
   let record;try{record=JSON.parse(await readFile(resolve(folder,'results.json'),'utf8'));}catch{}
   report.browsers[id]={passed:r.code===0&&reviewResponseBrowserComplete(record,id),journeys:record?.journeys?.length||0};
  }else{
   const count=[...r.data.matchAll(new RegExp(id==='navigation'?'^CHECKED ':'^PASS ','gm'))].length;
   const completed=id==='navigation'?r.data.includes('PASS: all coordinator views'):id==='notebook'?r.data.includes('Passed 6 notebook request journeys.'):r.data.includes('6 coordinator delivery browser journeys passed.');
   report.browsers[id]={passed:r.code===0&&count===expected&&completed,journeys:count};
  }
 }
 let nextBrowser=0;
 async function browserWorker(){while(nextBrowser<browserChecks.length)await checkBrowser(browserChecks[nextBrowser++]);}
 const workers=await Promise.allSettled([browserWorker(),browserWorker()]);
 if(workers.some(r=>r.status==='rejected'))throw Error('browser_verification_incomplete');
}catch{report.failure='verification_could_not_complete';}
finally{
 if(preview){preview.child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{preview.child.kill('SIGKILL');resolve();},5000);preview.child.once('close',()=>{clearTimeout(timer);resolve();});});await preview.file.close();}
 report.sourceUnchanged=report.sourceFingerprint===await coordinatorSourceFingerprint();report.checkedAt=new Date().toISOString();
 report.externalChecksNotPerformed=[...outcomeExternalChecks];
 report.passed=!report.failure&&outcomeReleaseComplete(report);
 await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
