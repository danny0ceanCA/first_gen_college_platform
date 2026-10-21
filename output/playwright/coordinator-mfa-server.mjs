// Isolated browser fixture; synthetic Auth0 only, with private loopback controls.
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {coordinatorRegistrationFixture} from '../../server/fixtures/coordinator-registration.mjs';
import {MFA_TIME_CLAIM} from '../../server/staff-access.mjs';
const url=new URL(process.env.DATABASE_TEST_URL||'');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('disposable_loopback_database_required');
const f=await coordinatorRegistrationFixture();f.actor('applicant',{mfa:false});
const control=createServer(async(req,res)=>{
 if(req.method!=='POST'||req.headers['x-synthetic-secret']!==f.transportSecret){res.writeHead(401);return res.end();}
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024){res.writeHead(413);return res.end();}}
 try{const {mode}=JSON.parse(raw);
  if(mode==='fresh')f.actor('applicant');
  else if(mode==='none')f.actor('applicant',{mfa:false});
  else if(mode==='stale-write')f.actor('applicant',{claims:n=>({[MFA_TIME_CLAIM]:n-301})});
  else throw Error('unknown_mode');
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true}));
 }catch{res.writeHead(400);res.end();}
});
await new Promise(r=>control.listen(0,'127.0.0.1',r));
await writeFile('tmp/coordinator-mfa-browser.json',JSON.stringify({base:f.base,secret:f.transportSecret,control:`http://127.0.0.1:${control.address().port}`}));
let closing=false;async function stop(){if(closing)return;closing=true;await new Promise(r=>{control.close(r);control.closeAllConnections();});await f.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.stdin.on('data',data=>{if(data.toString().trim()==='stop')void stop();});
console.log('Isolated MFA browser fixture ready.');
