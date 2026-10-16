import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSupportRepository,createSupportHandler,assertSupportReady} from './support-diagnostics.mjs';
import {staffPermissions,adminCapabilities} from './staff-access.mjs';
import {supportFixture,actor} from '../ops/diagnostics-gateway/test-fixture.mjs';
import {assertSupportResolver} from './support-diagnostics-grants.mjs';
test('support permission is explicit and independent of administrative or institution access',()=>{
 assert.ok(!staffPermissions({sub:'allowlisted'},{ADMIN_SUBJECTS:'allowlisted',INSTITUTION_REVIEWER_SUBJECTS:'allowlisted'}).includes('observability:investigate'));
 assert.deepEqual(staffPermissions({permissions:['observability:investigate','invented']}),['observability:investigate']);assert.equal(adminCapabilities({permissions:['observability:investigate']},{}).admin,false);
});
test('support intake is off by default and validates before connecting',async()=>{
 const handler=createSupportHandler(null,{}),res={writeHead(status){this.status=status;},end(){}};await handler({url:'/api/support-diagnostics'},res,()=>{});assert.equal(res.status,404);
 const repo=createSupportRepository({connect(){throw Error('must not connect');}});for(const input of [{},{action:'report',purpose:'arbitrary prose',reference:randomUUID()},{action:'report',purpose:'voice',reference:'email@example.com'}])await assert.rejects(repo('a',input),{status:400});
});
test('owned references resolve bounded cases; two accounts and students cannot widen scope',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await supportFixture();try{
  await assertSupportReady(f.appRuntime);await assertSupportResolver(f.appSupport);await assert.rejects(f.appSupport.query('SELECT * FROM origen_accounts'),{code:'42501'});await assert.rejects(f.appRuntime.query('SELECT origen_support_scope($1,$2,$3,false)',[randomUUID(),'a'.repeat(64),1]),{code:'42501'});
  const role=(await f.appSupport.query('SELECT current_user AS name')).rows[0].name;assert.match(role,/^[a-z0-9_]+$/);await f.appOwner.query(`GRANT SELECT(auth0_subject) ON origen_accounts TO "${role}"`);await assert.rejects(assertSupportResolver(f.appSupport));await f.appOwner.query(`REVOKE SELECT(auth0_subject) ON origen_accounts FROM "${role}"`);await assertSupportResolver(f.appSupport);
  const a=f.refs['synthetic-alice'][0],b=f.refs['synthetic-bob'][0];
  for(const ref of [b.operationId,b.requestId,randomUUID()])await assert.rejects(f.report('synthetic-alice',ref),{status:404});
  await f.appOwner.query("UPDATE origen_diagnostic_operations SET created_at=now()-interval '2 hours',expires_at=now()-interval '2 hours'+interval '336 hours' WHERE operation_id=$1",[a.operationId]);
  const report=await f.report('synthetic-alice',a.requestId),row=(await f.appOwner.query('SELECT * FROM origen_support_cases WHERE id=$1',[report.caseId])).rows[0];
  assert.deepEqual(row.operation_ids,[a.operationId]);assert.equal(row.window_end-row.window_start,1800000);assert.equal(row.origin,'user_report');
  assert.ok(Math.abs((row.window_start.getTime()+900000)-Date.now())<60000);
  await assert.rejects(f.closeCase('synthetic-bob',report.caseId),{status:404});
  assert.equal((await f.as('synthetic-bob',()=>f.db.query('SELECT id FROM origen_support_cases'))).rows.length,0);
  await assert.rejects(f.as('synthetic-alice',()=>f.db.query('UPDATE origen_support_cases SET operation_ids=$2 WHERE id=$1',[report.caseId,[b.operationId]])),{code:'42501'});
  const grant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'});assert.ok(grant.capability);
  await f.as('synthetic-alice',()=>f.permission.account('synthetic-alice',{action:'withdraw'}));
  await assert.rejects(f.investigator.evidence(actor(),grant.capability));
  assert.equal((await f.appOwner.query('SELECT status FROM origen_support_cases WHERE id=$1',[report.caseId])).rows[0].status,'closed');
  assert.ok((await f.appErasure.query('SELECT * FROM origen_telemetry_outbox_batch()')).rows.some(r=>r.kind==='case'&&r.reference===report.caseId));
 }finally{await f.close();}
});
