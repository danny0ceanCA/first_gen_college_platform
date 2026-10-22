// Synthetic voice + real local API/PostgreSQL/worker. No production or paid AI.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),{mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'output/binder-organization-browser';
const textResponse=text=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text}]}]}));
async function until(check){for(let i=0;i<500;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Local organization did not finish');}
const closingPages=new WeakSet();
async function closePage(page){if(!page)return;closingPages.add(page);await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
(async()=>{
 const [{binderFixture},{createApp},{createProfileVoiceHandler},{createSummaryHandler},{startBinderWorker}]=await Promise.all([import('../server/binder-jobs-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/conversation-summary.mjs'),import('../server/binder-jobs.mjs')]);
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await binderFixture();let server,page,stop;let calls=0;
  const tr=(en,es)=>language==='es'?es:en;
  const goal=tr('The student is considering nursing.','La estudiante quizá estudie enfermería.');
  const constraint=tr('The student works evenings.','La estudiante trabaja por las tardes.');
  const question=tr('Which aid application is needed?','¿Qué ayuda económica puedo solicitar?');
  const narrative=[goal,constraint,question].join(' ');
  try{
   await f.family('reader',{action:'save-account',account:{firstName:'Alex',email:'',role:'student'}});
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',interest:'Nursing',gpa:'',color:'peach'}});
   for(const id of ['alex','sam'])await f.family('reader',{action:'delete-student',id});
   const env={ORIGEN_BINDER_JOBS:'true',ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const handlers={'/api/profile-voice':createProfileVoiceHandler(env,async()=>new Response('v=0\r\n'),()=>{},f.db),'/api/conversation-summary':createSummaryHandler(env,async()=>textResponse(narrative),f.db)};
   const app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{const handler=handlers[req.url];if(handler){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>handler(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const open=()=>setup(browser,{width,language,configurePage:async p=>{
    page=p;
    if(process.env.ORIGEN_SMOKE_DEBUG==='true'){
     p.on('request',r=>console.log('REQUEST',new URL(r.url()).pathname));
     p.on('requestfailed',r=>console.log('REQUEST FAILED',new URL(r.url()).pathname,r.failure()?.errorText));
     p.on('pageerror',error=>console.log('PAGE ERROR',error.stack));
    }
    p.setDefaultNavigationTimeout(30000);
    for(const path of ['family','profile-voice','conversation-summary','conversation-history','student-memory','plans','topic-notes'])await p.route(`**/api/${path}`,async route=>{
     try{const response=await route.fetch({url:api+'/api/'+path});if(!closingPages.has(p))await route.fulfill({response});}
     catch(error){if(!closingPages.has(p))throw error;}
    });
   }});
   let ui=await open();page=ui.page;await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');
   await page.evaluate(async text=>{
    await window.emit({type:'response.done',response:{id:'opening',status:'completed',output:[]}});
    await window.emit({type:'input_audio_buffer.speech_started',item_id:'student-question'});await window.emit({type:'input_audio_buffer.speech_stopped',item_id:'student-question'});
    await window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'student-question',transcript:text});
    await window.emit({type:'response.output_audio_transcript.done',transcript:'We can explore that together.'});await window.emit({type:'response.done',response:{id:'answer',status:'completed',output:[]}});
   },narrative);
   await page.locator('.voice-end').click();await until(async()=>Number((await f.owner.query('SELECT count(*) AS n FROM origen_conversation_summaries')).rows[0].n)===1);
   await page.waitForFunction(()=>!document.querySelector('.shared-summary-status'));assert.deepEqual(ui.state.errors,[]);await closePage(page);page=undefined;
   stop=startBinderWorker({application:f.db,maintenance:f.maintenance,schema:f.schema,env,intervalMs:20,request:async()=>{
    calls++;return textResponse(JSON.stringify({items:[{topic:'options',category:'goal',certainty:'tentative',language,quote:goal},{topic:'transfer',category:'constraint',certainty:'stated',language,quote:constraint},{topic:'costs',category:'question',certainty:'unresolved',language,quote:question}]}));
   }});
   await until(async()=>(await f.owner.query('SELECT status FROM origen_binder_jobs')).rows[0]?.status==='complete');await stop();stop=undefined;
   ui=await open();page=ui.page;await openBinder(page);
   const memory=page.locator('.student-memory');await memory.locator('summary').first().click();await memory.locator('.memory-writing').filter({hasText:goal}).waitFor();await memory.getByText(tr('Still exploring','Por explorar'),{exact:true}).waitFor();
   if(width===1280&&language==='en')await page.screenshot({path:`${output}/${width}-${language}-memory.png`,fullPage:true});
   await memory.locator('select').first().selectOption('constraint');await memory.locator('.memory-writing').filter({hasText:constraint}).waitFor();
   if(width<700){const back=page.locator('.notebook-page-navigation button');if(await back.isVisible())await back.click();await page.locator('[data-topic="costs"]').click();}else await page.locator('#notebook-tab-costs').click();
   await page.getByText(question,{exact:true}).first().waitFor();await page.getByText(tr('Open question','Pregunta pendiente'),{exact:true}).waitFor();
   assert.equal(calls,1);assert.equal((await f.notes('reader',studentId)).notes.length,1);assert.equal((await f.memory({action:'load',studentId})).memories.length,2);
   assert.equal(Number((await f.owner.query('SELECT count(*) AS n FROM origen_plans')).rows[0].n),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);
   if(width===320&&language==='es')await page.screenshot({path:`${output}/${width}-${language}-question.png`,fullPage:true});
   count++;console.log(`PASS ${width}/${language}: conversation saved, browser closed, one worker extraction, tentative goal, stated constraint, open question, no plan or duplicate.`);
  }catch(error){if(page)await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{await closePage(page);await stop?.();if(server)await new Promise(r=>server.close(r));await f.close();}
 }}finally{await browser.close();}console.log(`Passed ${count} organization browser journeys.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
