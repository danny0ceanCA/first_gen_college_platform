import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateDatabase,runAsAccount} from './account-isolation.mjs';
import {runSharingCommand} from './binder-sharing.mjs';
import {runCoordinatorCommand} from './coordinator-access.mjs';

function fixture(errors){
 const calls=[];let clients=0;
 const pool={connect:async()=>{const id=++clients;return {query:async sql=>{
  calls.push([id,sql]);if(sql.startsWith('SELECT origen_')){const error=errors.shift();if(error)throw error;return {rows:[{result:{status:'withdrawn'}}]};}return {rows:[]};
 },release:error=>calls.push([id,'RELEASE',!!error])};}};
 return {db:isolateDatabase(pool),calls};
}
test('removal retries acquire a fresh scoped transaction only after rollback and release',async()=>{
 for(const code of ['40P01','40001']){
  const f=fixture([Object.assign(new Error('aborted'),{code})]);
  assert.deepEqual(await runAsAccount({sub:'synthetic'},()=>runSharingCommand(f.db,{action:'revoke'})),{status:'withdrawn'});
  assert.deepEqual(f.calls.filter(([,sql])=>['BEGIN','ROLLBACK','COMMIT','RELEASE'].includes(sql)),[[1,'BEGIN'],[1,'ROLLBACK'],[1,'RELEASE',false],[2,'BEGIN'],[2,'COMMIT'],[2,'RELEASE',false]]);
  for(const id of [1,2])assert.match(f.calls.find(([client,sql])=>client===id&&sql.startsWith('SET LOCAL'))[1],/origen.subject='synthetic'/);
 }
});
test('suspension retries are bounded; permanent, domain and uncertain transport failures are not retried',async()=>{
 const aborted=Object.assign(new Error('aborted'),{code:'40P01'}),f=fixture(Array(5).fill(aborted));
 await assert.rejects(runAsAccount({sub:'reviewer'},()=>runCoordinatorCommand(f.db,{action:'suspend-organization'})),error=>error===aborted);
 assert.equal(f.calls.filter(([,sql])=>sql==='BEGIN').length,4);
 for(const error of [Object.assign(new Error('connection lost'),{code:'ECONNRESET'}),Object.assign(new Error('denied'),{code:'42501'}),Object.assign(new Error('sharing_changed'),{status:409}),Object.assign(new Error('timeout'),{code:'57014'})]){
  const g=fixture([error]);await assert.rejects(runAsAccount({sub:'synthetic'},()=>runSharingCommand(g.db,{action:'revoke-all'})),e=>e===error);assert.equal(g.calls.filter(([,sql])=>sql==='BEGIN').length,1);
 }
});
test('publish and code creation never enter retry mode; caller-owned transactions are never replayed',async()=>{
 for(const input of [{action:'publish'},{action:'rotate-code'}]){
  const f=fixture([Object.assign(new Error('aborted'),{code:'40P01'})]);
  await assert.rejects(runAsAccount({sub:'synthetic'},()=>input.action==='publish'?runSharingCommand(f.db,input):runCoordinatorCommand(f.db,input)),{code:'40P01'});
  assert.equal(f.calls.filter(([,sql])=>sql==='BEGIN').length,1);
 }
 const f=fixture([]);await runAsAccount({sub:'synthetic'},async()=>{
  const client=await f.db.connect();assert.equal(client.queryRetryable,undefined);await client.query('BEGIN');await runSharingCommand(client,{action:'revoke-all'});await client.query('COMMIT');client.release();
 });
 assert.equal(f.calls.filter(([,sql])=>sql==='BEGIN').length,1);
});
