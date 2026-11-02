// Actual ProfileVoice + binder UI and scoped PostgreSQL APIs. Auth, microphone,
// provider negotiation and speech events are synthetic; no paid model calls.
const {createRequire}=require('node:module'),{Readable}=require('node:stream'),{randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const {setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
async function userTurn(page,id,text){await page.evaluate(({id,text})=>{window.emit({type:'input_audio_buffer.speech_started',item_id:id});window.emit({type:'input_audio_buffer.speech_stopped',item_id:id});window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});},{id,text});}
async function tool(page,id,name,args){await page.evaluate(({id,name,args})=>{window.emit({type:'response.created',response:{id}});window.emit({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}]}});},{id,name,args});await page.waitForFunction(id=>window.sent.some(e=>e.item?.call_id===id),id);return page.evaluate(id=>JSON.parse(window.sent.find(e=>e.item?.call_id===id).item.output),id);}
async function readback(page,text,complete){await page.evaluate(({text,complete})=>{const id='readback-'+complete;window.emit({type:'response.created',response:{id}});window.emit({type:'output_audio_buffer.started',response_id:id});window.emit({type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});window.emit({type:'response.done',response:{id,status:'completed',output:[]}});if(complete)window.emit({type:'output_audio_buffer.stopped',response_id:id});},{text,complete});}
(async()=>{
 const [{coordinatorPilotFixture},{createProfileVoiceHandler},{personalizationPolicy}]=await Promise.all([import('../server/fixtures/coordinator-pilot.mjs'),import('../server/profile-voice.mjs'),import('../server/personalization-controls.mjs')]);
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE,args:['--no-sandbox']});let journeys=0;
 try{for(const [width,language] of [[1280,'en'],[390,'es']]){
  const f=await coordinatorPilotFixture({reviewRequests:true,reviewVoice:true});let page;
  try{
   await f.family('other',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'College',interest:'Nursing',gpa:'',color:'peach'}});
   const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connectionId=randomUUID(),noteId=randomUUID();
   await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,$3,id,'accepted',$4,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$5",[connectionId,account,studentId,randomUUID(),f.org]);
   const question=language==='es'?'¿Podría solicitar una exención del seguro?':'Could I qualify for an insurance waiver?';
   await f.note({action:'create',studentId,id:noteId,note:{topic:'costs',kind:'note',content:question,language}},'other');
   const env={...f.env,OPENAI_API_KEY:'synthetic',OPENAI_MODEL_VOICE:'gpt-realtime-2.1',ORIGEN_PERSONALIZATION_MODE:'off',ALLOWED_ORIGINS:origin};
   const voice=createProfileVoiceHandler(env,async()=>new Response('v=0\r\n'),()=>{},f.db);
   const ui=await setup(browser,{width,language,configurePage:async page=>{
    await page.route('**/api/profile-voice',async route=>{
     const req=Object.assign(Readable.from([JSON.stringify(route.request().postDataJSON())]),{url:'/api/profile-voice',method:'POST',headers:{origin,'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});
     let status,body;await f.as('other',()=>voice(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail()));await route.fulfill({status,json:body});
    });
    for(const path of ['review-request-voice','review-requests','coordinator-connections'])await page.route('**/api/'+path,async route=>{const r=await f.request('other','/api/'+path,route.request().postDataJSON());await route.fulfill({status:r.status,json:r.body});});
    await page.route('**/api/student-memory',async route=>{const body=route.request().postDataJSON(),r=await f.memory({...body,action:body.action==='sync'?'load':body.action},'other');await route.fulfill({json:{...r,pendingCount:0,memoryPolicy:personalizationPolicy(env,'other')}});});
    await page.route('**/api/topic-notes',async route=>{const r=await f.note({...route.request().postDataJSON(),action:'load'},'other');await route.fulfill({json:{...r,pendingCount:0}});});
   }});page=ui.page;
   await openBinder(page);await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections[0]?.connectionState==='connected');
   for(const complete of [false,true]){
    const key=String(complete);await userTurn(page,'request-'+key,language==='es'?'Pregúntale a mi coordinador si puedo solicitar una exención del seguro.':'Ask my coordinator if I might qualify for an insurance waiver.');
    const choices=await tool(page,'choices-'+key,'list_coordinator_review_choices',{});assert.equal(choices.connections[0].id,connectionId);
    const p=await tool(page,'prepare-'+key,'prepare_coordinator_review_request',{connectionId,question,kind:'question',entries:[{id:noteId,version:1}]});assert.equal(p.status,'readback_required');
    await readback(page,p.readback,complete);await userTurn(page,'yes-'+key,language==='es'?'Sí, por favor.':'Yes, please.');
    const result=await tool(page,'confirm-'+key,'confirm_coordinator_review_request',{});assert.equal(result.status,complete?'queued':'approval_required');
   }
   const records=(await f.call('other','/api/review-requests',{action:'list',studentId})).requests;assert.equal(records.length,2);assert.equal(records.filter(r=>r.status==='submitted').length,1);assert.equal(records.find(r=>r.status==='submitted').publication.approvalMethod,'voice');
   await page.getByRole('button',{name:/My requests|Mis solicitudes/}).first().click();const sheet=page.locator('.review-request-sheet');await sheet.waitFor();assert.match(await sheet.innerText(),/queued|espera/);assert.ok((await sheet.innerText()).includes(question));assert.deepEqual(ui.state.errors,[]);
   journeys++;console.log(`Voice-to-binder journey passed: ${width}px ${language}`);
  }finally{await page?.unrouteAll({behavior:'wait'});await page?.close();await f.close();}
 }}finally{await browser.close();}
 console.log(`${journeys} voice-to-binder browser journeys passed; speech/provider behavior was synthetic.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
