import {mkdir,open,readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createPublicKey} from 'node:crypto';
import {hash,deny,exact,grant,prepare,sensitive,validatePolicy} from './contracts.mjs';
import {profiles,buildSecondCommand} from './profiles.mjs';
import {preflight,execute} from './sandbox.mjs';
import {reserve} from './ledger.mjs';
export const profileDigest=hash(JSON.stringify({profiles,buildSecondCommand}));
async function append(path,record){const file=await open(path,'a',0o600);try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}}
// Private state is durable across worker restarts. Failed/aborted attempts consume a slot.
// One controller VM per investigation: the directory is an exclusive lease, not a concurrency hint.
export async function openRunner({policyFile,policyDigest,publicKeyFile,stateRoot,enabled=false,executionEnabled=()=>true,authorize}){
 if(!enabled||typeof authorize!=='function'||typeof executionEnabled!=='function'||!executionEnabled()||process.platform!=='linux')deny();
 const privateFile=async path=>{if((await lstat(path)).isSymbolicLink()||await realpath(path)!==resolve(path))deny();const s=await lstat(path);if(s.mode&0o022)deny();return readFile(path,'utf8');};
 const raw=await privateFile(policyFile);if(hash(raw)!==policyDigest)deny();
 const policy=validatePolicy(JSON.parse(raw)),key=createPublicKey(await privateFile(publicKeyFile));if(key.asymmetricKeyType!=='ed25519')deny();
 await mkdir(stateRoot,{recursive:true,mode:0o700});const st=await lstat(stateRoot);if(st.isSymbolicLink()||st.mode&0o077||await realpath(stateRoot)!==resolve(stateRoot))deny();
 await preflight(policy.image,policy.release.lockDigest,profileDigest);
 return Object.freeze({async run(request,{signal}={}){
  exact(request,['caseId','investigationId','testProfile','bundle','patch','approval']);
  if(Date.parse(policy.expiresAt)<=Date.now()||signal?.aborted)deny();
  const prepared=prepare(request.bundle,request.patch,policy.release);
  const permit=grant(request.approval,key,{...request,revision:policy.release.revision,patchDigest:prepared.patchDigest,image:policy.image});
  // Live case authorization is supplied by a reviewed gateway adapter outside the model.
  const controller=new AbortController();const revoke=()=>controller.abort();signal?.addEventListener('abort',revoke,{once:true});
  const live=async()=>{if(!executionEnabled()||signal?.aborted||controller.signal.aborted||Date.parse(permit.expiresAt)<=Date.now()||Date.parse(policy.expiresAt)<=Date.now()||!await authorize({caseId:permit.caseId,investigationId:permit.investigationId,signal:controller.signal}))deny();};
  let poll,lease;
  try{
   await live();lease=await reserve(stateRoot,permit);const {slot}=lease;
   const base={version:1,grantId:permit.id,caseId:permit.caseId,investigationId:permit.investigationId,slot,revision:permit.revision,patchDigest:permit.patchDigest,testProfile:permit.testProfile,image:permit.image};
   await append(join(stateRoot,'audit.ndjson'),{...base,event:'start',at:new Date().toISOString()});
   let checking=false;
   poll=setInterval(()=>{if(checking){controller.abort();return;}checking=true;live().catch(()=>controller.abort()).finally(()=>{checking=false;});},1000);
   const result=await execute(policy.image,{files:prepared.files,testProfile:permit.testProfile},{signal:controller.signal});
   await live();
   const quarantined=sensitive(result.output)||result.reason==='output_limit';
   const output=quarantined?'':result.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
   const count=label=>quarantined?null:Number(output.match(new RegExp(`^# ${label} (\\d+)$`,'m'))?.[1]??0);
   const report={...base,exitCode:result.exitCode,reason:result.reason,durationMs:result.durationMs,outputBytes:result.outputBytes,outputDigest:hash(result.output),quarantined,output,provenance:'untrusted_sandbox_output',testCountsTrust:'untrusted_test_reporter',testCounts:{passed:count('pass'),failed:count('fail'),skipped:count('skipped')},limits:{cpu:1,memoryMiB:1024,diskMiB:512,pids:128}};
   await append(join(stateRoot,'audit.ndjson'),{...base,event:quarantined?'quarantine':'complete',at:new Date().toISOString(),exitCode:result.exitCode,outputDigest:report.outputDigest,outputBytes:result.outputBytes});
   await live();return report;
  }finally{
   clearInterval(poll);signal?.removeEventListener('abort',revoke);controller.abort();prepared.files.length=0;
   await lease?.release();
  }
 }});
}
