import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {isAdmin,hasAdminAccess,creditedSeconds,createAdminHandler} from './admin.mjs';
import {fixture} from './family-fixture.mjs';
import {readFile} from 'node:fs/promises';
test('admin authorization is exact server subject allowlist, empty fails closed',()=>{
 assert.equal(isAdmin('auth0|owner',{}),false);assert.equal(isAdmin('auth0|owner',{ADMIN_SUBJECTS:' auth0|owner,google-oauth2|other '}),true);assert.equal(isAdmin('owner',{ADMIN_SUBJECTS:'auth0|owner'}),false);
});
test('Auth0 access-token permission grants access; profile roles and scope do not',()=>{
 assert.equal(hasAdminAccess({sub:'auth0|admin',permissions:['read:activity']},{}),true);
 assert.equal(hasAdminAccess({sub:'auth0|user',role:'admin',scope:'read:activity',user_metadata:{role:'admin'}},{}),false);
 assert.equal(hasAdminAccess({sub:'auth0|user',permissions:['read:profile']},{}),false);
});
async function request(handler,subject,data,authorized=true){const req=Readable.from([JSON.stringify(data)]);Object.assign(req,{url:'/api/admin',origenAuthorized:authorized,origenIdentity:{sub:subject}});const out={};const res={writeHead(status){out.status=status;},end(body){out.body=body?JSON.parse(body):null;}};await handler(req,res,()=>{throw Error('unexpected next');});return out;}
test('unauthenticated and ordinary users cannot query dashboard or touch database',async()=>{
 const handler=createAdminHandler({query(){throw Error('must not query');}},{ADMIN_SUBJECTS:'auth0|owner'});
 assert.equal((await request(handler,'auth0|owner',{action:'overview'},false)).status,401);
 assert.equal((await request(handler,'auth0|other',{action:'overview',admin:true})).status,403);
 assert.equal((await request(handler,'auth0|owner',{action:'access'})).status,200);
});
test('disconnected gaps and long calls have bounded connected-minute credit',()=>{
 assert.equal(creditedSeconds(0,15,0),15);assert.equal(creditedSeconds(20,400,20),50);assert.equal(creditedSeconds(590,30,590),600);assert.equal(creditedSeconds(90,30,700),90);
});
test('activity records deduplicate sign-ins and cascade on deletion',async()=>{
 const {pool,run}=await fixture();try{
 await pool.query(await readFile(new URL('./migrations/017_admin_activity.sql',import.meta.url),'utf8'));
 await run('auth0|owner',{action:'load'});const owner=(await pool.query('SELECT id FROM origen_accounts')).rows[0].id;
 const id=crypto.randomUUID();for(let i=0;i<2;i++)await pool.query('INSERT INTO origen_login_activity(id,account_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[id,owner]);
 assert.equal((await pool.query('SELECT * FROM origen_login_activity')).rows.length,1);
 await pool.query('INSERT INTO origen_voice_activity(id,account_id,topic) VALUES($1,$2,$3)',[crypto.randomUUID(),owner,'planning']);
 await pool.query('DELETE FROM origen_accounts WHERE id=$1',[owner]);assert.equal((await pool.query('SELECT * FROM origen_login_activity')).rows.length,0);assert.equal((await pool.query('SELECT * FROM origen_voice_activity')).rows.length,0);
 }finally{await pool.end();}
});
