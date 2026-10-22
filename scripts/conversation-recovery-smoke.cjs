// Local Chrome, local restricted PostgreSQL/API, synthetic auth/audio/provider.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),{mkdir}=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin,output=process.env.ORIGEN_SMOKE_OUTPUT||'output/playwright/student-first-phase6';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
async function until(work){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await work())return;await new Promise(r=>setTimeout(r,100));}throw new Error('condition_timeout');}
async function user(page,id,text){await page.evaluate(({id,text})=>{window.emit({type:'input_audio_buffer.speech_started',item_id:id});window.emit({type:'input_audio_buffer.speech_stopped',item_id:id});window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});},{id,text});}
async function tool(page,id,args){await page.evaluate(({id,args})=>{window.emit({type:'response.created',response:{id}});window.emit({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',name:'correct_binder_item',call_id:id,arguments:JSON.stringify(args)}]}});},{id,args});}
async function say(page,id,text){await page.evaluate(({id,text})=>{window.emit({type:'response.created',response:{id}});window.emit({type:'output_audio_buffer.started',response_id:id});window.emit({type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});window.emit({type:'response.done',response:{id,status:'completed',output:[]}});window.emit({type:'output_audio_buffer.stopped',response_id:id});},{id,text});}
(async()=>{
 const [{binderFixture},{createApp},{createProfileVoiceHandler},{personalizationPolicy},{createRecoveryProcessor,claimRecoveryJob},{runRetentionJob,isolateDatabase}]=await Promise.all([import('../server/binder-jobs-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/personalization-controls.mjs'),import('../server/conversation-recovery.mjs'),import('../server/account-isolation.mjs')]);
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await binderFixture();let page,server,closing=false,failLogout=false,unconfirmedLogout=false;const prompts=[],tr=(en,es)=>language==='es'?es:en;
  try{
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',interest:'',goals:'',needs:'',gpa:'',color:'peach'}});
   const memoryId=randomUUID(),old=tr('I work evenings.','Trabajo por las tardes.'),updated=tr('I work Tuesdays and Thursdays.','Trabajo los martes y jueves.'),interest=tr('Maybe nursing. I need help with college costs.','Tal vez enfermería. Necesito ayuda con el costo de la universidad.');
   await f.memory({action:'create',id:memoryId,studentId,memory:{content:old,category:'constraint',speaker:'student',language}});
   const env={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_GUIDED_CONVERSATION:'true',ORIGEN_BINDER_CORRECTIONS:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_CONVERSATION_RECOVERY:'true',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const voice=createProfileVoiceHandler(env,async(u,o)=>{prompts.push(JSON.parse(o.body.get('session')));return new Response('v=0\r\n');},()=>{},f.db),app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{if(req.url==='/api/profile-voice'){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>voice(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const ui=await setup(browser,{width,language,configurePage:async p=>{
    page=p;p.setDefaultNavigationTimeout(30000);
    for(const path of ['profile-voice','live-memory','conversation-recovery','conversation-history'])await p.route(`**/api/${path}`,async route=>{try{if(path==='conversation-recovery'&&route.request().postDataJSON().action==='stop'){if(failLogout){failLogout=false;return route.fulfill({status:503,json:{error:'recovery_unavailable'}});}if(unconfirmedLogout){unconfirmedLogout=false;return route.fulfill({json:{stopped:false}});}}const response=await route.fetch({url:api+'/api/'+path});if(!closing)await route.fulfill({response});}catch(error){if(!closing)throw error;}});
    await p.route('**/api/student-memory',async route=>{try{const body=route.request().postDataJSON(),data=await f.memory({...body,action:body.action==='sync'?'load':body.action});if(!closing)await route.fulfill({json:{...data,pendingCount:0,memoryPolicy:personalizationPolicy(env,'reader')}});}catch(error){if(!closing)throw error;}});
   }});page=ui.page;
   const start=async()=>{await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');};
   const optin=page.getByLabel(tr('Keep a private recovery copy for this session (up to 24 hours).','Conservar una copia privada de recuperación para esta sesión (hasta 24 horas).'));
   await optin.check();await start();await user(page,'interest',interest);
   await until(async()=>Number((await f.owner.query('SELECT count(*) AS n FROM origen_checkpoint_text')).rows[0].n)===1);
   const id=(await f.owner.query('SELECT id FROM origen_checkpoint_text')).rows[0].id;
   await page.getByText(tr('Recovery copy acknowledged. New words may still be uploading.','Copia de recuperación confirmada. Las palabras nuevas pueden estar subiendo.')).waitFor();
   assert.equal((await f.history({action:'load',studentId})).items.length,0);
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('.voice-ready').waitFor();assert.equal(await optin.isChecked(),false);
   await page.getByRole('button',{name:tr('Review conversation','Revisar conversación'),exact:true}).click();await page.getByText(interest,{exact:true}).waitFor();
   if(width===320&&language==='es')await page.screenshot({path:`${output}/320-es-recovery-review.png`,fullPage:true});
   await page.getByLabel(tr('I checked these details against my current binder. Save the remaining discussion.','Revisé estos detalles con mi carpeta actual. Guardar el resto de la conversación.')).check();
   await page.getByRole('button',{name:tr('Save reviewed summary','Guardar resumen revisado'),exact:true}).click();
   await until(async()=>(await f.owner.query('SELECT status FROM origen_conversation_checkpoints WHERE id=$1',[id])).rows[0].status==='pending');
   const job=await runRetentionJob(()=>claimRecoveryJob(isolateDatabase(f.maintenance,{schema:f.schema})));
   assert.equal(await createRecoveryProcessor(f.db,env,async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:interest}]}]})))(job),'complete');
   await until(async()=>!(await page.getByRole('button',{name:tr('Discard recovery copy','Descartar copia de recuperación'),exact:true}).count()));
   assert.equal((await f.history({action:'load',studentId})).items.length,1);assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);
   // A live correction must preserve the earlier discussion for review, while
   // the reconnected voice uses the current correction immediately.
   await optin.check();await start();await user(page,'before-correction',interest);
   const correction={store:'memory',kind:'update',id:memoryId,version:1,content:updated};await user(page,'correction',tr('Actually, ','En realidad, ')+updated);await tool(page,'propose',correction);
   await page.waitForFunction(()=>window.sent.some(e=>e.item?.call_id==='propose'));
   await say(page,'readback',tr(`Change ${old} to ${updated} and save it?`,`¿Quieres cambiar ${old} a ${updated} y guardar?`));
   await user(page,'yes',tr('Yes, save it','Sí, guárdalo'));await tool(page,'save',correction);await page.waitForFunction(()=>window.connections.length===2&&window.connections.at(-1).connectionState==='connected');
   assert.ok(prompts.at(-1).instructions.includes(updated));assert.ok(!prompts.at(-1).instructions.includes(old));
   const preserved=(await f.owner.query('SELECT j.status,t.body FROM origen_conversation_checkpoints j JOIN origen_checkpoint_text t USING(account_id,id)')).rows;
   assert.equal(preserved.length,1);assert.equal(preserved[0].status,'review');assert.ok(preserved[0].body.turns.some(t=>t.text===interest));
   await page.getByRole('button',{name:tr('Discard recovery copy','Descartar copia de recuperación'),exact:true}).click();
   await until(async()=>!(await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const stored=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));assert.ok(!stored.includes(interest)&&!stored.includes(updated));assert.deepEqual(ui.state.errors,[]);
   await user(page,'before-logout',interest);await until(async()=>(await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length===1);
   if(width===1280&&language==='en'){
    failLogout=true;await page.getByRole('button',{name:'Log out',exact:true}).click();await page.getByRole('alert').filter({hasText:'Could not clear temporary recovery copies'}).waitFor();
    assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,1);
    unconfirmedLogout=true;await page.getByRole('button',{name:'Log out',exact:true}).click();
    await until(async()=>!unconfirmedLogout);await page.getByRole('alert').filter({hasText:'Could not clear temporary recovery copies'}).waitFor();
    assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,1);
   }
   await page.getByRole('button',{name:tr('Log out','Cerrar sesión'),exact:true}).click();await page.getByText(/Your session ended/).waitFor();assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);
   count++;console.log(`PASS ${width}/${language}: opt-in, acknowledged checkpoint, reload and review, durable single summary, correction reconnect retains earlier discussion for review, discard, acknowledged logout fence, no browser transcript storage.`);
  }catch(error){if(page)await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{closing=true;await page?.unrouteAll({behavior:'ignoreErrors'});await page?.close();if(server)await new Promise(r=>server.close(r));await f.close();}
 }}finally{await browser.close();}console.log(`Passed ${count} recovery browser journeys.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
