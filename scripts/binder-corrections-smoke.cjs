// Synthetic UI + real isolated API/PostgreSQL. No production or paid providers.
const {createRequire}=require('node:module'),{createServer}=require('node:http'),{mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin;
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'output/binder-corrections-browser';
const closing=new WeakSet();
async function close(page){if(!page)return;closing.add(page);await page.unrouteAll({behavior:'ignoreErrors'});await page.close();}
(async()=>{
 const [{binderFixture},{createApp},{createOrganizationService}]=await Promise.all([import('../server/binder-jobs-fixture.mjs'),import('../server/index.mjs'),import('../server/binder-organization.mjs')]);
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await binderFixture();let server,page;const tr=(en,es)=>language==='es'?es:en;
  const goal=tr('The student is considering nursing.','La estudiante quizá estudie enfermería.'),question=tr('Which aid application is needed?','¿Qué ayuda económica puedo solicitar?');
  const revised=tr('I am considering engineering.','Estoy considerando ingeniería.'),revisedQuestion=tr('Which engineering scholarship can I apply for?','¿Qué beca de ingeniería puedo solicitar?');
  const bodies=[];let drop=width===1280&&language==='en';
  try{
   await f.family('reader',{action:'save-account',account:{firstName:'Alex',email:'',role:'student'}});
   await f.family('reader',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'12th grade',interest:'College',gpa:'',color:'peach'}});
   for(const id of ['alex','sam'])await f.family('reader',{action:'delete-student',id});
   await f.save('source',goal+' '+question,{studentId});
   const extraction={ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'};
   await f.as('reader',()=>createOrganizationService(f.db,extraction,async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items:[{topic:'options',category:'goal',certainty:'tentative',language,quote:goal},{topic:'costs',category:'question',certainty:'unresolved',language,quote:question}]})}]}]})))('reader',{studentId,summaryId:'source'}));
   const app=createApp({ORIGEN_BINDER_CORRECTIONS:'true',ORIGEN_PERSONALIZATION_EXTRACTION:'false',ALLOWED_ORIGINS:origin},async()=>({sub:'reader'}),f.db,()=>{});
   server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
   const ui=await setup(browser,{width,language,configurePage:async p=>{
    page=p;p.setDefaultNavigationTimeout(30000);
    for(const path of ['family','conversation-history','student-memory','plans','topic-notes','binder-changes'])await p.route(`**/api/${path}`,async route=>{
     try{
      const body=route.request().postDataJSON();if(path==='binder-changes')bodies.push(body);
      const response=await route.fetch({url:api+'/api/'+path});
      if(path==='binder-changes'&&drop&&body.action==='update'){drop=false;assert.equal(response.status(),200);await route.abort('failed');return;}
      if(!closing.has(p))await route.fulfill({response});
     }catch(error){if(!closing.has(p))throw error;}
    });
   }});page=ui.page;await openBinder(page);
   const memory=page.locator('.student-memory');await memory.locator('summary').first().click();await memory.locator('.memory-writing').filter({hasText:goal}).waitFor();
   await memory.getByRole('button',{name:tr('Edit detail','Editar dato'),exact:true}).click();await memory.locator('textarea').fill(revised);
   await memory.getByRole('button',{name:tr('Save detail','Guardar dato'),exact:true}).click();
   if(width===1280&&language==='en'){
    await memory.getByRole('alert').waitFor();await memory.getByRole('button',{name:'Save detail',exact:true}).click();
    assert.equal(bodies[0].operationId,bodies[1].operationId,'lost-response retry reuses its identity');
   }
   await memory.locator('.memory-writing').filter({hasText:revised}).waitFor();
   await memory.getByRole('button',{name:tr('Undo last change','Deshacer último cambio'),exact:true}).click();await memory.locator('.memory-writing').filter({hasText:goal}).waitFor();
   await memory.getByRole('button',{name:tr('Remove detail','Quitar dato'),exact:true}).click();await memory.locator('.memory-entry').waitFor({state:'detached'});
   await memory.getByRole('button',{name:tr('Undo last change','Deshacer último cambio'),exact:true}).click();await memory.locator('.memory-writing').filter({hasText:goal}).waitFor();
   if(width<700){const back=page.locator('.notebook-page-navigation button');if(await back.isVisible())await back.click();await page.locator('[data-topic="costs"]').click();}else await page.locator('#notebook-tab-costs').click();
   const topic=page.locator('#notebook-panel');await topic.locator('.notebook-note-content').filter({hasText:question}).waitFor();
   await topic.getByRole('button',{name:tr('Edit','Editar'),exact:true}).click();await topic.locator('textarea').fill(revisedQuestion);await topic.getByRole('button',{name:tr('Save note','Guardar nota'),exact:true}).click();
   await topic.locator('.notebook-note-content').filter({hasText:revisedQuestion}).waitFor();
   await topic.getByRole('button',{name:tr('Undo last change','Deshacer último cambio'),exact:true}).click();await topic.locator('.notebook-note-content').filter({hasText:question}).waitFor();
   await topic.getByRole('button',{name:tr('Remove','Quitar'),exact:true}).click();await topic.locator('.notebook-note-content').waitFor({state:'detached'});
   if(width===320&&language==='es')await page.screenshot({path:`${output}/320-es-undo.png`,fullPage:true});
   await topic.getByRole('button',{name:tr('Undo last change','Deshacer último cambio'),exact:true}).click();await topic.locator('.notebook-note-content').filter({hasText:question}).waitFor();
   assert.equal((await f.notes('reader',studentId)).notes.length,1);assert.equal((await f.memory({action:'load',studentId})).memories.length,1,'explicitly restored memory survives later changes to related notes');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(ui.state.errors,[]);
   // Reload drops browser-only undo state while keeping acknowledged data.
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor();await openBinder(page);assert.equal(await page.getByRole('button',{name:tr('Undo last change','Deshacer último cambio'),exact:true}).count(),0);
   count++;console.log(`PASS ${width}/${language}: edit/remove/undo memory and notes, durable reload, no overflow${width===1280&&language==='en'?', lost-response retry persisted once':''}.`);
  }catch(error){if(page)await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{await close(page);if(server)await new Promise(r=>server.close(r));await f.close();}
 }}finally{await browser.close();}console.log(`Passed ${count} correction browser journeys.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
