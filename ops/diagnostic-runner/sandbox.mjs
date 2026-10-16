import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {limits} from './profiles.mjs';
import {deny} from './contracts.mjs';
// This module belongs on a disposable, credential-free Linux VM, never in the application service.
// Docker's socket stays on that VM's trusted controller; no host mounts enter the sandbox.
export function argumentsFor(image,name){return ['run','--name',name,'--pull=never','--runtime=runsc','--network=none','--read-only','--user=65532:65532','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=1g','--memory-swap=1g','--pids-limit=128','--ulimit=nofile=256:256','--ulimit=core=0','--ipc=none','--log-driver=none','--tmpfs=/workspace:rw,nosuid,nodev,size=512m,mode=1777','--workdir=/workspace','--env=HOME=/workspace','--env=TMPDIR=/workspace','--env=NODE_ENV=test','--label=origen.synthetic-runner=true','-i',image];}
export function command(args,{input='',max=65536,timeout=10000}={}){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/docker',args,{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_HOST:'unix:///var/run/docker.sock'},stdio:['pipe','pipe','pipe']});let size=0,parts=[],settled=false;
 const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('runtime_unavailable'));},timeout);
 function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);}
 for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{size+=data.length;if(size>max){child.kill('SIGKILL');finish(new Error('runtime_unavailable'));}else parts.push(data);});
 child.on('error',()=>finish(new Error('runtime_unavailable')));child.on('close',code=>code===0?finish(null,Buffer.concat(parts).toString()):finish(new Error('runtime_unavailable')));child.stdin.on('error',()=>{});child.stdin.end(input);
});}
export async function preflight(image,lockDigest,profileDigest){
 if(process.platform!=='linux')deny();
 const info=JSON.parse(await command(['info','--format','{{json .}}']));
 if(!info.Runtimes?.runsc||info.CgroupVersion!=='2'||!info.MemoryLimit||!info.PidsLimit||!info.CPUCfsQuota||!info.SwapLimit||info.Warnings?.length)deny();
 const [meta]=JSON.parse(await command(['image','inspect',image]));
 if(!meta.RepoDigests?.includes(image)||meta.Config?.Labels?.['org.origen.lock']!==lockDigest||meta.Config?.Labels?.['org.origen.profiles']!==profileDigest||meta.Config?.User!=='65532:65532'||JSON.stringify(meta.Config.Entrypoint)!==JSON.stringify(['node','/runner/entrypoint.mjs']))deny();
}
export async function execute(image,payload,{signal}={}){
 if(signal?.aborted)deny();const name=`origen-diagnostic-${randomUUID()}`,started=Date.now();
 let child,timer,stopReason=null,bytes=0,chunks=[],killWork,removed=false;
 const stop=reason=>{stopReason??=reason;killWork??=command(['rm','-f',name]).then(()=>{removed=true;return true;},()=>false).finally(()=>child?.kill('SIGKILL'));child?.stdin.destroy();};
 const abort=()=>stop('revoked');signal?.addEventListener('abort',abort,{once:true});
 try{
  const status=await new Promise((resolve,reject)=>{
   child=spawn('/usr/bin/docker',argumentsFor(image,name),{shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',DOCKER_HOST:'unix:///var/run/docker.sock'},stdio:['pipe','pipe','pipe']});
   timer=setTimeout(()=>stop('timeout'),limits.timeoutMs);
   for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{bytes+=data.length;if(bytes>limits.outputBytes){chunks=[];stop('output_limit');}else if(!stopReason)chunks.push(data);});
   child.on('error',()=>reject(new Error('runtime_unavailable')));child.on('close',code=>resolve(code));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
  });
  if(killWork&&!await killWork)throw new Error('sandbox_cleanup_failed');
  const [inspection]=JSON.parse(await command(['inspect',name]).catch(()=> '[{}]'));
  return {exitCode:status,reason:stopReason??(inspection.State?.OOMKilled?'memory_limit':'completed'),durationMs:Date.now()-started,outputBytes:bytes,output:Buffer.concat(chunks).toString('utf8'),memoryLimitBytes:1073741824,cpuLimit:1};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{if(!removed)await command(['rm','-f',name]);}finally{child?.kill('SIGKILL');chunks=[];}}
}
