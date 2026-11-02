// Complete browser journeys use actual app, voice adapters, coordinator workspace,
// scoped HTTP handlers and PostgreSQL. Identity, microphone and speech are synthetic.
const {createRequire}=require('node:module'),{Readable}=require('node:stream'),{randomUUID}=require('node:crypto');
const {mkdir,writeFile}=require('node:fs/promises'),assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const folder=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-review-release-browser';

async function coordinatorPage(browser,f,width,language){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"const auth={user:{sub:'staff'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>'staff',logout:async()=>{},loginWithRedirect:async()=>{}};export function useAuth0(){return auth}"});
  if(url.pathname.startsWith('/api/')){const r=await f.request('staff',url.pathname,route.request().postDataJSON());return route.fulfill({status:r.status,json:r.body});}
  if(url.origin===origin)return route.continue();return route.fulfill({status:200,body:''});
 });
 await page.route('**/review-release-coordinator',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import Workspace from '/src/CoordinatorWorkspace.tsx';import '/src/styles.css';import '/src/brand.css';
 import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';browserPrivacy.start('staff',{fresh:true});setAPITokenProvider(async()=>'staff');localStorage.setItem('origen.language','${language}');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Workspace));
 </script></html>`}));
 await page.goto(origin+'/review-release-coordinator',{waitUntil:'domcontentloaded'});return {page,errors};
}
async function userTurn(page,entry,id,text){
 await page.evaluate(({entry,id,text})=>{if(entry==='live')window.emit({type:'session.input_transcript.delta',delta:text});else{window.emit({type:'input_audio_buffer.speech_started',item_id:id});window.emit({type:'input_audio_buffer.speech_stopped',item_id:id});window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});}},{entry,id,text});
}
async function tool(page,entry,id,name,args,waitForOutput=true){
 await page.evaluate(({entry,id,name,args})=>{
  const output=[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}];
  if(entry==='live'){window.emit({type:'response.event',delegation_id:id,event:{type:'response.created',response:{id}}});window.emit({type:'response.event',delegation_id:id,event:{type:'response.completed',response:{id,status:'completed',output}}});}
  else{window.emit({type:'response.created',response:{id}});window.emit({type:'response.done',response:{id,status:'completed',output}});}
 },{entry,id,name,args});
 if(!waitForOutput)return;
 await page.waitForFunction(id=>window.sent.some(e=>e.item?.call_id===id),id);return page.evaluate(id=>JSON.parse(window.sent.find(e=>e.item?.call_id===id).item.output),id);
}
module.exports={coordinatorPage,userTurn,tool};
const {installSyntheticPlayback,played}=require('./synthetic-voice-playback.cjs');
if(require.main===module)(async()=>{
 const [{coordinatorPilotFixture},{createProfileVoiceHandler},{personalizationPolicy}]=await Promise.all([import('../server/fixtures/coordinator-pilot.mjs'),import('../server/profile-voice.mjs'),import('../server/personalization-controls.mjs')]);
 await mkdir(folder,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});const journeys=[];
 try{for(const width of [1280,390])for(const language of ['en','es'])for(const entry of ['notebook','realtime','live']){
  const f=await coordinatorPilotFixture({reviewRequests:true,reviewVoice:true,reviewDelivery:true,language});let page,staffPage;const label=`${width}-${language}-${entry}`,t=(en,es)=>language==='es'?es:en;
  try{
   await f.family('other',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'College',interest:'Nursing',gpa:'',color:'peach'}});
   const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connectionId=randomUUID(),noteId=randomUUID();
   await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,$3,id,'accepted',$4,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$5",[connectionId,account,studentId,randomUUID(),f.org]);
   const question=t('Could I qualify for an insurance waiver?','¿Podría solicitar una exención del seguro?'),note=t('I have health insurance through work.','Tengo seguro médico por mi trabajo.');
   await f.note({action:'create',studentId,id:noteId,note:{topic:'costs',kind:'note',content:note,language}},'other');
   const env={...f.env,OPENAI_API_KEY:'synthetic',OPENAI_MODEL_VOICE:entry==='live'?'gpt-live-1':'gpt-realtime-2.1',ORIGEN_PERSONALIZATION_MODE:'off',ALLOWED_ORIGINS:origin};
   const voice=createProfileVoiceHandler(env,async()=>entry==='live'?Response.json({transport:{sdp:'v=0\r\n'},session:{id:'synthetic-live'}}):new Response('v=0\r\n'),()=>{},f.db);
   const ui=await setup(browser,{width,language,configurePage:async p=>{
    await installSyntheticPlayback(p);
    await p.route('**/api/profile-voice',async route=>{
     const req=Object.assign(Readable.from([JSON.stringify(route.request().postDataJSON())]),{url:'/api/profile-voice',method:'POST',headers:{origin,'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});let status,body;
     await f.as('other',()=>voice(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail()));await route.fulfill({status,json:body});
    });
    for(const path of ['review-request-voice','review-requests','review-response-choices','review-response-context','coordinator-connections','coordinator-notifications'])await p.route('**/api/'+path,async route=>{const r=await f.request('other','/api/'+path,route.request().postDataJSON());await route.fulfill({status:r.status,json:r.body});});
    await p.route('**/api/student-memory',async route=>{const b=route.request().postDataJSON(),r=await f.memory({...b,action:b.action==='sync'?'load':b.action},'other');await route.fulfill({json:{...r,pendingCount:0,memoryPolicy:personalizationPolicy(env,'other')}});});
    await p.route('**/api/topic-notes',async route=>{const r=await f.note(route.request().postDataJSON(),'other');await route.fulfill({json:{...r,pendingCount:0}});});
   }});page=ui.page;await openBinder(page);
   if(entry==='notebook'){
    await page.locator('.personal-binder [data-topic=costs]').first().click();await page.locator(`[data-note-id="${noteId}"]`).getByRole('button',{name:t('Ask my coordinator','Consultar a mi coordinador'),exact:true}).click();
    await page.getByLabel(t('In my own words','Con mis propias palabras'),{exact:true}).fill(question);await page.getByRole('button',{name:t('Preview request','Ver solicitud'),exact:true}).click();
    const approve=page.getByRole('button',{name:t('Approve request','Aprobar solicitud'),exact:true});await approve.waitFor();assert.ok(await approve.isDisabled());
    await page.getByLabel(t('I approve this exact question and these notes for this coordinator.','Apruebo esta pregunta exacta y estas notas para este coordinador.'),{exact:true}).check();await approve.click();await page.locator('.review-request-history article').waitFor();
    await page.getByRole('button',{name:t('Close requests','Cerrar solicitudes'),exact:true}).click();
   }else{
    await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections[0]?.connectionState==='connected');
    if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
    await userTurn(page,entry,'ask',t('Ask my coordinator if I might qualify for an insurance waiver.','Pregúntale a mi coordinador si puedo solicitar una exención del seguro.'));
    const prepared=await tool(page,entry,'prepare','prepare_coordinator_review_request',{connectionId,question,kind:'question',entries:[{id:noteId,version:1}]});assert.equal(prepared.status,'readback_required');assert.match(prepared.readback,/will be delivered|se entregará/);
    await played(page,entry,prepared.readback,'/api/review-request-voice');
    await userTurn(page,entry,'approve',t('Yes, please.','Sí, por favor.'));assert.equal((await tool(page,entry,'confirm','confirm_coordinator_review_request',{})).status,'queued');
   }
   const list=await f.call('other','/api/review-requests',{action:'list',studentId});assert.equal(list.requests.length,1);const request=list.requests[0];assert.equal(request.status,'submitted');assert.equal(request.publication.approvalMethod,entry==='notebook'?'notebook':'voice');assert.equal(request.publication.notification,'pending');
   assert.equal((await f.call('staff','/api/coordinator-review-requests',{action:'list',organizationId:f.org})).requests.length,0);
   await f.sweep();const staff=await coordinatorPage(browser,f,width,language);staffPage=staff.page;
   await staffPage.locator('.coordinator-updates-heading').click();await staffPage.getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();const detail=staffPage.locator('.coordinator-review-detail');await detail.waitFor();
   const visible=await detail.innerText();assert.ok(visible.includes(question)&&visible.includes(note));assert.doesNotMatch(visible,/UNPUBLISHED_SENTINEL|FAMILY_|GLOBAL_SUMMARY/);
   await detail.getByRole('button',{name:t('Mark reviewed','Marcar como revisada'),exact:true}).click();await staffPage.getByRole('status').filter({hasText:/Marked reviewed|Marcada como revisada/}).waitFor();
   const guidance=t('Compare your coverage with the campus waiver requirements.','Compara tu cobertura con los requisitos del campus para la exención.'),action=t('Ask the insurance office about the deadline.','Pregunta en la oficina del seguro por la fecha límite.');
   await detail.getByRole('textbox',{name:t('Guidance','Orientación'),exact:true}).fill(guidance);await detail.getByLabel(t('Suggested next action (optional)','Próxima acción sugerida (opcional)'),{exact:true}).fill(action);
   await detail.getByRole('button',{name:t('Share response with student','Compartir respuesta con estudiante'),exact:true}).click();await staffPage.getByRole('status').filter({hasText:/Response saved|Respuesta guardada/}).waitFor();
   await f.sweep();await page.bringToFront();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.personal-binder').waitFor();if(await page.locator('.binder-cover').isVisible())await openBinder(page);else await page.locator('.binder-open').waitFor();
   // On mobile, updates live on the binder's topic index, not inside a topic page.
   if(width<700&&await page.locator('.coordinator-updates-heading').count()===0)await page.getByRole('button',{name:t('Topics','Temas'),exact:true}).first().click();
   await page.locator('.coordinator-updates-heading').click();await page.locator('.coordinator-updates li').filter({hasText:/responded to your review request|respondió a tu solicitud/}).getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();
   const sheet=page.locator('.review-request-sheet');await sheet.waitFor();await sheet.getByText(guidance,{exact:true}).waitFor();assert.ok((await sheet.innerText()).includes(action));assert.match(await sheet.innerText(),/stays private|es privado/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`${folder}/${label}-receipt.png`});
   await sheet.getByRole('button',{name:t('Withdraw request','Retirar solicitud'),exact:true}).click();await sheet.getByText(t('I withdrew this request.','Retiré esta solicitud.'),{exact:true}).first().waitFor();
   await assert.rejects(f.call('staff','/api/coordinator-review-requests',{action:'read',organizationId:f.org,id:request.id}),{status:404});
   await sheet.getByRole('button',{name:t('Delete request','Eliminar solicitud'),exact:true}).click();await sheet.getByRole('button',{name:t('Confirm deletion','Confirmar eliminación'),exact:true}).click();await sheet.getByText(t('No requests yet. Start with one question.','Todavía no hay solicitudes. Comienza con una pregunta.'),{exact:true}).waitFor();
   assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_review_request_responses WHERE request_id=$1',[request.id])).rows[0].n,0);assert.deepEqual(ui.state.errors,[]);assert.deepEqual(staff.errors,[]);
   journeys.push({width,language,entry,passed:true});console.log(`PASS ${label}: approval, delivery, coordinator review/response, binder receipt, withdrawal and deletion.`);
  }catch(error){if(page){await page.screenshot({path:`${folder}/${label}-failure.png`}).catch(()=>{});await writeFile(`${folder}/${label}-failure.txt`,await page.locator('body').innerText().catch(()=>''));}throw error;}
  finally{for(const p of [page,staffPage]){await p?.unrouteAll({behavior:'wait'});await p?.close();}await f.close();}
 }}finally{await browser.close();await writeFile(`${folder}/journeys.json`,JSON.stringify({schemaVersion:1,kind:'review-request-browser-verification',syntheticIdentity:true,syntheticSpeech:true,journeys,passed:journeys.length===12},null,2)+'\n');}
 console.log('12 complete review-request browser journeys passed. Live and Realtime speech/identity were synthetic.');
})().catch(error=>{console.error(error);process.exitCode=1;});
