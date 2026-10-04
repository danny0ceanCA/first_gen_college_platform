import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {recentlyAuthenticated,AUTH_TIME_CLAIM} from './recent-auth.mjs';
import {createLifecycleHandler} from './account-lifecycle.mjs';
import {createInstitutionHandler} from './institutions.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {fixture} from './family-fixture.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {createInstitutionRepository} from './institutions.mjs';
const {onExecutePostLogin}=createRequire(import.meta.url)('../auth0/recent-auth-action.cjs');
test('fresh authentication uses only the trusted authentication timestamp, never token issuance or request data',()=>{
 const now=1800000000000,time=now/1000;
 for(const value of [undefined,'1800000000',time+1,time-301,0,NaN])assert.equal(recentlyAuthenticated({[AUTH_TIME_CLAIM]:value,iat:time},now),false);
 assert.equal(recentlyAuthenticated({[AUTH_TIME_CLAIM]:time-300},now),true);assert.equal(recentlyAuthenticated({[AUTH_TIME_CLAIM]:time},now),true);
});
test('Auth0 action retains the provider authentication time and omits missing session timestamps',async()=>{
 const claims=[];const api={accessToken:{setCustomClaim:(...args)=>claims.push(args)}};
 await onExecutePostLogin({session:{authenticated_at:'2026-10-03T00:00:00Z'}},api);assert.deepEqual(claims,[[AUTH_TIME_CLAIM,Date.parse('2026-10-03T00:00:00Z')/1000]]);
 await onExecutePostLogin({refresh_token:{},session:{}},api);assert.equal(claims.length,1);
});
test('destructive HTTP operations reject stale identities before database connections',async()=>{
 let connections=0;const database={connect:async()=>{connections++;throw new Error();}};
 for(const [handler,input] of [[createLifecycleHandler(database),{action:'delete',confirmation:'DELETE'}],[createInstitutionHandler(database,{INSTITUTION_REVIEWER_SUBJECTS:'reviewer'}),{action:'verify',id:crypto.randomUUID(),revision:1,note:'Verified'}],[createInstitutionHandler(database),{action:'publish',id:crypto.randomUUID(),revision:1,note:'Approved'}]]){
  const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url:input.action==='delete'?'/api/account-data':'/api/institutions',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'reviewer',iat:Math.floor(Date.now()/1000)}});
  const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};await handler(req,res,()=>assert.fail());assert.equal(res.status,403);assert.equal(res.body.error,'reauthentication_required');
 }assert.equal(connections,0);
});
test('account guard locks before checking closure and blocks writes when closure won the race',async()=>{
 const calls=[];const client={query:async(sql)=>{calls.push(sql);return {rows:sql.includes('origen_closed_accounts')?[{subject_hash:'closed'}]:[]};}};
 await assert.rejects(guardAccountTransaction(client,'subject'),{status:403});assert.match(calls[0],/INSERT INTO origen_subject_locks/);assert.match(calls[1],/FOR UPDATE/);assert.match(calls[2],/origen_closed_accounts/);
});

test('closed identities cannot recreate family or institution records via repository transactions',async()=>{
 const {pool,run}=await fixture();try{
  await run('closed',{action:'load'});await createLifecycleRepository(pool)('closed',{action:'delete',confirmation:'DELETE'});
  await assert.rejects(run('closed',{action:'load'}),{status:403});
  await assert.rejects(createInstitutionRepository(pool)('closed',{action:'register',representative:{firstName:'A',workEmail:'a@example.edu',jobRole:'Staff'},page:{name:'College',website:'https://example.edu',description:'Test',links:[]}}),{status:403});
  assert.equal((await pool.query('SELECT * FROM origen_accounts')).rows.length,0);assert.equal((await pool.query('SELECT * FROM origen_institution_representatives')).rows.length,0);
 }finally{await pool.end();}
});
