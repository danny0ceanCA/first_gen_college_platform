// Real browser + local PostgreSQL/API/worker, synthetic auth/microphone/providers.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
const textResponse=text=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text}]}]}));
async function until(check){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Local background processing did not finish');}
async function topic(page,width){if(width<700){const back=page.locator('.notebook-page-navigation button');if(await back.isVisible())await back.click();await page.locator('[data-topic="transfer"]').click();}else await page.locator('#notebook-tab-transfer').click();}
(async()=>{
 const [{binderFixture},{createApp},{createProfileVoiceHandler},{createSummaryHandler},{startBinderWorker}]=await Promise.all([import('../server/binder-jobs-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/conversation-summary.mjs'),import('../server/binder-jobs.mjs')]);
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await binderFixture();let server,page,stop,closing=false,releaseSummary,summaryHeld=false;const voiceRequests=[];
  const tr=(en,es)=>language==='es'?es:en;
  const narrative=tr('The student asked about evening nursing laboratories. Availability still needs checking.','La estudiante preguntó por laboratorios vespertinos de enfermería. Aún falta confirmar su disponibilidad.');
  const note=tr('Are evening nursing laboratories offered?','¿Se ofrecen laboratorios vespertinos de enfermería?');
  try{
   await f.family('reader',{action:'save-account',account:{firstName:'Alex',email:'',role:'student'}});
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',interest:'Nursing',gpa:'',color:'peach'}});
   for(const id of ['alex','sam'])await f.family('reader',{action:'delete-student',id});
   const env={ORIGEN_VOICE_PREPARATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const handlers={
    '/api/profile-voice':createProfileVoiceHandler(env,async()=>new Response('v=0\r\n'),()=>{},f.db),
    '/api/conversation-summary':createSummaryHandler(env,async()=>textResponse(narrative),f.db),
   };
   const app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{const handler=handlers[req.url];if(handler){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>handler(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const open=()=>setup(browser,{width,language,configurePage:async p=>{
    await p.addInitScript(()=>{const get=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async(...args)=>{await new Promise(r=>setTimeout(r,700));return get(...args);};});
    for(const path of ['family','profile-voice','conversation-history','student-memory','plans','topic-notes'])await p.route(`**/api/${path}`,async route=>{try{if(path==='profile-voice')voiceRequests.push(route.request().postDataJSON());await route.fulfill({response:await route.fetch({url:api+'/api/'+path})});}catch(error){if(!closing)throw error;}});
    await p.route('**/api/conversation-summary',async route=>{try{summaryHeld=true;await new Promise(r=>{releaseSummary=r;});await route.fulfill({response:await route.fetch({url:api+'/api/conversation-summary'})});}catch(error){if(!closing)throw error;}});
   }});
   let ui=await open();page=ui.page;await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');
   assert.ok(voiceRequests.some(r=>r.action==='prepare'));assert.ok(voiceRequests.some(r=>r.sdp&&r.preparedContextId));
   await page.evaluate(async text=>{await window.emit({type:'response.done',response:{id:'opening',status:'completed',output:[]}});await window.emit({type:'input_audio_buffer.speech_started',item_id:'question'});await window.emit({type:'input_audio_buffer.speech_stopped',item_id:'question'});await window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'question',transcript:text});await window.emit({type:'response.output_audio_transcript.done',transcript:'That still needs checking.'});await window.emit({type:'response.done',response:{id:'answer',status:'completed',output:[]}});},note);
   await page.locator('.voice-end').click();await until(()=>summaryHeld);assert.ok(releaseSummary);
   // The held summary must not block another microphone/voice connection.
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.length===2&&window.connections.at(-1).connectionState==='connected');
   releaseSummary();await until(async()=>Number((await f.owner.query('SELECT count(*) AS n FROM origen_binder_jobs')).rows[0].n)===1);
   await page.waitForFunction(()=>!document.querySelector('.shared-summary-status'));assert.deepEqual(ui.state.errors,[]);closing=true;await page.close();page=undefined;
   let attempts=0;const request=async()=>{attempts++;if(attempts===1)return new Response('',{status:503});return textResponse(JSON.stringify({notes:[{topic:'transfer',kind:'question',content:note,quote:narrative.split('. ')[0]+'.'}]}));};
   stop=startBinderWorker({application:f.db,maintenance:f.maintenance,schema:f.schema,env,request,intervalMs:20});
   await until(async()=>{const row=(await f.owner.query('SELECT status,attempts FROM origen_binder_jobs')).rows[0];return row.status==='pending'&&row.attempts===1&&attempts===1;});await stop();stop=undefined;
   await f.owner.query("UPDATE origen_binder_jobs SET available_at=now()-interval '1 second'");
   stop=startBinderWorker({application:f.db,maintenance:f.maintenance,schema:f.schema,env,request,intervalMs:20});
   await until(async()=>(await f.owner.query('SELECT status FROM origen_binder_jobs')).rows[0].status==='complete');await stop();stop=undefined;
   assert.equal(attempts,2);assert.equal((await f.notes('reader',studentId)).notes.length,1);
   closing=false;ui=await open();page=ui.page;await openBinder(page);await topic(page,width);await page.getByText(note,{exact:true}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);count++;
   console.log(`PASS ${width}/${language}: prepared context, reconnect during pending save, durable background retry with browser closed, and one saved binder point after reopening.`);
  }finally{closing=true;releaseSummary?.();await page?.close();await stop?.();await new Promise(r=>server?server.close(r):r());await f.close();}
 }}finally{await browser.close();}console.log(`${count} infrastructure browser journeys passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
