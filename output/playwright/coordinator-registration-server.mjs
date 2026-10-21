// Disposable local HTTP/database fixture. No real Auth0 credentials or users.
import {writeFile} from 'node:fs/promises';
import {coordinatorRegistrationFixture} from '../../server/fixtures/coordinator-registration.mjs';
const url=new URL(process.env.DATABASE_TEST_URL||'');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('disposable_loopback_database_required');
const f=await coordinatorRegistrationFixture();
await writeFile('tmp/coordinator-registration-browser.json',JSON.stringify({base:f.base,secret:f.transportSecret}));
async function stop(){await f.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.stdin.on('data',data=>{if(data.toString().trim()==='stop')void stop();});
console.log('Disposable registration API ready. Send stop to remove its schema and roles.');
