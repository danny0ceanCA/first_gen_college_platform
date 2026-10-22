// Chromium UI + actual scoped repositories/API gateway on isolated PostgreSQL.
// Only auth, microphone, provider negotiation and extraction are synthetic.
const {createRequire}=require('node:module'),{createServer}=require('node:http');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const {setup,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
async function userTurn(page,id,text){await page.evaluate(({id,text})=>{window.emit({type:'input_audio_buffer.speech_started',item_id:id});window.emit({type:'input_audio_buffer.speech_stopped',item_id:id});window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});},{id,text});}
async function tool(page,id,name,args,duplicate=false){await page.evaluate(({id,name,args,duplicate})=>{for(const responseId of duplicate?[id,id+'-redelivered']:[id]){window.emit({type:'response.created',response:{id:responseId}});window.emit({type:'response.done',response:{id:responseId,status:'completed',output:[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}]}});}},{id,name,args,duplicate});}
async function output(page,id){await page.waitForFunction(id=>window.sent.some(e=>e.item?.call_id===id),id);return page.evaluate(id=>JSON.parse(window.sent.find(e=>e.item?.call_id===id).item.output),id);}
(async()=>{
 const [{retrievalFixture},{createApp},{createProfileVoiceHandler},{createPermissionRepository}]=await Promise.all([import('../server/history-retrieval-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/guardian-permission.mjs')]);
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await retrievalFixture();let server,page;const prompts=[];
  try{
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',interest:'Nursing',goals:'',needs:'',gpa:'',color:'peach'}});
   await f.as('reader',()=>createPermissionRepository(f.db).account('reader',{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   await f.save('old-bakery','The student needs laboratory sections after the bakery shift.',{studentId});
   const env={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const {personalizationPolicy}=await import('../server/personalization-controls.mjs');
   const voice=createProfileVoiceHandler(env,async(u,o)=>{prompts.push(JSON.parse(o.body.get('session')));return new Response('v=0\r\n');},()=>{},f.db);
   const app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{if(req.url==='/api/profile-voice'){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>voice(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const ui=await setup(browser,{width,language});page=ui.page;let failSave=true;
   await page.route('**/api/profile-voice',async route=>route.fulfill({response:await route.fetch({url:api+'/api/profile-voice'})}));
   await page.route('**/api/live-memory',async route=>{const body=route.request().postDataJSON();if(body.action==='write'&&failSave){failSave=false;return route.fulfill({status:503,json:{error:'live_memory_unavailable'}});}return route.fulfill({response:await route.fetch({url:api+'/api/live-memory'})});});
   await page.route('**/api/student-memory',async route=>{const body=route.request().postDataJSON();const result=await f.memory({...body,action:body.action==='sync'?'load':body.action});return route.fulfill({json:{...result,pendingCount:0,memoryPolicy:personalizationPolicy(env,'reader')}});});
   await page.route('**/api/plans',async route=>route.fulfill({response:await route.fetch({url:api+'/api/plans'})}));
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections[0]?.connectionState==='connected');
   assert.ok(prompts[0].tools.some(t=>t.name==='recall_student_context'));
   await userTurn(page,'recall','What was my bakery schedule?');await tool(page,'recall-tool','recall_student_context',{query:'bakery laboratory'});assert.equal((await output(page,'recall-tool')).items[0].id,'old-bakery');
   const old=language==='es'?'Prefiero explicaciones breves.':'I prefer short explanations.';
   const next=language==='es'?'Prefiero ejemplos detallados.':'I prefer detailed examples.';
   const request=text=>language==='es'?`Recuerda que ${text}`:`Remember that ${text}`;
   const fields={kind:'create',category:'preference',content:old};
   await userTurn(page,'failure',request(old));await tool(page,'failed-save','save_student_memory',fields);assert.equal((await output(page,'failed-save')).status,'unavailable');assert.equal((await f.memory({action:'load',studentId})).memories.length,0);
   await userTurn(page,'save',request(old));await tool(page,'successful-save','save_student_memory',fields,true);
   await page.waitForFunction(()=>window.connections.length===2&&window.connections[1].connectionState==='connected');assert.equal(await page.evaluate(()=>window.connections[0].connectionState),'closed');
   const record=(await f.memory({action:'load',studentId})).memories[0];assert.equal(record.content,old);assert.equal(record.status,'confirmed');assert.match(await page.locator('.voice-notice').innerText(),/saved|guardó/);
   await userTurn(page,'correct',language==='es'?`Cambia ${old} a ${next}`:`Change ${old} to ${next}`);
   await tool(page,'correction','save_student_memory',{kind:'update',id:record.id,version:1,category:'preference',content:next});
   await page.waitForFunction(()=>window.connections.length===3&&window.connections[2].connectionState==='connected');assert.equal((await f.memory({action:'load',studentId})).memories[0].version,2);
   assert.ok(prompts.at(-1).instructions.includes(next));assert.ok(!prompts.at(-1).instructions.includes(old));
   const action=language==='es'?'Llamar a la consejera':'Email my counselor';await userTurn(page,'action',language==='es'?`Guarda ${action} como mi próximo paso`:`Add ${action} to my next steps`);
   await tool(page,'next-step','save_next_step',{content:action,category:'education'});await page.waitForFunction(()=>window.connections.length===4&&window.connections[3].connectionState==='connected');
   const plans=(await f.as('reader',()=>f.db.query("SELECT s.action,s.status FROM origen_plan_steps s JOIN origen_plans p ON p.account_id=s.account_id AND p.id=s.plan_id WHERE p.student_id=$1",[studentId]))).rows;assert.deepEqual(plans,[{action,status:'not-started'}]);
   // An ambiguous request needs an observed spoken readback before a short yes.
   const schedule=language==='es'?'Trabajo los sábados.':'I work on Saturdays.';
   const proposal={kind:'create',category:'constraint',content:schedule};
   await userTurn(page,'proposal',language==='es'?'Guarda mi horario':'Please save my schedule');await tool(page,'propose-schedule','save_student_memory',proposal);
   assert.equal((await output(page,'propose-schedule')).status,'clarification_required');
   assert.ok(!(await f.memory({action:'load',studentId})).memories.some(m=>m.content===schedule));
   await page.evaluate(text=>{const id='schedule-readback';window.emit({type:'response.created',response:{id}});window.emit({type:'output_audio_buffer.started',response_id:id});window.emit({type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});window.emit({type:'response.done',response:{id,status:'completed',output:[]}});window.emit({type:'output_audio_buffer.stopped',response_id:id});},language==='es'?`¿Quieres guardar: ${schedule}?`:`Should I save: ${schedule}?`);
   await userTurn(page,'accept-proposal',language==='es'?'Sí, guárdalo':'Yes, save it');await tool(page,'confirm-schedule','save_student_memory',proposal);
   await page.waitForFunction(()=>window.connections.length===5&&window.connections[4].connectionState==='connected');
   assert.equal((await f.memory({action:'load',studentId})).memories.filter(m=>m.content===schedule).length,1);
   await page.evaluate(()=>{const original=window.fetch;let held=false;window.fetch=(url,options)=>{if(!held&&String(url).endsWith('/api/live-memory')&&JSON.parse(options?.body||'{}').action==='write'){held=true;return new Promise(resolve=>{window.releaseMemoryWrite=()=>resolve(original(url,options));});}return original(url,options);};});
   await userTurn(page,'interrupted-save','Remember that INTERRUPTED_UNSAVED_DETAIL');await tool(page,'interrupted-write','save_student_memory',{kind:'create',category:'constraint',content:'INTERRUPTED_UNSAVED_DETAIL'});await page.waitForFunction(()=>typeof window.releaseMemoryWrite==='function');
   await userTurn(page,'cancel-save','Never mind, a different question');await page.evaluate(()=>window.releaseMemoryWrite());assert.equal((await output(page,'interrupted-write')).status,'cancelled');
   assert.ok(!(await f.memory({action:'load',studentId})).memories.some(m=>m.content==='INTERRUPTED_UNSAVED_DETAIL'));
   // A dependency that ignores abort must not send a private old result to voice.
   await page.evaluate(()=>{const original=window.fetch;window.fetch=(url,options)=>{if(String(url).endsWith('/api/live-memory')&&JSON.parse(options?.body||'{}').action==='read')return new Promise(resolve=>{window.releaseRecall=()=>resolve(new Response(JSON.stringify({status:'retrieved',items:[{content:'STALE_PRIVATE_EVIDENCE'}]}),{headers:{'Content-Type':'application/json'}}));});return original(url,options);};});
   await userTurn(page,'late-read','What was my schedule?');await tool(page,'delayed-recall','recall_student_context',{query:'schedule'});await page.waitForFunction(()=>typeof window.releaseRecall==='function');await userTurn(page,'new-turn','A different question');await page.evaluate(()=>window.releaseRecall());
   assert.equal((await output(page,'delayed-recall')).status,'cancelled');assert.ok(!await page.evaluate(()=>JSON.stringify(window.sent).includes('STALE_PRIVATE_EVIDENCE')));
   // Real external correction invalidates the active provider via revision polling.
   const latest=(await f.memory({action:'load',studentId})).memories[0];await f.memory({action:'delete',studentId,id:latest.id,version:latest.version});
   await page.waitForFunction(()=>window.connections.at(-1).connectionState==='closed',null,{timeout:12000});
   // Restart, then disable server policy without changing stored memory revision.
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1).connectionState==='connected');
   const storedBefore=await f.memory({action:'load',studentId});env.ORIGEN_PERSONALIZATION_MODE='off';
   await page.waitForFunction(()=>window.connections.at(-1).connectionState==='closed',null,{timeout:12000});
   assert.deepEqual(await f.memory({action:'load',studentId}),storedBefore);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);
   count++;console.log(`PASS ${width}/${language}: live recall, failed save, duplicate delivery, correction/fresh provider, accepted next step, spoken confirmation, interrupted save, late result suppression, remote deletion and active-call policy rollback.`);
  }finally{
   // Let active local API routes finish before disposing their request context.
   // Revision polling can still be in flight after the last assertion.
   await page?.unrouteAll({behavior:'wait'});
   await page?.close();if(server)await new Promise(r=>server.close(r));await f.close();
  }
 }
 console.log(`Passed ${count} live-memory browser journeys.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
