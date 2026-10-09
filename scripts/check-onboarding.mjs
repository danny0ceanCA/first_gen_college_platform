import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createServer as createPortProbe} from 'node:net';
const root=fileURLToPath(new URL('../',import.meta.url));

export function testCounts(output){
 const count=key=>{const matches=[...output.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`,'gm'))];return matches.length===1?Number(matches[0][1]):null;};
 const result=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>[key,count(key)]));
 if(Object.values(result).some(value=>value===null)||result.tests<1||result.tests!==result.pass+result.fail+result.cancelled+result.skipped+result.todo)return null;
 return result;
}
export async function sourceFingerprint(base=root){
 const files=['index.html','package.json','package-lock.json','vite.config.ts','tsconfig.json','.github/workflows/checks.yml',...browserFiles];
 async function walk(relative){for(const item of await readdir(path.join(base,relative),{withFileTypes:true})){const next=relative+'/'+item.name;if(item.isDirectory())await walk(next);else if(item.isFile())files.push(next);}}
 for(const folder of ['src','server','scripts','public','docs/voice-experience'])await walk(folder);
 const hash=createHash('sha256');for(const file of files.sort()){hash.update(file+'\0');hash.update(await readFile(path.join(base,file)));hash.update('\0');}return hash.digest('hex');
}
function command(args,{timeoutMs=180000}={}){
 return new Promise(resolve=>{
  let output='',finished=false,timedOut=false;const start=Date.now(),child=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
  const collect=chunk=>{if(output.length<5000000)output+=chunk.toString();else{timedOut=true;child.kill();}};child.stdout.on('data',collect);child.stderr.on('data',collect);
  const done=code=>{if(finished)return;finished=true;clearTimeout(timer);resolve({exitCode:code??1,output,timedOut,durationMs:Date.now()-start});};child.on('error',()=>done(1));child.on('close',done);
 });
}
const browserFiles=[1,2,3,4,5,6].map(n=>`output/playwright/onboarding-events-phase${n}-check.js`);
export async function browserChecks(npmCli,{phases=[1,2,3,4,5,6],onFailure=()=>{}}={}){
 if(phases.some(phase=>!Number.isInteger(phase)||phase<1||phase>browserFiles.length))throw Error('Invalid browser scenario');
 const npxCli=path.join(path.dirname(npmCli),'npx-cli.js'),{createServer}=await import('vite');
 const probe=createPortProbe();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'silent'}),results=[];
 try{
  await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for(const phase of phases){const i=phase-1;
   const session=`onboarding-release-${process.pid}-${i+1}`,file=browserFiles[i],temporary=path.join(root,`output/playwright/.release-phase${i+1}-${process.pid}.js`);
   const source=(await readFile(path.join(root,file),'utf8')).replaceAll('http://127.0.0.1:5178',origin);
   // All pages start in an isolated session. Unexpected external requests fail
   // before network access; scenario-specific mocked APIs take precedence.
   await writeFile(temporary,`async page=>{let external=false;await page.route('**/*',route=>{const url=new URL(route.request().url());if(['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.fulfill({status:200,contentType:'text/css',body:''});if(url.origin===${JSON.stringify(origin)}||['data:','blob:','about:'].includes(url.protocol))return route.continue();external=true;return route.abort();});await (${source})(page);if(external)throw Error('External request blocked');return {passed:true};}`);
   const cli=['--yes','--package','@playwright/cli','playwright-cli','--session',session];
   let ok=false,start=Date.now();try{
    const opened=await command([npxCli,...cli,'open','about:blank'],{timeoutMs:60000});
    if(opened.exitCode===0){const checked=await command([npxCli,...cli,'run-code','--filename',temporary],{timeoutMs:90000});ok=checked.exitCode===0&&!checked.timedOut&&/"passed":true/.test(checked.output);if(!ok)onFailure({phase,output:checked.output});}else onFailure({phase,output:opened.output});
   }finally{await command([npxCli,...cli,'close'],{timeoutMs:30000});const {unlink}=await import('node:fs/promises');await unlink(temporary);}
   results.push({scenario:`phase-${i+1}`,status:ok?'passed':'failed',durationMs:Date.now()-start});console.log(`Browser phase ${i+1}: ${ok?'passed':'failed'}`);
  }
 }finally{await server.close();}
 return results;
}
export async function checkOnboarding({browser=false,npmCli=process.env.npm_execpath}={}){
 if(!npmCli)throw Error('Run with npm run check:onboarding.');
 const startedAt=new Date().toISOString(),before=await sourceFingerprint();
 const files=(await readdir(path.join(root,'server'))).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'server/'+name);
 console.log('Checking server tests…');const tests=await command(['--test','--test-reporter=tap',...files]),counts=testCounts(tests.output);
 const testStatus=tests.exitCode===0&&!tests.timedOut&&counts&&counts.fail===0&&counts.cancelled===0?'passed':'failed';
 console.log(`Server tests: ${testStatus}${counts?` (${counts.pass} passed, ${counts.skipped} skipped)`:''}`);
 console.log('Checking production build…');const build=await command([npmCli,'run','build']),buildStatus=build.exitCode===0&&!build.timedOut?'passed':'failed';console.log(`Production build: ${buildStatus}`);
 let scenarios=[],browserStatus=browser?'failed':'not-run';if(browser){try{scenarios=await browserChecks(npmCli);browserStatus=scenarios.length===browserFiles.length&&scenarios.every(s=>s.status==='passed')?'passed':'failed';}catch{/* Report unavailable browser setup without credentials, paths or raw errors. */}}
 const after=await sourceFingerprint(),unchanged=before===after;
 const report={schemaVersion:1,startedAt,completedAt:new Date().toISOString(),scope:'Local synthetic onboarding release verification',sourceFingerprint:before,sourceUnchanged:unchanged,
  checks:{server:{status:testStatus,counts,durationMs:tests.durationMs},build:{status:buildStatus,durationMs:build.durationMs},browser:{status:browserStatus,scenarios}},
  passed:unchanged&&testStatus==='passed'&&buildStatus==='passed'&&(!browser||browserStatus==='passed'),productionVerified:false,
  remainingChecks:['Real Auth0 registration and sign-in on the deployed origin','Dedicated PostgreSQL integration checks if skipped','Human listening check for Spanish/English pronunciation, volume and interruptions','Deployed migration and admin permission verification'],deployed:false};
 await mkdir(path.join(root,'output'),{recursive:true});await writeFile(path.join(root,'output/onboarding-release-check.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`Onboarding checks ${report.passed?'passed':'failed'}. Report: output/onboarding-release-check.json. Production verification remains separate.`);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.slice(2).some(arg=>arg!=='--browser')){console.error('Use npm run check:onboarding [-- --browser].');process.exitCode=1;}
 else try{const result=await checkOnboarding({browser:process.argv.includes('--browser')});if(!result.passed)process.exitCode=1;}catch{console.error('Onboarding checks could not complete. Run server tests/build individually to diagnose.');process.exitCode=1;}
}
