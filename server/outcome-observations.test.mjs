import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {outcomeObservationFixture,observationPayload} from './fixtures/outcome-observations.mjs';
import {validateOutcomeObservation,validateOutcomeDispute} from '../src/outcomeObservation.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
test('observation contracts reject verification authority, private references, unsafe sources and inferred independence',()=>{
 assert.deepEqual(validateOutcomeObservation(observationPayload()),observationPayload());
 for(const extra of [{institutionVerified:true},{privateReportId:randomUUID()},{evaluationAllowed:true},{author:'Maria'},{independent:true}])assert.throws(()=>validateOutcomeObservation({...observationPayload(),...extra}),{status:400});
 assert.throws(()=>validateOutcomeObservation({...observationPayload(),sourceReference:{kind:'submission_receipt',on:null,url:'https://private.example'}}),{status:400});
 assert.throws(()=>validateOutcomeObservation({...observationPayload(),basis:'student_account',sourceReference:null,dependsOnStudentStatement:'no'}),{status:400});
 assert.throws(()=>validateOutcomeDispute({detail:'No',visibility:'shared',confirmed:true}),{status:400});
});
test('ordinary response permission cannot create evidence; exact approved observation is idempotent and attributed',db,async t=>{
 const f=await outcomeObservationFixture(t);assert.equal((await f.observe({action:'load'})).capabilities.length,0);await assert.rejects(f.observationPrepare(),{status:403});await f.grant();
 const p=await f.observationPrepare();assert.equal(p.adviceRelationship,'same_author');assert.equal((await f.studentObservations({action:'load'})).observations.length,0);
 const saved=await f.observationConfirm(p);assert.equal(saved.status,'published');assert.deepEqual(await f.observationConfirm(p),saved);
 const record=(await f.studentObservations({action:'load'})).observations[0];assert.equal(record.id,saved.id);assert.equal(record.institutionVerified,false);assert.equal(record.independence,'not_established');assert.equal(record.payload.basis,'declared_record_review');assert.equal(record.adviceRelationship,'same_author');assert.equal(record.dispute,null);
 assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');assert.equal((await f.load()).reports.length,0);
});
async function published(t){const f=await outcomeObservationFixture(t);await f.grant();const saved=await f.observationConfirm(await f.observationPrepare());return {...f,saved};}
async function dispute(f,record,visibility='private',detail='The receipt is for another document.'){
 return (await f.studentObservations({action:'prepare-dispute',observationId:record.id,observationVersion:record.version,version:record.dispute?.version||0,operationId:randomUUID(),payload:{visibility,detail}})).preview;
}
const confirmDispute=(f,p)=>f.studentObservations({action:'confirm-dispute',previewId:p.id,digest:p.digest,confirmed:true});
test('outcome capability is limited by organization, recipient, definition and evidence basis',db,async t=>{
 const f=await outcomeObservationFixture(t);await f.grant('document_submitted',['student_account']);
 await assert.rejects(f.observationPrepare(),{status:403});
 for(const actor of ['colleague','owner','reader','other'])await assert.rejects(f.observe({action:'load'},actor),e=>[403,404].includes(e.status));
 await assert.rejects(f.observe({action:'load',organizationId:randomUUID()}));
 await f.grant();const body=observationPayload();body.claim.definitionId='waiver_approved';await assert.rejects(f.observationPrepare({payload:body}),{status:403});
 for(const table of ['origen_outcome_observations','origen_outcome_observation_disputes','origen_outcome_observation_previews','origen_outcome_review_capabilities'])await assert.rejects(f.as('staff',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
 await assert.rejects(f.as('staff',()=>f.db.query('SELECT origen_outcome_review_grant(null,null,null,null,null)')),{code:'42501'});
 await assert.rejects(f.as('other',()=>f.db.query('SELECT origen_outcome_observation_view(null,true)')),{code:'42501'});
});
test('a quote and known scope must come from the selected approved source, never hidden reports or an unrelated term',db,async t=>{
 const f=await outcomeObservationFixture(t);await f.grant();
 const hidden=observationPayload();hidden.selection.quote='PRIVATE_PLAN_NOT_SHARED';await assert.rejects(f.observationPrepare({payload:hidden}),{status:409});
 const scope=observationPayload();scope.claim.scope.term='2027–2028';await assert.rejects(f.observationPrepare({payload:scope}),{status:409});
 const note=observationPayload();note.selection={kind:'note',entryId:f.notes[2],quote:'UNPUBLISHED_SENTINEL'};await assert.rejects(f.observationPrepare({payload:note}),{status:409});
 const future=observationPayload();future.observedOn='2099-01-01';await assert.rejects(f.observationPrepare({payload:future}),{status:400});
 const unknown=observationPayload();unknown.claim.scope={institution:null,term:null,cycle:null};unknown.claim.claimStatus='unknown';unknown.position='cannot_establish';unknown.basis='student_account';unknown.dependsOnStudentStatement='yes';unknown.sourceReference=null;unknown.eventOn=null;
 await f.observationConfirm(await f.observationPrepare({payload:unknown}));const record=(await f.studentObservations({action:'load'})).observations[0];assert.equal(record.payload.position,'cannot_establish');assert.equal(record.payload.claim.scope.term,null);assert.equal(record.institutionVerified,false);
});
test('source, grant, membership, verification and paused-flag changes reject staged observations',db,async t=>{
 for(const change of ['withdrawal','capability','basis','expiry','membership','blocked','flag'])await t.test(change,async t=>{
  const f=await outcomeObservationFixture(t);await f.grant();const p=await f.observationPrepare();
  if(change==='withdrawal')await f.student({action:'withdraw',id:f.shared.id,version:f.shared.version});
  if(change==='capability'){await f.grant('document_submitted',[],false);await f.grant();}
  if(change==='basis')await f.grant('document_submitted',['student_account']);
  if(change==='expiry')await f.owner.query("UPDATE origen_outcome_review_capabilities SET expires_at=clock_timestamp()-interval '1 second'");
  if(change==='membership')await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);
  if(change==='blocked')await f.owner.query("INSERT INTO origen_staff_access_controls(subject_hash,blocked) VALUES(encode(sha256(convert_to('staff','UTF8')),'hex'),true) ON CONFLICT(subject_hash) DO UPDATE SET blocked=true");
  if(change==='flag')f.env.ORIGEN_OUTCOME_EVIDENCE='false';
  await assert.rejects(f.observationConfirm(p));assert.equal((await f.studentObservations({action:'load'})).observations.length,0);
 });
});
test('duplicate preparations cannot create duplicate observations or apply stale competing corrections',db,async t=>{
 const f=await outcomeObservationFixture(t);await f.grant();const a=await f.observationPrepare(),b=await f.observationPrepare();const saved=await f.observationConfirm(a);await assert.rejects(f.observationConfirm(b),{status:409});
 const first=await f.observationPrepare({observationId:saved.id,version:1,payload:{...observationPayload(),observation:'First correction.'}}),second=await f.observationPrepare({observationId:saved.id,version:1,payload:{...observationPayload(),observation:'Second correction.'}});
 await f.observationConfirm(first);await assert.rejects(f.observationConfirm(second),{status:409});assert.equal((await f.observationConfirm(a)).status,'superseded');
 const records=(await f.studentObservations({action:'load'})).observations;assert.equal(records.length,1);assert.equal(records[0].version,2);assert.equal(records[0].payload.observation,'First correction.');assert.equal(records[0].author.name,a.author.name);
});
test('private disagreements are invisible to coordinator payloads, counts and exports until a separate exact sharing approval',db,async t=>{
 const f=await published(t);const before=await f.observe({action:'load'}),record=(await f.studentObservations({action:'load'})).observations[0],p=await dispute(f,record);
 assert.equal(p.payload.visibility,'private');assert.equal((await f.studentObservations({action:'load'})).observations[0].dispute,null);const saved=await confirmDispute(f,p);assert.deepEqual(await confirmDispute(f,p),saved);
 assert.deepEqual(await f.observe({action:'load'}),before);
 const privateRecord=(await f.studentObservations({action:'load'})).observations[0];assert.equal(privateRecord.dispute.detail,'The receipt is for another document.');assert.equal(privateRecord.dispute.visibility,'private');
 const shared=await dispute(f,privateRecord,'shared');assert.equal(shared.author.name,record.author.name);assert.deepEqual(await f.observe({action:'load'}),before);await confirmDispute(f,shared);
 const publicRecord=(await f.observe({action:'load'})).observations[0];assert.equal(publicRecord.dispute.visibility,'shared');assert.equal(publicRecord.dispute.observationVersion,1);assert.equal(publicRecord.institutionVerified,false);
 const privateAgain=await dispute(f,(await f.studentObservations({action:'load'})).observations[0],'private','Keep my revised concern private.');await confirmDispute(f,privateAgain);assert.deepEqual(await f.observe({action:'load'}),before);
});
test('student disputes bind exact observation revisions and never imply agreement with a correction',db,async t=>{
 const f=await published(t),record=(await f.studentObservations({action:'load'})).observations[0];await confirmDispute(f,await dispute(f,record,'shared'));
 const old=(await f.studentObservations({action:'load'})).observations[0],pending=await dispute(f,old,'shared','A pending update.');
 await f.observationConfirm(await f.observationPrepare({observationId:record.id,version:1,payload:{...observationPayload(),position:'cannot_establish',observation:'I cannot establish which document the receipt covers.'}}));
 await assert.rejects(confirmDispute(f,pending),{status:409});const revised=(await f.studentObservations({action:'load'})).observations[0];assert.equal(revised.version,2);assert.equal(revised.dispute.observationVersion,1);assert.equal(revised.dispute.detail,'The receipt is for another document.');
 const after=await dispute(f,revised,'private');await confirmDispute(f,after);const d=(await f.studentObservations({action:'load'})).observations[0].dispute;
 await f.studentObservations({action:'delete-dispute',observationId:revised.id,version:d.version,confirmed:true});assert.equal((await confirmDispute(f,after)).status,'superseded');assert.equal((await f.studentObservations({action:'load'})).observations[0].dispute,null);
});
test('private report and action edits do not leak through coordinator evidence, and paused evidence still permits private disagreement and withdrawal',db,async t=>{
 const f=await published(t);await f.enroll();const report=await f.seedReport(),before=await f.observe({action:'load'});
 await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='PRIVATE_CORRECTION_NOT_DISCLOSED' WHERE id=$1",[report]);await f.edit(p=>{p.steps[0].notes='PRIVATE_ACTION_EDIT';return p;});assert.deepEqual(await f.observe({action:'load'}),before);
 f.env.ORIGEN_OUTCOME_EVIDENCE='false';const record=(await f.studentObservations({action:'load'})).observations[0];await confirmDispute(f,await dispute(f,record));await assert.rejects(dispute(f,(await f.studentObservations({action:'load'})).observations[0],'shared'),{status:404});
 const withdraw={action:'withdraw',publicationId:f.shared.publication.id,observationId:record.id,version:1,confirmed:true};assert.equal((await f.observe(withdraw)).status,'withdrawn');assert.equal((await f.observe(withdraw)).status,'withdrawn');const removed=(await f.studentObservations({action:'load'})).observations[0];assert.equal(removed.payload,null);assert.equal(removed.dispute,null);assert.equal((await f.load()).reports[0].detail,'PRIVATE_CORRECTION_NOT_DISCLOSED');
});
test('student scope and approval endpoint cannot be forged, including sharing a disagreement after access loss',db,async t=>{
 const f=await published(t),r=(await f.studentObservations({action:'load'})).observations[0],p=await dispute(f,r,'shared');
 await assert.rejects(f.studentObservations({action:'load'},'reader'));await assert.rejects(f.studentObservations({action:'load',studentId:'sam'}),{status:404});
 await assert.rejects(f.observe({action:'confirm',publicationId:f.shared.publication.id,previewId:p.id,digest:p.digest,confirmed:true}),{status:409});
 await f.student({action:'withdraw',id:f.shared.id,version:f.shared.version});await assert.rejects(confirmDispute(f,p));const historical=(await f.studentObservations({action:'load'})).observations[0];assert.equal(historical.availability,'historical');assert.equal(historical.dispute,null);await confirmDispute(f,await dispute(f,historical,'private'));
});
test('export, request erasure, restore fences and author closure cannot resurrect observations or disagreement text',db,async t=>{
 const {createLifecycleRepository}=await import('./account-lifecycle.mjs'),{exportDeletionManifest,replayDeletionManifest}=await import('../ops/privacy-recovery.mjs');
 const f=await published(t),record=(await f.studentObservations({action:'load'})).observations[0];await confirmDispute(f,await dispute(f,record));
 const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.equal(exported.outcomeObservations[0].dispute.visibility,'private');
 const staffExport=await f.as('staff',()=>createLifecycleRepository(f.db)('staff',{action:'export'}));assert.equal(staffExport.coordinatorSharing.outcomeObservations[0].dispute,null);
 const manifest=await exportDeletionManifest(f.owner);assert.doesNotMatch(JSON.stringify(manifest),/receipt|Example University|another document/);const p=await f.observationPrepare({observationId:record.id,version:1});
 await replayDeletionManifest(f.owner,manifest);assert.equal((await f.studentObservations({action:'load'})).observations[0].availability,'historical');assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_observation_previews')).rows[0].n,0);await assert.rejects(f.observationConfirm(p));
 await f.student({action:'remove',id:f.shared.id,version:f.shared.version});for(const table of ['origen_outcome_observations','origen_outcome_observation_disputes'])assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
});
test('a closed author identity erases attributed observations and staged content across student accounts',db,async t=>{
 const f=await published(t);await f.owner.query("INSERT INTO origen_closed_accounts(subject_hash) VALUES(encode(sha256(convert_to('staff','UTF8')),'hex'))");assert.equal((await f.studentObservations({action:'load'})).observations.length,0);
});
test('removal erases disagreement prose without recycling revisions or accepting an old deletion',db,async t=>{
 const f=await published(t),r=(await f.studentObservations({action:'load'})).observations[0];
 const old=await dispute(f,r,'shared','An old shared disagreement.');await confirmDispute(f,old);
 const deletion={action:'delete-dispute',observationId:r.id,version:1,confirmed:true};await f.studentObservations(deletion);await f.studentObservations(deletion);
 assert.equal((await f.owner.query('SELECT detail FROM origen_outcome_observation_disputes WHERE observation_id=$1',[r.id])).rows[0].detail,null);
 const fresh=(await f.studentObservations({action:'load'})).observations[0];assert.equal(fresh.dispute,null);await confirmDispute(f,await dispute(f,fresh,'private','A new private disagreement.'));
 assert.equal((await confirmDispute(f,old)).status,'superseded');await assert.rejects(f.studentObservations(deletion),{status:409});
 assert.equal((await f.studentObservations({action:'load'})).observations[0].dispute.version,3);assert.equal((await f.observe({action:'load'})).observations[0].dispute,null);
});
test('restore suppresses an observation when the disagreement revision cannot be preserved exactly',db,async t=>{
 const {exportDeletionManifest,replayDeletionManifest}=await import('../ops/privacy-recovery.mjs');
 const f=await published(t),r=(await f.studentObservations({action:'load'})).observations[0];await confirmDispute(f,await dispute(f,r,'private','Do not resurrect this disagreement.'));
 const manifest=await exportDeletionManifest(f.owner);await f.owner.query("UPDATE origen_outcome_observation_disputes SET version=version+1,detail='A different revision' WHERE observation_id=$1",[r.id]);
 await replayDeletionManifest(f.owner,manifest);assert.equal((await f.studentObservations({action:'load'})).observations.length,0);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_outcome_observation_disputes')).rows[0].n,0);
});
test('outcome startup fails closed on missing observation migration, missing scoped command or raw helper access',db,async t=>{
 const {assertOutcomeEvidenceReady}=await import('./outcome-evidence.mjs');const f=await outcomeObservationFixture(t);await f.as('other',()=>assertOutcomeEvidenceReady(f.db,f.env));
 const migration=(await f.owner.query("DELETE FROM origen_schema_migrations WHERE name='111_coordinator_outcome_observations.sql' RETURNING *")).rows[0];await assert.rejects(f.as('other',()=>assertOutcomeEvidenceReady(f.db,f.env)),/migration_required/);
 await f.owner.query('INSERT INTO origen_schema_migrations(name,checksum) VALUES($1,$2)',[migration.name,migration.checksum]);
 const role=(await f.db.query('SELECT current_user AS name')).rows[0].name;assert.match(role,/^[a-zA-Z0-9_]+$/);
 await f.owner.query(`REVOKE EXECUTE ON FUNCTION origen_student_outcome_observation_command(jsonb) FROM "${role}"`);await assert.rejects(f.as('other',()=>assertOutcomeEvidenceReady(f.db,f.env)),/migration_required/);
 await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_student_outcome_observation_command(jsonb) TO "${role}"`);
 await f.owner.query(`GRANT EXECUTE ON FUNCTION origen_outcome_observation_view(uuid,boolean) TO "${role}"`);await assert.rejects(f.as('other',()=>assertOutcomeEvidenceReady(f.db,f.env)),/runtime_isolation_required/);
});
test('observation HTTP access requires fresh verified staff identity and rejects client-granted authority',db,async t=>{
 const {Readable}=await import('node:stream'),{createOutcomeObservationHandler,validateOutcomeObservationCommand}=await import('./outcome-observations.mjs'),{MFA_TIME_CLAIM}=await import('./staff-access.mjs'),{AUTH_TIME_CLAIM}=await import('./recent-auth.mjs');
 const f=await outcomeObservationFixture(t);await f.grant();const seconds=Math.floor(Date.now()/1000),input={action:'load',organizationId:f.org,id:f.shared.id};
 assert.throws(()=>validateOutcomeObservationCommand({...input,enabled:true},true),{status:400});
 const identity={sub:'staff',iat:seconds,[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds};
 async function check(who,verified=true){
  const req=Readable.from([JSON.stringify(input)]);Object.assign(req,{url:'/api/coordinator-outcome-observations',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer staff'},origenAuthorized:true,origenIdentity:who});
  let status,body;const res={writeHead:s=>{status=s;},end:value=>{body=JSON.parse(value);}};
  const handler=createOutcomeObservationHandler(f.db,f.env,async()=>new Response(JSON.stringify({sub:'staff',email:'staff@example.test',email_verified:verified}),{status:200}));await f.as('staff',()=>handler(req,res,()=>assert.fail('route fell through')));return {status,body};
 }
 assert.equal((await check({...identity,[MFA_TIME_CLAIM]:undefined})).body.error,'staff_mfa_required');assert.equal((await check({...identity,[AUTH_TIME_CLAIM]:seconds-86400})).body.error,'reauthentication_required');assert.equal((await check(identity,false)).status,403);
 await f.owner.query("INSERT INTO origen_staff_access_controls(subject_hash,token_valid_after) VALUES(encode(sha256(convert_to('staff','UTF8')),'hex'),clock_timestamp()+interval '1 minute')");assert.equal((await check(identity)).body.error,'staff_access_revoked');
 assert.equal((await f.studentObservations({action:'load'})).observations.length,0);
});
