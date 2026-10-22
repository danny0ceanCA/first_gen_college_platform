// Real local browser/API/restricted PostgreSQL; synthetic auth, media and provider.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),{mkdir}=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin,output=process.env.ORIGEN_SMOKE_OUTPUT||'output/playwright/student-first-phase5';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname));
async function lookup(page,id){
 await page.evaluate(id=>{window.emit({type:'response.created',response:{id}});window.emit({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',name:'lookup_education_planning',call_id:id,arguments:JSON.stringify({question:'CSU application deadline for Fall 2027',institution:'CSU'})}]}});},id);
 await page.waitForFunction(id=>window.sent.some(e=>e.item?.call_id===id),id);
 return page.evaluate(id=>JSON.parse(window.sent.find(e=>e.item?.call_id===id).item.output),id);
}
(async()=>{
 const [{retrievalFixture},{createApp},{createProfileVoiceHandler},{createAdmissionsResearchHandler},{createPermissionRepository},{personalizationPolicy},{createCorrectionService,correctionSnapshot}]=await Promise.all([import('../server/history-retrieval-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/admissions-research.mjs'),import('../server/guardian-permission.mjs'),import('../server/personalization-controls.mjs'),import('../server/binder-corrections.mjs')]);
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await retrievalFixture();let server,page,closing=false,researchCalls=0;const prompts=[],tr=(en,es)=>language==='es'?es:en;
  try{
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',entryTerm:'Fall 2027',interest:'',goals:'',needs:'',gpa:'',color:'peach'}});
   await f.as('reader',()=>createPermissionRepository(f.db).account('reader',{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   const memoryId=randomUUID(),noteId=randomUUID(),old=tr('I work evenings.','Trabajo por las tardes.'),updated=tr('I work Tuesdays and Thursdays.','Trabajo los martes y jueves.'),question=tr('Which chemistry class fits?','¿Qué clase de química me conviene?');
   await f.memory({action:'create',id:memoryId,studentId,memory:{content:old,category:'constraint',speaker:'student',language}});
   await f.note({action:'create',id:noteId,studentId,note:{topic:'transfer',kind:'question',content:question,language}});
   await f.history({action:'save',item:{id:'policy',studentId,mode:'planning',summary:'Earlier application guidance was discussed.',date:'2025-01-01',sources:[{title:'CSU',url:'https://www.calstate.edu/apply',checkedAt:'2025-01-01'}]}});
   await f.owner.query("INSERT INTO origen_guidance_questions(account_id,scope_key,student_id,question_key,status) SELECT id,$1,$1,'work_days','declined' FROM origen_accounts WHERE auth0_subject='reader'",[studentId]);
   const env={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_CONVERSATION_CONTINUITY:'true',ORIGEN_BINDER_CORRECTIONS:'true',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const voice=createProfileVoiceHandler(env,async(u,o)=>{prompts.push(JSON.parse(o.body.get('session')));return new Response('v=0\r\n');},()=>{},f.db);
   const research=createAdmissionsResearchHandler(env,async(u,o)=>{researchCalls++;const sent=JSON.parse(o.body).input;assert.ok(sent.includes('Fall 2027'));assert.ok(!sent.includes(old)&&!sent.includes(updated)&&!sent.includes('Alex'));return new Response(JSON.stringify({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Synthetic cycle check.',annotations:[{type:'url_citation',url:'https://www.calstate.edu/apply',title:'CSU',start_index:0,end_index:9}]}]}]}));},()=>{},f.db);
   const app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{const handler=req.url==='/api/profile-voice'?voice:req.url==='/api/admissions-research'?research:null;if(handler){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>handler(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const ui=await setup(browser,{width,language,nativeResearch:true,configurePage:async p=>{
    page=p;p.setDefaultNavigationTimeout(30000);
    for(const path of ['profile-voice','live-memory','admissions-research'])await p.route(`**/api/${path}`,async route=>{try{const response=await route.fetch({url:api+'/api/'+path});if(!closing)await route.fulfill({response});}catch(error){if(!closing)throw error;}});
    await p.route('**/api/student-memory',async route=>{try{const body=route.request().postDataJSON(),data=await f.memory({...body,action:body.action==='sync'?'load':body.action});if(!closing)await route.fulfill({json:{...data,pendingCount:0,memoryPolicy:personalizationPolicy(env,'reader')}});}catch(error){if(!closing)throw error;}});
   }});page=ui.page;
   const start=async()=>{await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');};
   await start();assert.ok(prompts.at(-1).instructions.includes(old));assert.match(prompts.at(-1).instructions,/RETURN CONVERSATION/);assert.match(prompts.at(-1).instructions,/recentQuestions.*declined/);
   assert.equal((await lookup(page,'first-check')).status,'source_check_completed');assert.equal(researchCalls,1);
   assert.equal((await lookup(page,'same-call')).status,'reused_verified_result');assert.equal(researchCalls,1);
   // End this physical browser visit; the next visit must assemble current data.
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor();await page.locator('.voice-ready').waitFor();
   const correction=async(store,row,value)=>f.as('reader',()=>createCorrectionService(f.db,env)('reader',{operationId:randomUUID(),store,studentId,id:row.id,version:row.version,action:'update',before:correctionSnapshot(row,store),value}));
   await correction('memory',(await f.memory({action:'load',studentId})).memories[0],{category:'constraint',content:updated,language,speaker:'student'});
   await correction('note',(await f.note({action:'load',studentId})).notes[0],{topic:'transfer',kind:'note',content:tr('The counselor explained the class choice.','La consejera explicó la elección de clase.'),language});
   await start();const prompt=prompts.at(-1).instructions;assert.ok(prompt.includes(updated));assert.ok(!prompt.includes(old)&&!prompt.includes(question));assert.match(prompt,/openQuestionRefs.*\[\]/);assert.match(prompt,/Fall 2027/);assert.match(prompt,/recordedCheckedAt.*2025-01-01/);assert.match(prompt,/requiresFreshLookup.*true/);
   assert.equal((await lookup(page,'return-check')).status,'source_check_completed');assert.equal(researchCalls,2);
   if(width===320&&language==='es')await page.screenshot({path:`${output}/320-es-return-conversation.png`,fullPage:true});
   env.ORIGEN_CONVERSATION_CONTINUITY='false';await page.waitForFunction(()=>window.connections.at(-1).connectionState==='closed',null,{timeout:12000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);count++;console.log(`PASS ${width}/${language}: current correction and resolved note on return, declined prompt retained, source date/cycle preserved, fresh research in new call, same-call reuse, active rollback.`);
  }catch(error){if(page)await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{closing=true;await page?.unrouteAll({behavior:'ignoreErrors'});await page?.close();if(server)await new Promise(r=>server.close(r));await f.close();}
 }}finally{await browser.close();}console.log(`Passed ${count} return conversation browser journeys.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
