import {readFile,stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {openRunner} from './runner.mjs';
import {gatewayClient} from '../diagnostic-agent/gateway-client.mjs';
import {hash,deny} from './contracts.mjs';
import {capabilityEnabled} from '../diagnostic-controls.mjs';
export async function runCLI(env=process.env){
 if(env.DIAGNOSTIC_RUNNER_ENABLED!=='true'||Object.keys(env).some(k=>/(?:DATABASE_URL|OPENAI_API_KEY|AUTH0_CLIENT_SECRET|RENDER_API_KEY|AWS_ACCESS_KEY|SSH_AUTH_SOCK)/.test(k)&&env[k]))deny();
 async function file(path,max){if((await stat(path)).size>max)deny();return readFile(path,'utf8');}
 const jwt=(await file(env.RUNNER_GATEWAY_TOKEN_FILE,8192)).trim(),capability=(await file(env.RUNNER_CASE_CAPABILITY_FILE,8192)).trim();
 const gateway=gatewayClient({url:env.RUNNER_GATEWAY_URL,token:jwt});let initial;
 const runner=await openRunner({enabled:true,executionEnabled:()=>env.DIAGNOSTIC_RUNNER_ENABLED==='true'&&capabilityEnabled(env.DIAGNOSTIC_RUNNER_CONTROL_FILE),policyFile:env.RUNNER_POLICY_FILE,policyDigest:env.RUNNER_POLICY_SHA256,publicKeyFile:env.RUNNER_APPROVAL_PUBLIC_KEY_FILE,stateRoot:env.RUNNER_STATE_ROOT,
  authorize:async({caseId,signal})=>{const current=await gateway.validate(capability,signal);if(current.caseId!==caseId||current.environment!=='test'||Date.parse(current.expiresAt)<=Date.now())return false;const fingerprint=hash(JSON.stringify(current));initial??=fingerprint;return initial===fingerprint;}});
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{return await runner.run(JSON.parse(await file(env.RUNNER_REQUEST_FILE,20*1024*1024)),{signal:controller.signal});}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.stdout.write(JSON.stringify(await runCLI())+'\n');}catch{process.stderr.write('Diagnostic runner unavailable; no result released.\n');process.exitCode=1;}}
