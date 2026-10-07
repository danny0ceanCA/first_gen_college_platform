import test from 'node:test';
import assert from 'node:assert/strict';
import {assessReadiness,REQUIRED_GATES} from './readiness.mjs';
import {rehearseRecovery,replaySyntheticClosures} from './recovery-rehearsal.mjs';
import {fixture} from '../server/family-fixture.mjs';
import {subjectHash} from '../server/account-lifecycle.mjs';
import {createLinksRepository} from '../server/account-links.mjs';
const now=new Date('2026-10-07T12:00:00Z');
const valid=()=>({schemaVersion:1,gates:REQUIRED_GATES.map(id=>({id,status:'verified',owner:'Synthetic test owner',approvedBy:'Synthetic reviewer',evidence:['synthetic evidence'],checkedAt:'2026-10-07T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z'}))});
test('readiness fails closed for pending, missing, duplicate, stale and future evidence',()=>{
 assert.equal(assessReadiness(valid(),now).ready,true);
 for(const mutate of [r=>r.gates.pop(),r=>r.gates.push(r.gates[0]),r=>r.gates[0].status='pending',r=>r.gates[0].owner='',r=>r.gates[0].approvedBy='',r=>r.gates[0].evidence=[],r=>r.gates[0].expiresAt='2026-10-06',r=>r.gates[0].checkedAt='2026-10-08']){const r=valid();mutate(r);assert.equal(assessReadiness(r,now).ready,false);}
});
test('synthetic stale restore cannot resurrect a closed account after replay',async()=>assert.equal((await rehearseRecovery()).status,'passed'));
test('replay halts on family obligations rather than silently deleting shared students',async()=>{
 const f=await fixture();try{
  await f.run('owner',{action:'save-student',student:{id:'s',name:'Synthetic',stage:'10th grade',notes:''}});
  const links=createLinksRepository(f.pool);const invite=await links('owner',{action:'create',studentId:'s',role:'student'});await links('member',{action:'accept',token:invite.token});
  const before=(await f.pool.query('SELECT * FROM origen_students')).rows;
  await assert.rejects(replaySyntheticClosures(f.pool,[{subject_hash:subjectHash('owner'),closed_at:new Date().toISOString()}]),{status:409});
  assert.deepEqual((await f.pool.query('SELECT * FROM origen_students')).rows,before);
 }finally{await f.pool.end();}
});
