// Run only against a disposable loopback DATABASE_TEST_URL. Synthetic identities.
import {writeFile} from 'node:fs/promises';
import {coordinatorPilotFixture} from '../../server/fixtures/coordinator-pilot.mjs';
const url=new URL(process.env.DATABASE_TEST_URL||'');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('disposable_loopback_database_required');
const f=await coordinatorPilotFixture(),code=(await f.call('staff','/api/coordinator-access',{action:'rotate-code',id:f.org})).code;
await writeFile('tmp/coordinator-phase8-browser.json',JSON.stringify({base:f.base,secret:f.transportSecret,org:f.org,code}));
let running=false;
const timer=setInterval(async()=>{if(running)return;running=true;try{await f.sweep();}finally{running=false;}},1000);
async function stop(){clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,50));await f.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.stdin.on('data',data=>{if(data.toString().trim()==='stop')void stop();});
console.log('Synthetic Phase 8 browser API ready. Send stop on stdin to remove its schema and roles.');
