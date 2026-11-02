// Extension of the Phase 3 journey. All prose and identities are synthetic.
const assert=require('node:assert/strict');
const {userTurn,tool}=require('./review-request-release-smoke.cjs');
const {played}=require('./synthetic-voice-playback.cjs');
async function recordOutcome({page,f,entry,language,studentId,target,action,report}){
 const t=(en,es)=>language==='es'?es:en,outcomes=()=>f.call('other','/api/outcome-evidence',{action:'load',studentId,target});
 const payload={link:{episode:{definitionId:'office_contacted',definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle:t('Insurance documents','Documentos del seguro')},window:{start:'2026-01-01',end:'2026-12-31',timeZone:'UTC'}},report:{id:report.id,version:report.version},responseState:'answered',claimStatus:'occurred',decision:null},correction:null,replaces:null};
 await userTurn(page,entry,'outcome-request-incomplete',t(`Save an outcome for ${action}`,`Guarda un resultado para ${action}`));
 const refs=await tool(page,entry,'outcome-exact-report','list_student_outcome_reports',{target});assert.equal(refs.reports[0].id,report.id);assert.ok(!('helpfulness'in refs.reports[0]));
 const incomplete=await tool(page,entry,'outcome-no-audio','prepare_student_outcome_evidence',{target,payload});assert.equal(incomplete.status,'readback_required');
 // A transcript without complete audio must never authorize the private write.
 await page.evaluate(({entry,text})=>{window.syntheticAudioUntil=0;if(entry==='live')window.emit({type:'session.output_transcript.delta',delta:text});else window.emit({type:'response.output_audio_transcript.done',item_id:'inaudible-outcome',transcript:text});},{entry,text:incomplete.readback});
 await userTurn(page,entry,'outcome-no-audio-approval',t('Yes, save it.','Sí, guárdalo.'));
 assert.equal((await tool(page,entry,'reject-inaudible-outcome','confirm_student_follow_up',{})).status,'approval_required');assert.equal((await outcomes()).evidence.length,0);
 await userTurn(page,entry,'outcome-request-complete',t(`Save an outcome for ${action}`,`Guarda un resultado para ${action}`));
 const prepared=await tool(page,entry,'outcome-complete','prepare_student_outcome_evidence',{target,payload});assert.equal(prepared.status,'readback_required');await played(page,entry,prepared.readback,'/api/student-follow-up-voice');
 await userTurn(page,entry,'outcome-approve-complete',t('Yes, save it.','Sí, guárdalo.'));
 const count=await page.evaluate(()=>window.connections.length),saved=page.waitForResponse(r=>r.url().endsWith('/api/student-follow-up-voice')&&r.request().postDataJSON()?.action==='confirm');
 await tool(page,entry,'outcome-save-complete','confirm_student_follow_up',{},false);assert.equal((await (await saved).json()).status,'saved');
 await page.waitForFunction(n=>window.connections.length>n&&window.connections.at(-1).connectionState==='connected',count);if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
 const data=await outcomes();assert.equal(data.assessments[0].state,'student_reported');assert.ok(data.assessments[0].reasonCodes.includes('event_date_unknown'));assert.equal(data.evidence[0].event_on,null);
 const {outcomeShareWording}=await import('../src/outcomeRecording.mjs');
 const wording=outcomeShareWording({definitionId:'office_contacted',definitionVersion:1,scope:payload.link.episode.scope,responseState:'answered',claimStatus:'occurred',decision:null,statement:report.detail,eventOn:null,timeZone:'UTC'},language);
 return {wording,outcomes,episode:data.episodes[0],report};
}
async function observeOutcome({staffPage,detail,f,language,child,record}){
 const t=(en,es)=>language==='es'?es:en,button=(en,es)=>detail.getByRole('button',{name:t(en,es),exact:true}),label=(en,es)=>detail.getByLabel(t(en,es),{exact:true});
 const coordinator=(await f.owner.query("SELECT id FROM origen_coordinator_profiles WHERE institution_id=$1 AND auth0_subject='staff'",[f.org])).rows[0].id;
 await f.owner.query("SELECT origen_outcome_review_grant($1,$2,'office_contacted',ARRAY['declared_record_review'],clock_timestamp()+interval '30 days')",[f.org,coordinator]);
 await staffPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await button('Record an observation','Registrar una observación').click();
 await label('Specific claim','Afirmación específica').selectOption('occurred');await label('Institution','Institución').fill('Example University');await label('Term','Período académico').fill('2026–2027');await label('Process or application','Trámite o solicitud').fill(t('Insurance documents','Documentos del seguro'));
 await label('Exact wording reviewed','Texto exacto revisado').fill(record.report.detail);await label('What this observation establishes','Qué permite establecer esta observación').selectOption('supports');
 const observation=t('I checked the office message acknowledging contact. It does not show a waiver decision.','Revisé el mensaje de la oficina que reconoce el contacto. No muestra una decisión de exención.');
 await label('What I observed','Lo que observé').fill(observation);await label('Date I observed or checked it','Fecha en que observé o revisé').fill('2026-11-01');
 await label('Record type','Tipo de registro').selectOption('office_message');
 await button('Preview observation','Vista previa de observación').click();await detail.getByRole('region',{name:t('Exact evidence preview','Vista previa exacta de evidencia')}).waitFor();
 await button('Publish this exact observation','Publicar esta observación exacta').click();await button('Revise observation','Revisar observación').waitFor();
 const command=input=>f.call('staff','/api/coordinator-outcome-observations',{organizationId:f.org,id:child.id,...input}),before=await command({action:'load'});
 assert.equal(before.observations[0].assessment.state,'coordinator_reported');assert.ok(before.observations[0].assessment.reasonCodes.includes('advice_author_is_reviewer'));assert.equal(before.observations[0].assessment.institutionVerified,false);
 assert.doesNotMatch(JSON.stringify(before),new RegExp(record.report.id+'|'+record.episode.id+'|partly_helpful|PRIVATE_PLAN_NOT_SHARED'));
 return {observation,command,before};
}
async function verifyOutcome({page,f,entry,language,studentId,actionCard,record,observed,configs,source}){
 const t=(en,es)=>language==='es'?es:en,button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true});
 async function showActions(){
  const topics=page.locator('.notebook-page-navigation').getByRole('button',{name:t('Topics','Temas'),exact:true});
  if(await topics.isVisible())await topics.click();
  await page.locator('.personal-binder [data-topic=summary]').first().click();
  const expand=button('See all my steps','Ver todos mis pasos');await expand.or(actionCard).first().waitFor();if(await expand.isVisible())await expand.click();
 }
 await page.bringToFront();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='closed',null,{timeout:15000});await showActions();
 await actionCard.getByRole('button',{name:t('Discuss source response','Hablar de la respuesta de origen'),exact:true}).click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
 const instructions=configs.at(-1).delegation?.responses.instructions||configs.at(-1).instructions;assert.match(instructions,/separate_records_not_linked/);assert.match(instructions,/not proof of institutional truth/);
 await userTurn(page,entry,'read-outcome-assessment',t('What do we know about the insurance office contact?','¿Qué sabemos del contacto con la oficina del seguro?'));
 const recalled=await tool(page,entry,'recall-outcome-assessment','recall_student_context',{query:t('insurance documents','documentos seguro')});
 assert.equal(recalled.reviewResponse.status,'clarification_required');assert.equal(recalled.reviewResponse.outcomeAssessment,undefined,'An ambiguous search cannot merge responses.');
 const focused=await f.call('other','/api/review-response-context',{action:'lookup',studentId,focus:source}),assessment=focused.outcomeAssessment;
 assert.match(instructions,/coordinator_reported/);assert.match(instructions,/student_reported/);
 assert.deepEqual(focused.response.source,source);assert.equal(assessment.privateEpisodes[0].state,'student_reported');assert.equal(assessment.sharedObservations[0].state,'coordinator_reported');assert.equal(assessment.relationship,'separate_records_not_linked');
 await showActions();
 await actionCard.getByRole('button',{name:new RegExp(t('^My private updates','^Mis actualizaciones privadas'))}).click();await actionCard.getByRole('button',{name:new RegExp(t('^What happened','^Qué pasó'))}).click();
 await actionCard.getByText(t('This records the student’s account; it has not been independently confirmed.','Esto registra lo reportado por el estudiante; no se ha confirmado de forma independiente.'),{exact:true}).waitFor();
 await button('Optional quality evaluation','Evaluación de calidad opcional').click();await button('Do not include this outcome','No incluir este resultado').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.outcome-evaluation p')].some(p=>/I declined|rechacé/.test(p.textContent)));
 const permission=(await f.call('other','/api/outcome-evaluation',{action:'load',studentId,episodeId:record.episode.id,purpose:'service_quality',contractVersion:1})).permission;assert.equal(permission.status,'declined');
 assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_outcome_evaluation_permissions WHERE status='granted'")).rows[0].n,0);assert.equal((await page.evaluate(()=>window.connections.at(-1).connectionState)),'connected');
 // A private canonical correction remains available while outcome/evaluation
 // creation is paused. It does not rewrite an approved coordinator snapshot.
 f.env.ORIGEN_OUTCOME_EVIDENCE='false';f.env.ORIGEN_OUTCOME_EVALUATION='false';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await button('Correct update','Corregir actualización').click();const correction=t('Private correction: I left a message but did not reach the office.','Corrección privada: dejé un mensaje, pero no logré comunicarme con la oficina.');
 await page.getByLabel(t('In my own words','En mis propias palabras'),{exact:true}).fill(correction);await button('Review my update','Revisar mi actualización').click();await button('Save this private update','Guardar esta actualización privada').click();
 await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='closed',null,{timeout:15000});assert.equal((await record.outcomes()).evidence.length,0);assert.deepEqual(await observed.command({action:'load'}),{...observed.before,enabled:false,observations:observed.before.observations.map(({assessment,...r})=>r)});
 // Resume with fresh context before exercising the original source-withdrawal
 // boundary at the end of the shared Phase 3 journey.
 f.env.ORIGEN_OUTCOME_EVIDENCE='true';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await actionCard.getByRole('button',{name:t('Discuss source response','Hablar de la respuesta de origen'),exact:true}).click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
}
module.exports={recordOutcome,observeOutcome,verifyOutcome};
