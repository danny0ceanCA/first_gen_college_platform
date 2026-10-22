// Real local UI/API/PostgreSQL; synthetic auth, media and provider events.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),{mkdir}=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'output/playwright/student-first-phase4';
async function user(page,id,text){await page.evaluate(({id,text})=>{window.emit({type:'input_audio_buffer.speech_started',item_id:id});window.emit({type:'input_audio_buffer.speech_stopped',item_id:id});window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});},{id,text});}
async function tool(page,id,name,args){await page.evaluate(({id,name,args})=>{window.emit({type:'response.created',response:{id}});window.emit({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}]}});},{id,name,args});}
async function result(page,id){await page.waitForFunction(id=>window.sent.some(e=>e.item?.call_id===id),id);return page.evaluate(id=>JSON.parse(window.sent.find(e=>e.item?.call_id===id).item.output),id);}
async function say(page,id,text,drain=true){await page.evaluate(({id,text,drain})=>{window.emit({type:'response.created',response:{id}});window.emit({type:'output_audio_buffer.started',response_id:id});window.emit({type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});window.emit({type:'response.done',response:{id,status:'completed',output:[]}});if(drain)window.emit({type:'output_audio_buffer.stopped',response_id:id});},{id,text,drain});}
(async()=>{
 const [{retrievalFixture},{createApp},{createProfileVoiceHandler},{createPermissionRepository},{personalizationPolicy}]=await Promise.all([import('../server/history-retrieval-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/guardian-permission.mjs'),import('../server/personalization-controls.mjs')]);
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await retrievalFixture();let page,server,closing=false;const prompts=[],tr=(en,es)=>language==='es'?es:en;
  try{
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',interest:'',goals:'',needs:'',gpa:'',color:'peach'}});
   await f.as('reader',()=>createPermissionRepository(f.db).account('reader',{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   const memoryId=randomUUID(),noteId=randomUUID(),old=tr('I work evenings.','Trabajo por las tardes.'),updated=tr('I work Tuesdays and Thursdays.','Trabajo los martes y jueves.');
   const oldNote=tr('Maybe nursing.','Tal vez enfermería.'),newNote=tr('Maybe engineering.','Tal vez ingeniería.');
   await f.memory({action:'create',id:memoryId,studentId,memory:{content:old,category:'constraint',speaker:'student',language}});
   await f.note({action:'create',id:noteId,studentId,note:{topic:'options',kind:'note',content:oldNote,language}});
   const env={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_GUIDED_CONVERSATION:'true',ORIGEN_BINDER_CORRECTIONS:'true',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const voice=createProfileVoiceHandler(env,async(u,o)=>{prompts.push(JSON.parse(o.body.get('session')));return new Response('v=0\r\n');},()=>{},f.db),app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{if(req.url==='/api/profile-voice'){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>voice(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const ui=await setup(browser,{width,language,configurePage:async p=>{
    page=p;p.setDefaultNavigationTimeout(30000);
    for(const path of ['profile-voice','live-memory'])await p.route(`**/api/${path}`,async route=>{try{const response=await route.fetch({url:api+'/api/'+path});if(!closing)await route.fulfill({response});}catch(error){if(!closing)throw error;}});
    await p.route('**/api/student-memory',async route=>{try{const body=route.request().postDataJSON(),data=await f.memory({...body,action:body.action==='sync'?'load':body.action});if(!closing)await route.fulfill({json:{...data,pendingCount:0,memoryPolicy:personalizationPolicy(env,'reader')}});}catch(error){if(!closing)throw error;}});
   }});page=ui.page;
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections[0]?.connectionState==='connected');assert.ok(prompts[0].tools.some(t=>t.name==='get_guidance_question'));
   await user(page,'schedule',tr('Which classes fit my schedule?','¿Qué clases caben en mi horario?'));await tool(page,'gap','get_guidance_question',{topic:'transfer'});const gap=await result(page,'gap');assert.equal(gap.key,'work_days');await say(page,'gap-readback',gap.question);
   await user(page,'skip',tr('I would rather not share that.','Prefiero no compartir eso.'));await tool(page,'skipped','get_guidance_question',{topic:'transfer'});assert.equal((await result(page,'skipped')).status,'no_question');
   assert.equal((await f.owner.query('SELECT status FROM origen_guidance_questions')).rows[0].status,'declined');
   const correction={store:'memory',kind:'update',id:memoryId,version:1,content:updated},spoken=tr('Actually, ','En realidad, ')+updated;
   await user(page,'correction',spoken);await tool(page,'propose','correct_binder_item',correction);assert.equal((await result(page,'propose')).status,'clarification_required');
   const readback=tr(`Change ${old} to ${updated} and save it?`,`¿Quieres cambiar ${old} a ${updated} y guardar?`);await say(page,'interrupted-readback',readback,false);
   if(language==='es')await page.evaluate(()=>{document.querySelector('audio').dispatchEvent(new Event('pause'));window.emit({type:'output_audio_buffer.stopped',response_id:'interrupted-readback'});});
   await user(page,'early-yes',tr('Yes, save it','Sí, guárdalo'));await tool(page,'early-write','correct_binder_item',correction);assert.equal((await result(page,'early-write')).status,'not_requested');assert.equal((await f.memory({action:'load',studentId})).memories[0].version,1);
   await page.evaluate(()=>document.querySelector('audio').play());await user(page,'correct-again',spoken);await tool(page,'propose-again','correct_binder_item',correction);assert.equal((await result(page,'propose-again')).status,'clarification_required');await say(page,'complete-readback',readback);
   if(width===320&&language==='es')await page.screenshot({path:`${output}/320-es-spoken-confirmation.png`,fullPage:true});
   await user(page,'yes',tr('Yes, save it','Sí, guárdalo'));await tool(page,'save','correct_binder_item',correction);await page.waitForFunction(()=>window.connections.length===2&&window.connections[1].connectionState==='connected');
   const current=(await f.memory({action:'load',studentId})).memories;assert.equal(current.length,1);assert.equal(current[0].content,updated);assert.equal(current[0].version,2);assert.ok(prompts.at(-1).instructions.includes(updated));assert.ok(!prompts.at(-1).instructions.includes(old));
   const note={store:'note',kind:'update',id:noteId,version:1,content:newNote};await user(page,'note',tr('Actually, ','En realidad, ')+newNote);await tool(page,'note-proposal','correct_binder_item',note);assert.equal((await result(page,'note-proposal')).status,'clarification_required');await say(page,'note-readback',tr(`Change ${oldNote} to ${newNote} and save it?`,`¿Quieres cambiar ${oldNote} a ${newNote} y guardar?`));
   await user(page,'note-yes',tr('Yes, save it','Sí, guárdalo'));await tool(page,'note-save','correct_binder_item',note);await page.waitForFunction(()=>window.connections.length===3&&window.connections[2].connectionState==='connected');
   const row=(await f.owner.query('SELECT content,kind,version FROM origen_topic_notes WHERE id=$1',[noteId])).rows[0];assert.deepEqual(row,{content:newNote,kind:'note',version:2});
   env.ORIGEN_GUIDED_CONVERSATION='false';await page.waitForFunction(()=>window.connections.at(-1).connectionState==='closed',null,{timeout:12000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);count++;console.log(`PASS ${width}/${language}: scoped question/skip, interrupted readback rejected, confirmed correction saved once, current reconnect context, tentative note preserved, active-call flag rollback.`);
  }catch(error){if(page)await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{closing=true;await page?.unrouteAll({behavior:'ignoreErrors'});await page?.close();if(server)await new Promise(r=>server.close(r));await f.close();}
 }}finally{await browser.close();}console.log(`Passed ${count} guided conversation browser journeys.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
