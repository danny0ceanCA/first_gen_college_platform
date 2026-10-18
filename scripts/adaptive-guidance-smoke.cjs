// Real Chromium, scoped API handlers and PostgreSQL; synthetic provider outputs.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),{randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
const reply=text=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text}]}]}));
async function topic(page,id,width){if(width<700){const back=page.locator('.notebook-page-navigation button');if(await back.isVisible())await back.click();await page.locator(`[data-topic="${id}"]`).click();}else await page.locator(`#notebook-tab-${id}`).click();}
async function userTurn(page,id,text){await page.evaluate(async({id,text})=>{await window.emit({type:'input_audio_buffer.speech_started',item_id:id});await window.emit({type:'input_audio_buffer.speech_stopped',item_id:id});await window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});},{id,text});}
async function assistant(page,text){await page.evaluate(async text=>{await window.emit({type:'response.output_audio_transcript.done',transcript:text});await window.emit({type:'response.done',response:{id:'spoken-'+Math.random(),status:'completed',output:[]}});},text);}
async function tool(page,id,name,args){await page.evaluate(({id,name,args})=>{window.emit({type:'response.created',response:{id}});window.emit({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}]}});},{id,name,args});}
async function output(page,id){await page.waitForFunction(id=>window.sent.some(e=>e.item?.call_id===id),id);return page.evaluate(id=>JSON.parse(window.sent.find(e=>e.item?.call_id===id).item.output),id);}
(async()=>{
 const [{retrievalFixture},{createApp},{createProfileVoiceHandler},{createSummaryHandler},{createTopicNotesHandler},{createAdmissionsResearchHandler},{createPermissionRepository}]=await Promise.all([import('../server/history-retrieval-fixture.mjs'),import('../server/index.mjs'),import('../server/profile-voice.mjs'),import('../server/conversation-summary.mjs'),import('../server/topic-notes.mjs'),import('../server/admissions-research.mjs'),import('../server/guardian-permission.mjs')]);
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await retrievalFixture();let server,page,closing=false;const prompts=[],research=[];const tr=(a,b)=>language==='es'?b:a;
  try{
   for(const id of ['alex','sam'])await f.family('reader',{action:'delete-student',id});
   for(const [id,name] of [[studentId,'Alex Rivera'],['sibling','Sam Rivera']])await f.family('reader',{action:'save-student',student:{id,name,stage:'Community college',interest:'Nursing',gpa:'',color:'peach',goals:'Compare nearby college programs.',needs:''}});
   await f.family('reader',{action:'welcome-heard'});
   await f.as('reader',()=>createPermissionRepository(f.db).account('reader',{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   await f.save('old-work','The parent reported a bakery job and a need for evening laboratories.',{studentId});
   await f.save('sibling-private','SIBLING_PRIVATE astronomy scholarship.',{studentId:'sibling'});
   const oldGoal=tr('My student is exploring engineering.','Mi estudiante está explorando ingeniería.'),newGoal=tr('My student is exploring nursing.','Mi estudiante está explorando enfermería.');
   const preference=tr('I prefer short explanations with one example.','Prefiero explicaciones cortas con un ejemplo.');
   const goalId=randomUUID();
   for(const [id,category,content] of [[goalId,'goal',oldGoal],[randomUUID(),'preference',preference]])await f.memory({action:'create',studentId,id,memory:{category,content,language,speaker:'parent'}});
   const narrative=tr('We compared nursing programs that might fit a bakery work schedule. Current application information was checked with an official college source. Evening laboratory availability still needs confirmation.','Comparamos programas de enfermería que podrían ajustarse al horario de trabajo en la panadería. Consultamos información actual de solicitudes en una fuente oficial. Aún falta confirmar la disponibilidad de laboratorios por la tarde.');
   const question=tr('Are evening laboratories available?','¿Hay laboratorios por la tarde?');
   let failSummary=true,failNotes=true;
   const env={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic',ALLOWED_ORIGINS:origin};
   const handlers={
    '/api/profile-voice':createProfileVoiceHandler(env,async(u,o)=>{prompts.push(JSON.parse(o.body.get('session')));return new Response('v=0\r\n');},()=>{},f.db),
    '/api/conversation-summary':createSummaryHandler(env,async(u,o)=>{const body=JSON.parse(o.body);if(body.instructions.startsWith('Write a natural narrative summary')&&failSummary){failSummary=false;return new Response('',{status:503});}return reply(narrative);},f.db),
    '/api/topic-notes':createTopicNotesHandler(f.db,env,async(u,o)=>{const body=JSON.parse(o.body),source=JSON.parse(body.input).summary;if(source!==narrative)return reply('{"notes":[]}');if(failNotes)return new Response('',{status:503});return reply(JSON.stringify({notes:[{topic:'options',kind:'explanation',content:tr('Compare nursing programs with the work schedule in mind.','Comparar programas de enfermería considerando el horario de trabajo.'),quote:narrative.split('. ')[0]+'.'},{topic:'transfer',kind:'question',content:question,quote:tr('Evening laboratory availability still needs confirmation.','Aún falta confirmar la disponibilidad de laboratorios por la tarde.')}]}));}),
    '/api/admissions-research':createAdmissionsResearchHandler(env,async(u,o)=>{research.push(JSON.parse(o.body));return new Response(JSON.stringify({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:tr('Check the college application instructions for your entry term.','Revisa las instrucciones de solicitud para tu periodo de ingreso.'),annotations:[{type:'url_citation',url:'https://www.cccapply.org/en/apply',title:'California Community Colleges',start_index:0,end_index:10}]}]}]}));},()=>{},f.db),
   };
   const {personalizationPolicy}=await import('../server/personalization-controls.mjs');
   const app=createApp(env,async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer((req,res)=>{const handler=handlers[req.url];if(handler){req.origenAuthorized=true;req.origenIdentity={sub:'reader'};void f.as('reader',()=>handler(req,res,()=>{res.writeHead(404);res.end();}));}else app(req,res);});
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const ui=await setup(browser,{width,language,nativeResearch:true,reducedMotion:width===320?'reduce':'no-preference',configurePage:async p=>{
    for(const path of ['family','profile-voice','conversation-history','conversation-summary','topic-notes','live-memory','plans','admissions-research'])await p.route(`**/api/${path}`,async route=>{try{await route.fulfill({response:await route.fetch({url:api+'/api/'+path})});}catch(error){if(!closing)throw error;}});
    await p.route('**/api/student-memory',async route=>{try{const body=route.request().postDataJSON();const result=await f.memory({...body,action:body.action==='sync'?'load':body.action});await route.fulfill({json:{...result,pendingCount:0,memoryPolicy:personalizationPolicy(env,'reader')}});}catch(error){if(!closing)throw error;}});
   }});page=ui.page;
   await openBinder(page);await topic(page,'options',width);
   await page.locator('.notebook-toolbar .voice-origen-button').click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');
   assert.ok(prompts.at(-1).instructions.includes(preference));assert.ok(!prompts.at(-1).instructions.includes('SIBLING_PRIVATE'));
   await userTurn(page,'old-constraint',tr('What did I say about the bakery schedule?','¿Qué dije sobre el horario de la panadería?'));await tool(page,'recall','recall_student_context',{query:'bakery evening laboratories'});assert.equal((await output(page,'recall')).items[0].id,'old-work');
   await userTurn(page,'goal-correction',language==='es'?`Cambia ${oldGoal} a ${newGoal}`:`Change ${oldGoal} to ${newGoal}`);await tool(page,'correct','save_student_memory',{kind:'update',id:goalId,version:1,category:'goal',content:newGoal});await page.waitForFunction(()=>window.connections.length===2&&window.connections.at(-1).connectionState==='connected');assert.ok(prompts.at(-1).instructions.includes(newGoal));assert.ok(!prompts.at(-1).instructions.includes(oldGoal));
   const action=tr('Check application requirements','Revisar los requisitos de solicitud');await userTurn(page,'action',language==='es'?`Guarda ${action} como mi próximo paso`:`Add ${action} to my next steps`);await tool(page,'save-step','save_next_step',{content:action,category:'applications'});await page.waitForFunction(()=>window.connections.length===3&&window.connections.at(-1).connectionState==='connected');
   await userTurn(page,'research',tr('Check official community college application instructions.','Consulta las instrucciones oficiales para solicitar ingreso a un colegio comunitario.'));await tool(page,'official','lookup_education_planning',{question:'Community college application instructions for fall 2027',institution:'California Community Colleges',language});const evidence=await output(page,'official');assert.equal(evidence.status,'source_check_completed');assert.equal(evidence.sources[0].url,'https://www.cccapply.org/en/apply');assert.equal(research.length,1);assert.ok(!JSON.stringify(research).includes('Alex Rivera'));
   await assistant(page,narrative);await page.locator('.voice-end').click();await page.locator('.shared-summary-error').waitFor();
   await page.locator('.shared-summary-error').getByRole('button',{name:tr('Retry saving summary','Volver a guardar el resumen'),exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.summary-save-error')&&!document.querySelector('.voice-save-status'));
   await page.locator('.notebook-sync-status').filter({hasText:tr('Some conversation points','Todavía no se pudieron')}).waitFor();failNotes=false;await page.locator('.notebook-sync-status').getByRole('button',{name:tr('Try again','Intentar de nuevo'),exact:true}).click();
   await page.locator('.notebook-note').first().waitFor();assert.equal((await f.history({action:'load',studentId})).items.filter(i=>i.summary===narrative).length,1);
   // Deferral persists through existing optimistic plan updates, without completion.
   await topic(page,'summary',width);const planSection=page.locator('.action-plan');await planSection.getByRole('button',{name:tr('See all my steps','Ver todos mis pasos'),exact:true}).click();
   await planSection.getByText(tr('Loading your plan…','Cargando tu plan…'),{exact:true}).waitFor({state:'hidden'});await planSection.getByRole('button',{name:tr('Set aside','Poner en pausa'),exact:true}).click();await planSection.getByRole('button',{name:tr('Resume action','Retomar acción'),exact:true}).waitFor();
   assert.equal((await f.as('reader',()=>f.db.query('SELECT status FROM origen_plan_steps'))).rows[0].status,'deferred');
   await topic(page,'transfer',width);const point=page.locator('.notebook-note').filter({hasText:question});await point.locator('.notebook-note-menu > summary').click();await point.getByRole('button',{name:tr('Talk about this','Hablemos de esto'),exact:true}).focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>window.connections.length===4&&window.connections.at(-1).connectionState==='connected');const resumed=prompts.at(-1).instructions;assert.ok(resumed.includes(question));assert.ok(resumed.includes(newGoal));assert.ok(resumed.includes(preference));assert.ok(resumed.includes('"reviewedByUser":false'));assert.ok(!resumed.includes('SIBLING_PRIVATE'));assert.ok(!resumed.includes(oldGoal));
   assert.ok((await f.note({action:'load',studentId})).notes.every(n=>n.status==='suggested'));await assistant(page,tr('We can return to your question about evening laboratories.','Podemos retomar tu pregunta sobre los laboratorios de tarde.'));await userTurn(page,'returning',tr('Help me compare these programs with evening labs.','Ayúdame a comparar estos programas con laboratorios por la tarde.'));await assistant(page,tr('We can check the laboratory schedule with each college.','Podemos consultar el horario de laboratorio con cada colegio.'));
   await page.locator('.voice-end').click();await page.waitForFunction(()=>window.connections.at(-1).connectionState==='closed');await page.waitForFunction(()=>!document.querySelector('.voice-save-status')&&!document.querySelector('.shared-summary-status'));
   assert.equal((await f.history({action:'load',studentId})).items.filter(i=>i.summary===narrative).length,2);
   // A binder point becomes a separate action only after explicit review/save.
   await page.locator('.notebook-sync-status').filter({hasText:tr('Organizing conversation key points','Organizando los puntos clave')}).waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('.notebook-panel [role=alert]'));await point.locator('.notebook-note-menu > summary').click();await point.getByRole('button',{name:tr('Make a next step','Crear un próximo paso'),exact:true}).click();
   const editor=planSection.locator('.action-editor');await editor.waitFor();await editor.getByLabel(tr('Action title','Título de la acción'),{exact:true}).fill(tr('Ask about evening labs','Preguntar por laboratorios de tarde'));
   await topic(page,'options',width);await topic(page,'summary',width);assert.equal(await editor.getByLabel(tr('Action title','Título de la acción'),{exact:true}).inputValue(),tr('Ask about evening labs','Preguntar por laboratorios de tarde'));
   assert.equal((await f.as('reader',()=>f.db.query('SELECT count(*)::int AS count FROM origen_plans'))).rows[0].count,1);
   await editor.getByRole('checkbox').check();await editor.getByRole('button',{name:tr('Accept and save actions','Aceptar y guardar acciones'),exact:true}).click();await editor.waitFor({state:'hidden'});
   const link=(await f.as('reader',()=>f.db.query('SELECT l.note_id,s.status FROM origen_plan_note_links l JOIN origen_plan_steps s ON s.account_id=l.account_id AND s.plan_id=l.plan_id AND s.id=l.step_id'))).rows;assert.equal(link.length,1);assert.equal(link[0].status,'not-started');
   assert.ok((await f.note({action:'load',studentId})).notes.every(n=>n.status==='suggested'));

   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);
   if(width===390&&language==='en')await page.screenshot({path:'/tmp/origen-phase5-mobile.png',fullPage:true});
   count++;console.log(`PASS ${width}/${language}: parent/two-student boundaries, old constraint, goal correction, accepted application action, official-source lookup, summary/extraction retry, deferral, returning point conversation, and reviewed note-to-action draft.`);
  }catch(error){if(page){await page.screenshot({path:'/tmp/origen-phase5-failed.png',fullPage:true}).catch(()=>{});console.log((await page.locator('body').innerText()).slice(-6500));}throw error;}finally{closing=true;await page?.close();if(server)await new Promise(r=>server.close(r));await f.close();}
 }console.log(`Passed ${count} adaptive-guidance browser journeys.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
