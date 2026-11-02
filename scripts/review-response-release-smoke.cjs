// Actual binder, ProfileVoice, coordinator workspace, scoped handlers and local
// PostgreSQL. Provider speech, microphone and authenticated identity are synthetic.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{randomUUID}=require('node:crypto');
const {mkdir,writeFile}=require('node:fs/promises');
const {setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const {coordinatorPage,userTurn,tool}=require('./review-request-release-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const folder=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-response-release-browser';

const {installSyntheticPlayback,played}=require('./synthetic-voice-playback.cjs');
(async()=>{
 const [{coordinatorPilotFixture},{createProfileVoiceHandler},{createLiveMemoryHandler},{createPlanHandler,createPlanRepository,validatePlan},{personalizationPolicy},{reviewResponseVoiceInstructions}]=await Promise.all([
  import('../server/fixtures/coordinator-pilot.mjs'),import('../server/profile-voice.mjs'),import('../server/live-memory.mjs'),import('../server/plans.mjs'),import('../server/personalization-controls.mjs'),import('../server/review-response-voice.mjs')]);
 await mkdir(folder,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});const journeys=[];
 try{for(const width of [1280,390])for(const language of ['en','es'])for(const entry of ['live','realtime']){
  const f=await coordinatorPilotFixture({reviewRequests:true,reviewVoice:true,reviewDelivery:true,language});let page,staffPage;
  const label=`${width}-${language}-${entry}`,t=(en,es)=>language==='es'?es:en;
  try{
   Object.assign(f.env,{ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_PERSONALIZATION_MODE:'on',OPENAI_API_KEY:'synthetic',OPENAI_MODEL_VOICE:entry==='live'?'gpt-live-1':'gpt-realtime-2.1',ALLOWED_ORIGINS:origin});
   await f.family('other',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'College',interest:'Nursing',gpa:'',color:'peach'}});
   const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connectionId=randomUUID();
   await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,$3,id,'accepted',$4,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$5",[connectionId,account,studentId,randomUUID(),f.org]);
   const student=input=>f.call('other','/api/review-requests',{studentId,...input}),staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
   const plans=()=>f.as('other',()=>createPlanRepository(f.db,f.env)('other',validatePlan({action:'load',studentId})));
   const question=t('Which insurance waiver documents are accepted?','¿Qué documentos aceptan para la exención del seguro?');
   const guidance=t('Your work coverage may qualify if it meets campus requirements. Confirm with the insurance office.','La cobertura de tu trabajo podría ser válida si cumple los requisitos del campus. Confirma con la oficina del seguro.');
   const action=t('Ask which proof of coverage is accepted.','Preguntar qué comprobante de cobertura aceptan.');
   const draft=(await student({action:'create',requestKey:randomUUID(),connectionId,origin:'notebook',language,kind:'question',originalQuestion:question,entries:[]})).request;
   const preview=(await student({action:'preview',id:draft.id,version:1,wording:'original'})).preview;
   const parent=(await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;await f.sweep();
   await staff({action:'respond',id:parent.id,publicationId:parent.publication.id,version:0,operationId:randomUUID(),guidance,suggestedAction:action});await f.sweep();
   const source={kind:'review-response',requestId:parent.id,responseVersion:1},configs=[];
   const voice=createProfileVoiceHandler(f.env,async(url,options)=>{configs.push(entry==='live'?JSON.parse(options.body).session:JSON.parse(options.body.get('session')));return entry==='live'?Response.json({transport:{sdp:'v=0\r\n'},session:{id:'synthetic-live'}}):new Response('v=0\r\n');},()=>{},f.db);
   const ui=await setup(browser,{width,language,configurePage:async p=>{
    page=p;p.on('pageerror',e=>console.error('browser: '+e.message));
    await installSyntheticPlayback(p);
    for(const [path,handler] of [['profile-voice',voice],['live-memory',createLiveMemoryHandler(f.db,f.env)],['plans',createPlanHandler(f.db,f.env)]])await p.route('**/api/'+path,async route=>{
     const req=Object.assign(Readable.from([JSON.stringify(route.request().postDataJSON())]),{url:'/api/'+path,method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});let status,body;
     await f.as('other',()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail('unhandled fixture route')));await route.fulfill({status,json:body});
    });
    // Saving an action mounts follow-up controls even when enrollment is off.
    // Keep their disabled-state contracts tied to the real scoped handlers.
    for(const path of ['review-response-context','review-response-choices','review-request-voice','review-requests','coordinator-connections','coordinator-notifications','student-follow-up','student-follow-up-report','student-follow-up-voice','conversation-opening'])await p.route('**/api/'+path,async route=>{const r=await f.request('other','/api/'+path,route.request().postDataJSON());await route.fulfill({status:r.status,json:r.body});});
    await p.route('**/api/student-memory',async route=>{const b=route.request().postDataJSON(),r=await f.memory({...b,action:b.action==='sync'?'load':b.action},'other');await route.fulfill({json:{...r,pendingCount:0,memoryPolicy:personalizationPolicy(f.env,'other')}});});
    await p.route('**/api/topic-notes',async route=>route.fulfill({json:{...await f.note(route.request().postDataJSON(),'other'),pendingCount:0}}));
   }});page=ui.page;await openBinder(page);
   await page.getByRole('button',{name:new RegExp(t('^My requests','^Mis solicitudes'))}).click();const sheet=page.locator('.review-request-sheet');await sheet.getByText(guidance,{exact:true}).waitFor();
   await sheet.getByRole('button',{name:t('Talk about this','Hablemos de esto'),exact:true}).click();
   await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
   const instructions=configs.at(-1).delegation?.responses.instructions||configs.at(-1).instructions;
   assert.ok(instructions.includes(guidance));assert.ok(instructions.includes(reviewResponseVoiceInstructions));assert.ok(instructions.includes('"selection":"review-response"'));
   await userTurn(page,entry,'explain',t('Can you explain the insurance waiver response?','¿Puedes explicarme la respuesta sobre la exención del seguro?'));
   const recalled=await tool(page,entry,'recall','recall_student_context',{query:'insurance waiver'});assert.equal(recalled.reviewResponse.status,'retrieved');assert.deepEqual(recalled.reviewResponse.response.source,source);assert.equal(recalled.reviewResponse.response.guidance,guidance);assert.ok(recalled.reviewResponse.response.author.name);
   assert.equal((await plans()).plans.length,0);const visibleBefore=await staff({action:'read',id:parent.id});
   await userTurn(page,entry,'save',t('Save that as my next step.','Guarda eso como mi próximo paso.'));
   const change={kind:'next-step',category:'financial',content:action,responseSource:source};
   const proposed=await tool(page,entry,'propose','save_next_step',change);assert.equal(proposed.status,'clarification_required');assert.equal((await plans()).plans.length,0);
   await played(page,entry,proposed.readback,'/api/live-memory');await userTurn(page,entry,'yes-save',t('Yes, save it.','Sí, guárdalo.'));
   // Saving intentionally replaces the provider session with fresh memory. The
   // old channel must not receive a tool result after it has been closed.
   const count=await page.evaluate(()=>window.connections.length);
   const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/live-memory')&&r.request().postDataJSON()?.action==='write');
   await tool(page,entry,'save-confirmed','save_next_step',change,false);assert.equal((await (await savedResponse).json()).status,'saved');
   await page.waitForFunction(count=>window.connections.length>count&&window.connections.at(-1).connectionState==='connected',count);
   if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
   await userTurn(page,entry,'return-to-response',t('Can you explain the insurance waiver response again?','¿Puedes explicarme otra vez la respuesta sobre la exención del seguro?'));
   assert.equal((await tool(page,entry,'recall-after-save','recall_student_context',{query:'insurance waiver'})).reviewResponse.status,'retrieved');
   assert.equal((await plans()).plans.length,1);assert.equal((await plans()).plans[0].steps[0].action,action);
   assert.deepEqual(await staff({action:'read',id:parent.id}),visibleBefore,'Private discussion and acceptance must not update the coordinator record.');
   const followup=t('Which document should I ask my employer for?','¿Cuál documento debo pedirle a mi trabajo?');
   await userTurn(page,entry,'ask-followup',t('Ask my coordinator which document I should request from work.','Pregúntale a mi coordinador cuál documento debo pedir en mi trabajo.'));
   const prepared=await tool(page,entry,'prepare-followup','prepare_coordinator_review_request',{connectionId,question:followup,kind:'question',entries:[],relatedResponse:source});assert.equal(prepared.status,'readback_required');assert.ok(prepared.readback.includes(question));
   assert.equal((await staff({action:'list'})).requests.length,1);await played(page,entry,prepared.readback,'/api/review-request-voice');
   await userTurn(page,entry,'approve-followup',t('Yes, please.','Sí, por favor.'));assert.equal((await tool(page,entry,'confirm-followup','confirm_coordinator_review_request',{})).status,'queued');await f.sweep();
   const child=(await student({action:'list'})).requests.find(r=>r.id!==parent.id);assert.ok(child);assert.deepEqual(child.relatedResponse.source,source);
   const shared=await staff({action:'read',id:child.id});assert.equal(shared.question,followup);assert.equal(shared.entries.length,0);assert.deepEqual(shared.relatedResponse.source,source);assert.ok(!JSON.stringify(shared).includes(guidance));
   const coordinator=await coordinatorPage(browser,f,width,language);staffPage=coordinator.page;await staffPage.locator('.coordinator-updates-heading').click();
   await staffPage.locator('.coordinator-updates li').first().getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();
   const detail=staffPage.locator('.coordinator-review-detail');await detail.getByText(followup,{exact:true}).waitFor();await detail.locator('.review-request-related').waitFor();
   const updated=t('Ask your employer for the coverage document, then confirm the required format with the campus.','Pide a tu trabajo el documento de cobertura y confirma el formato requerido con el campus.');
   await detail.getByRole('textbox',{name:t('Guidance','Orientación'),exact:true}).fill(updated);await detail.getByRole('button',{name:t('Share response with student','Compartir respuesta con estudiante'),exact:true}).click();await staffPage.getByRole('status').filter({hasText:/Response saved|Respuesta guardada/}).waitFor();await f.sweep();
   assert.equal((await student({action:'get',id:child.id})).request.coordinatorReview.response.guidance,updated);
   await page.bringToFront();await page.getByRole('button',{name:new RegExp(t('^My requests','^Mis solicitudes'))}).click();
   await page.locator('.review-request-sheet').getByText(updated,{exact:true}).waitFor();
   await page.screenshot({path:`${folder}/${label}-updated-response.png`});
   await page.getByRole('button',{name:t('Close requests','Cerrar solicitudes'),exact:true}).click();
   // Editing the source invalidates the active voice guard, detaches the shared
   // clarification and preserves the student's independently accepted action.
   await page.bringToFront();await staff({action:'respond',id:parent.id,publicationId:parent.publication.id,version:1,operationId:randomUUID(),guidance:t('Confirm the revised requirements with the campus.','Confirma los requisitos actualizados con el campus.')});
   await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='closed',null,{timeout:15000});
   await assert.rejects(staff({action:'read',id:child.id}),{status:404});const retained=(await plans()).plans;assert.equal(retained.length,1);assert.equal(retained[0].steps[0].action,action);assert.equal(retained[0].steps[0].responseSource.source,null);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);assert.deepEqual(coordinator.errors,[]);await page.screenshot({path:`${folder}/${label}.png`});
   journeys.push({width,language,entry,passed:true});console.log(`PASS ${label}: attributed context, private consent, approved clarification, coordinator update, source invalidation.`);
  }catch(error){if(page)await page.screenshot({path:`${folder}/${label}-failure.png`}).catch(()=>{});throw error;}
  finally{for(const p of [page,staffPage]){await p?.unrouteAll({behavior:'wait'});await p?.close();}await f.close();}
 }}finally{await browser.close();await writeFile(`${folder}/results.json`,JSON.stringify({kind:'review-response-connected-browser-verification',schemaVersion:1,syntheticIdentity:true,syntheticSpeech:true,disposablePostgres:true,journeys,passed:journeys.length===8},null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
