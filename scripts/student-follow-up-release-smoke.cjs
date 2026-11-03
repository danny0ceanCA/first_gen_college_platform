// Phase 3 connected journey: actual binder, ProfileVoice, coordinator workspace, handlers and local
// PostgreSQL. Provider speech, microphone and authenticated identity are synthetic.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {Readable}=require('node:stream'),{randomUUID}=require('node:crypto');
const {mkdir,writeFile}=require('node:fs/promises');
const {setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const {coordinatorPage,userTurn,tool}=require('./review-request-release-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const folder=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-followup-release-browser';

const {installSyntheticPlayback,played}=require('./synthetic-voice-playback.cjs');
const recommendationMode=process.argv.includes('--recommendation-evidence');
const outcomeMode=recommendationMode||process.argv.includes('--outcome-evidence');
const recommendation=require('./recommendation-connected.cjs');
const {recordOutcome,observeOutcome,verifyOutcome}=require('./outcome-evidence-connected.cjs');
(async()=>{
 const [{coordinatorPilotFixture},{createProfileVoiceHandler},{createLiveMemoryHandler},{createPlanHandler,createPlanRepository,validatePlan},{personalizationPolicy}]=await Promise.all([
  import('../server/fixtures/coordinator-pilot.mjs'),import('../server/profile-voice.mjs'),import('../server/live-memory.mjs'),import('../server/plans.mjs'),import('../server/personalization-controls.mjs')]);
 const {outcomeReleaseStages}=await import('../ops/outcome-release-verification.mjs');
 const {recommendationReleaseStages}=await import('../ops/recommendation-release-verification.mjs');
 const {createRecommendationDeliveryHandler}=await import('../server/recommendation-delivery.mjs');
 await mkdir(folder,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});const journeys=[];
 try{for(const width of [390,320,1280])for(const language of ['en','es'])for(const entry of ['live','realtime']){
  const f=await coordinatorPilotFixture({reviewRequests:true,reviewVoice:true,reviewDelivery:true,language});let page,staffPage;const protocol=[];
  const label=`${width}-${language}-${entry}`,t=(en,es)=>language==='es'?es:en;
  try{
   Object.assign(f.env,{ORIGEN_STUDENT_FOLLOW_UP:'true',ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_PERSONALIZATION_MODE:'on',OPENAI_API_KEY:'synthetic',OPENAI_MODEL_VOICE:entry==='live'?'gpt-live-1':'gpt-realtime-2.1',ALLOWED_ORIGINS:origin});
   await f.family('other',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'College',interest:'Nursing',gpa:'',color:'peach'}});
   const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connectionId=randomUUID();
   await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,$3,id,'accepted',$4,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$5",[connectionId,account,studentId,randomUUID(),f.org]);
   const student=input=>f.call('other','/api/review-requests',{studentId,...input}),staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
   const plans=()=>f.as('other',()=>createPlanRepository(f.db,f.env)('other',validatePlan({action:'load',studentId})));
   const question=t('Which insurance waiver documents are accepted?','¿Qué documentos aceptan para la exención del seguro?');
   const guidance=t('Your work coverage may qualify if it meets campus requirements. Confirm with the insurance office.','La cobertura de tu trabajo podría ser válida si cumple los requisitos del campus. Confirma con la oficina del seguro.');
   let action=t('Ask which proof of coverage is accepted.','Preguntar qué comprobante de cobertura aceptan.');
   const draft=(await student({action:'create',requestKey:randomUUID(),connectionId,origin:'notebook',language,kind:'question',originalQuestion:question,entries:[]})).request;
   const preview=(await student({action:'preview',id:draft.id,version:1,wording:'original'})).preview;
   const parent=(await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;await f.sweep();
   await staff({action:'respond',id:parent.id,publicationId:parent.publication.id,version:0,operationId:randomUUID(),guidance,suggestedAction:action});await f.sweep();
   if(outcomeMode)Object.assign(f.env,{ORIGEN_OUTCOME_EVIDENCE:'true',ORIGEN_OUTCOME_EVALUATION:'true'});
   const source={kind:'review-response',requestId:parent.id,responseVersion:1},configs=[];
   if(recommendationMode)await recommendation.prepareLibrary(f,studentId,language);
   const plan=recommendationMode?null:(await f.as('other',()=>createPlanRepository(f.db,f.env)('other',validatePlan({action:'create',requestId:randomUUID(),fromResponse:{source,stepId:'accepted',confirmed:true},plan:{studentId,title:t('My insurance next step','Mi próximo paso sobre el seguro'),goal:'',category:'financial',status:'active',summaryIds:[],steps:[{id:'accepted',title:action,action,notes:'PRIVATE_PLAN_NOT_SHARED',status:'not-started',dueDate:null,sources:[]}]}})))).plans[0],initialTarget=plan?{planId:plan.id,stepId:'accepted'}:null;let target=initialTarget;
   const follow=()=>f.call('other','/api/student-follow-up',{action:'load',studentId,target});
   const voice=createProfileVoiceHandler(f.env,async(url,options)=>{configs.push(entry==='live'?JSON.parse(options.body).session:JSON.parse(options.body.get('session')));return entry==='live'?Response.json({transport:{sdp:'v=0\r\n'},session:{id:'synthetic-live'}}):new Response('v=0\r\n');},()=>{},f.db);
   const ui=await setup(browser,{width,language,configurePage:async p=>{
    page=p;p.on('pageerror',e=>console.error('browser: '+e.message));
    await installSyntheticPlayback(p);
    for(const [path,handler] of [['profile-voice',voice],['live-memory',createLiveMemoryHandler(f.db,f.env)],['plans',createPlanHandler(f.db,f.env)],['recommendations',createRecommendationDeliveryHandler(f.db,f.env)],['recommendation-voice',createRecommendationDeliveryHandler(f.db,f.env)]])await p.route('**/api/'+path,async route=>{
     const req=Object.assign(Readable.from([JSON.stringify(route.request().postDataJSON())]),{url:'/api/'+path,method:'POST',headers:{...route.request().headers(),host:new URL(origin).host,origin,'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});let status,body;
     await f.as('other',()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail('unhandled fixture route')));if(path==='profile-voice'&&body?.sdp)protocol.push(body);await route.fulfill({status,json:body});
    });
    for(const path of ['review-response-context','review-response-choices','review-request-voice','review-requests','coordinator-connections','coordinator-notifications','student-follow-up','student-follow-up-report','student-follow-up-voice','conversation-opening','outcome-evidence','student-outcome-observations','outcome-evaluation','recommendation-evaluation'])await p.route('**/api/'+path,async route=>{const r=await f.request('other','/api/'+path,route.request().postDataJSON());await route.fulfill({status:r.status,json:r.body});});
    await p.route('**/api/student-memory',async route=>{const b=route.request().postDataJSON(),r=await f.memory({...b,action:b.action==='sync'?'load':b.action},'other');await route.fulfill({json:{...r,pendingCount:0,memoryPolicy:personalizationPolicy(f.env,'other')}});});
    await p.route('**/api/topic-notes',async route=>route.fulfill({json:{...await f.note(route.request().postDataJSON(),'other'),pendingCount:0}}));
   }});page=ui.page;await openBinder(page);
   if(recommendationMode)({target,action}=await recommendation.acceptRecommendation({page,f,studentId,language,guidance,action,plans}));
   await page.locator('.personal-binder [data-topic=summary]').first().click();
   await page.getByRole('button',{name:t('See all my steps','Ver todos mis pasos'),exact:true}).click();
   const actionCard=page.locator('.saved-actions > li').first();await actionCard.getByText(action,{exact:true}).first().waitFor();
   assert.equal((await follow()).state,'off');
   await actionCard.getByRole('button',{name:t('Check in next time','Retomar la próxima vez'),exact:true}).click();
   await actionCard.getByRole('button',{name:t('Confirm my check-in','Confirmar mi seguimiento'),exact:true}).click();
   await page.getByText(t('I asked Origen for one check-in the next time we talk.','Le pedí a Origen un seguimiento la próxima vez que hablemos.'),{exact:false}).waitFor();assert.equal((await follow()).state,'scheduled');
   const coordinatorBefore=await staff({action:'read',id:parent.id});
   await actionCard.getByRole('button',{name:t('Talk about this','Hablemos de esto'),exact:true}).click();
   await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
   const claim=protocol.at(-1).openingClaim;assert.ok(claim,'Fresh, focused conversation should select the approved check-in.');
   const instructions=configs.at(-1).delegation?.responses.instructions||configs.at(-1).instructions;assert.match(instructions,/STUDENT-CONTROLLED CHECK-IN/);
   await played(page,entry,claim.presentation,'/api/conversation-opening');
   assert.equal((await follow()).state,'closed');assert.equal((await follow()).reports.length,0);assert.equal((await plans()).plans[0].steps[0].status,'not-started');
   // An ordinary answer remains conversation; no report or sharing is inferred.
   await userTurn(page,entry,'answer',t('I called the office, and I am still waiting.','Llamé a la oficina y sigo esperando.'));
   const noSave=await tool(page,entry,'no-auto-save','prepare_private_follow_up_update',{target,payload:{report:{responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:'SHOULD_NOT_SAVE',helpfulness:null,occurredOn:null,timeZone:'UTC'},planStatus:null}});assert.equal(noSave.status,'not_requested');assert.equal((await follow()).reports.length,0);
   const privateDetail=t('I called the office and they need my employer letter.','Llamé a la oficina y necesitan una carta de mi trabajo.');
   await userTurn(page,entry,'request-private',t(`Save a private update about ${action}: ${privateDetail}`,`Guarda una actualización privada sobre ${action}: ${privateDetail}`));
   const prepared=await tool(page,entry,'prepare-private','prepare_private_follow_up_update',{target,payload:{report:{responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:privateDetail,helpfulness:'partly_helpful',occurredOn:null,timeZone:'UTC'},planStatus:null}});assert.equal(prepared.status,'readback_required');
   await played(page,entry,prepared.readback,'/api/student-follow-up-voice');await userTurn(page,entry,'approve-private',t('Yes, save it.','Sí, guárdalo.'));
   const count=await page.evaluate(()=>window.connections.length),savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/student-follow-up-voice')&&r.request().postDataJSON()?.action==='confirm');
   await tool(page,entry,'save-private','confirm_student_follow_up',{},false);assert.equal((await (await savedResponse).json()).status,'saved');
   await page.waitForFunction(count=>window.connections.length>count&&window.connections.at(-1).connectionState==='connected',count);if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
   assert.equal(protocol.at(-1).openingClaim,undefined,'Reconnect cannot repeat the consumed check-in.');
   const privateState=await follow();assert.equal(privateState.reports.length,1);const report=privateState.reports[0];assert.equal(report.detail,privateDetail);assert.equal(report.reported_action,'completed');assert.equal(report.reported_outcome,'pending');assert.equal(report.helpfulness,'partly_helpful');assert.equal((await plans()).plans[0].steps[0].status,'not-started');assert.deepEqual(await staff({action:'read',id:parent.id}),coordinatorBefore);
   const outcomeRecord=outcomeMode?await recordOutcome({page,f,entry,language,studentId,target,action,report}):null;
   if(recommendationMode)await recommendation.verifyLinkedOutcome(f,outcomeRecord);
   await userTurn(page,entry,'return-to-source',t('Can you explain the insurance waiver response?','¿Puedes explicarme la respuesta sobre la exención del seguro?'));
   const recalled=await tool(page,entry,'recall-source','recall_student_context',{query:'insurance waiver'});assert.equal(recalled.reviewResponse.status,'retrieved');assert.deepEqual(recalled.reviewResponse.response.source,source);
   const followup=outcomeRecord?.wording||t('I contacted the office. They requested a letter from my employer.','Me comuniqué con la oficina. Pidieron una carta de mi trabajo.');
   await userTurn(page,entry,'ask-share',t(`Share this update with my coordinator: ${followup}`,`Comparte esta actualización con mi coordinador: ${followup}`));
   const sharedPreview=await tool(page,entry,'prepare-share','prepare_coordinator_review_request',{connectionId,question:followup,kind:'student-update',entries:[],relatedResponse:source});assert.equal(sharedPreview.status,'readback_required');assert.ok(sharedPreview.readback.includes(question));assert.ok(!sharedPreview.readback.includes('partly_helpful'));
   assert.equal((await staff({action:'list'})).requests.length,1);await played(page,entry,sharedPreview.readback,'/api/review-request-voice');
   await userTurn(page,entry,'approve-share',t('Yes, send it.','Sí, envíalo.'));assert.equal((await tool(page,entry,'confirm-share','confirm_coordinator_review_request',{})).status,'queued');await f.sweep();
   const child=(await student({action:'list'})).requests.find(r=>r.kind==='student-update');assert.ok(child);assert.deepEqual(child.relatedResponse.source,source);
   const shared=await staff({action:'read',id:child.id});assert.equal(shared.question,followup);assert.equal(shared.provenance,'student_reported');assert.equal(shared.entries.length,0);assert.deepEqual(shared.relatedResponse.source,source);assert.doesNotMatch(JSON.stringify(shared),/partly_helpful|PRIVATE_PLAN_NOT_SHARED|reported_outcome/);
   const coordinator=await coordinatorPage(browser,f,width,language);staffPage=coordinator.page;await staffPage.locator('.coordinator-updates-heading').click();
   await staffPage.locator('.coordinator-updates li').first().getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();
   const detail=staffPage.locator('.coordinator-review-detail');await detail.getByText(followup,{exact:true}).waitFor();await detail.locator('.review-request-related').waitFor();
   const updated=t('Ask your employer for the coverage document, then confirm the required format with the campus.','Pide a tu trabajo el documento de cobertura y confirma el formato requerido con el campus.');
   await detail.getByRole('textbox',{name:t('Guidance','Orientación'),exact:true}).fill(updated);await detail.getByRole('button',{name:t('Share response with student','Compartir respuesta con estudiante'),exact:true}).click();await staffPage.getByRole('status').filter({hasText:/Response saved|Respuesta guardada/}).waitFor();await f.sweep();
   assert.equal((await student({action:'get',id:child.id})).request.coordinatorReview.response.guidance,updated);
   const observed=outcomeMode?await observeOutcome({staffPage,detail,f,language,child,record:outcomeRecord}):null;
   await page.bringToFront();await page.getByRole('button',{name:new RegExp(t('^My requests','^Mis solicitudes'))}).click();
   await page.locator('.review-request-sheet').getByText(updated,{exact:true}).waitFor();
   await page.screenshot({path:`${folder}/${label}-updated-response.png`});
   if(outcomeMode)await page.locator('.review-request-sheet').getByText(observed.observation,{exact:true}).waitFor();
   await page.getByRole('button',{name:t('Close requests','Cerrar solicitudes'),exact:true}).click();
   if(outcomeMode)await verifyOutcome({page,f,entry,language,studentId,actionCard,record:outcomeRecord,observed,configs,source});
   if(recommendationMode)await recommendation.verifyCorrectionAndWithdrawal({page,f,language,plans});
   // Editing the source invalidates the active voice guard, detaches the shared
   // update and preserves the student's independently accepted action.
   await page.bringToFront();await staff({action:'respond',id:parent.id,publicationId:parent.publication.id,version:1,operationId:randomUUID(),guidance:t('Confirm the revised requirements with the campus.','Confirma los requisitos actualizados con el campus.')});
   await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='closed',null,{timeout:15000});
   await assert.rejects(staff({action:'read',id:child.id}),{status:404});const retained=(await plans()).plans;assert.equal(retained.length,1);assert.equal(retained[0].steps[0].action,action);assert.equal(retained[0].steps[0].responseSource.source,null);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);assert.deepEqual(coordinator.errors,[]);await page.screenshot({path:`${folder}/${label}.png`});
   journeys.push({width,language,entry,passed:true,stages:recommendationMode?[...recommendationReleaseStages]:outcomeMode?[...outcomeReleaseStages]:['accepted-action','check-in-choice','heard-opening','optional-answer','private-save','approved-share','coordinator-response','source-invalidation']});console.log(`PASS ${label}: check-in, optional answer, private report, approved snapshot, coordinator reply and source invalidation.`);
  }catch(error){if(page){await writeFile(`${folder}/${label}-failure.txt`,await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:`${folder}/${label}-failure.png`}).catch(()=>{});}throw error;}
  finally{for(const p of [page,staffPage]){await p?.unrouteAll({behavior:'wait'});await p?.close();}await f.close();}
 }}finally{await browser.close();await writeFile(`${folder}/results.json`,JSON.stringify({kind:recommendationMode?'recommendation-connected-browser-verification':outcomeMode?'outcome-evidence-connected-browser-verification':'student-follow-up-connected-browser-verification',schemaVersion:1,browserVersion:browser.version(),syntheticIdentity:true,syntheticSpeech:true,disposablePostgres:true,journeys,passed:journeys.length===12},null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
