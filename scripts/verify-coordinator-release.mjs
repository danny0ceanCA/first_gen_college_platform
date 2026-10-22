// Explicit synthetic release rehearsal; never uses the application DATABASE_URL.
import {spawn} from 'node:child_process';
import {mkdir,readdir,writeFile,open,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {coordinatorSourceFingerprint} from '../ops/coordinator-readiness.mjs';

const args=process.argv.slice(2),index=args.indexOf('--output'),directory=index>=0?args[index+1]:null;
let url;try{url=new URL(process.env.DATABASE_TEST_URL);}catch{}
if(!args.includes('--disposable-database')||!directory||!url||!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
 console.error('Use --disposable-database --output <new-directory> and a loopback DATABASE_TEST_URL for a dedicated disposable PostgreSQL cluster.');process.exit(1);
}
const output=resolve(directory);await mkdir(output); // Refuse to replace prior evidence.
const env={...process.env,NODE_ENV:'test',DATABASE_TEST_URL:url.href,ORIGEN_TEST_DATABASE_URL:url.href,TELEMETRY_TEST_DATABASE_URL:url.href};
const report={kind:'coordinator-local-verification',schemaVersion:1,checkedAt:new Date().toISOString(),sourceFingerprint:await coordinatorSourceFingerprint(),disposablePostgres:true,suites:{},build:false,logging:false,sourceUnchanged:false};
async function run(id,command,argv){
 const path=resolve(output,`${id}.log`),file=await open(path,'wx');
 const result=await new Promise(resolve=>{
  // Stream evidence to disk so failures remain inspectable before a suite exits.
  const child=spawn(command,argv,{env,stdio:['ignore',file.fd,file.fd],windowsHide:true});let finished=false;
  const timer=setTimeout(()=>{
   // Only the process tree just created by this runner may be terminated.
   if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).on('error',()=>child.kill());
   else child.kill();
  },15*60*1000);
  const finish=code=>{if(finished)return;finished=true;clearTimeout(timer);resolve({code});};
  child.on('error',()=>finish(1));child.on('close',finish);
 });
 await file.close();result.data=await readFile(path,'utf8');console.log(`${id}: ${result.code===0?'completed':'failed'} (details in the local verification directory)`);return result;
}
let failed=false;
for(const [id,folders] of [['server',['server']],['operations',['ops','ops/observability']]]){
 const files=[];for(const folder of folders)for(const name of (await readdir(folder)).sort())if(name.endsWith('.test.mjs'))files.push(`${folder}/${name}`);
 const result=await run(id,process.execPath,['--test','--test-concurrency=4','--test-reporter=tap',...files]);
 const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(key=>[key,Number(result.data.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??NaN)]));
 report.suites[id]=counts;
 if(result.code!==0||!Number.isInteger(counts.tests)||counts.tests===0||counts.pass!==counts.tests||counts.fail!==0||counts.skipped!==0||counts.cancelled!==0)failed=true;
}
report.logging=(await run('logging',process.execPath,['scripts/check-logging-policy.mjs'])).code===0;
const typecheck=await run('typecheck',process.execPath,['node_modules/typescript/bin/tsc','-b']);
report.build=typecheck.code===0&&(await run('build',process.execPath,['node_modules/vite/bin/vite.js','build',...(args.includes('--native-vite-config')?['--configLoader','native']:[])])).code===0;
report.sourceUnchanged=report.sourceFingerprint===await coordinatorSourceFingerprint();report.checkedAt=new Date().toISOString();
report.passed=!failed&&report.logging&&report.build&&report.sourceUnchanged;
await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
