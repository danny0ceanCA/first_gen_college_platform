// Actual binder/voice components, scoped handlers and isolated PostgreSQL.
// Authentication, provider transport and played audio are synthetic.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {mkdir,writeFile}=require('node:fs/promises'),{existsSync}=require('node:fs');
process.env.ORIGEN_PREVIEW_URL||='http://127.0.0.1:5187';
const {setup,openBinder,studentId}=require('./student-memory-smoke.cjs');
const {userTurn,tool}=require('./review-request-release-smoke.cjs');
const {installSyntheticPlayback}=require('./synthetic-voice-playback.cjs');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5187',output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-recommendation-acceptance-browser';
assert.equal(new URL(origin).hostname,'127.0.0.1');assert.ok(process.env.DATABASE_TEST_URL);
(async()=>{
 const {actionLibraryFixture}=await import('../server/fixtures/recommendation-library.mjs'),{createRecommendationDeliveryHandler}=await import('../server/recommendation-delivery.mjs'),{createPlanHandler,createPlanRepository,validatePlan}=await import('../server/plans.mjs'),{createProfileVoiceHandler}=await import('../server/profile-voice.mjs'),{createLiveMemoryHandler}=await import('../server/live-memory.mjs'),{personalizationPolicy}=await import('../server/personalization-controls.mjs');
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']}),journeys=[];
 async function routeHandler(page,f,path,handler,after=()=>{}){await page.route('**/api/'+path,async route=>{
  const input=route.request().postDataJSON(),req=Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/'+path,method:'POST',headers:{...route.request().headers(),origin,host:new URL(origin).host,'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});let status,body;
  await f.as('other',()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail('unhandled endpoint '+path)));
  if(await after(input,body,status))return route.abort('failed');return route.fulfill({status,json:body});
 });}
 try{
 for(const width of [1280,390,320])for(const language of ['en','es']){
  const cleanup=[],f=await actionLibraryFixture({after:fn=>cleanup.push(fn)});await f.grant();const row=await f.create();await f.publish(row.id,1);
  const page=await browser.newPage({viewport:{width,height:900},timezoneId:'America/Chicago',reducedMotion:'reduce'}),errors=[],t=(en,es)=>language==='es'?es:en;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());let drop=false,confirms=0;
  try{
   await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
    if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"export function useAuth0(){return {user:{sub:'other'},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:'other'}))+'.test',isAuthenticated:true,isLoading:false}}"});
    if(url.pathname.startsWith('/api/')){const r=await f.httpRequest('other',url.pathname,route.request().postDataJSON());return route.fulfill({status:r.status,json:r.body});}return route.continue();});
   await routeHandler(page,f,'plans',createPlanHandler(f.db,f.env));await routeHandler(page,f,'recommendations',createRecommendationDeliveryHandler(f.db,f.env),(input,_body,status)=>{if(input.action==='confirm'){confirms++;if(drop&&status===200){drop=false;return true;}}});
   await page.route('**/recommendation-binder-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main style="max-width:900px;margin:auto;padding:12px"><div id="root"></div></main><script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import ActionPlan from '/src/ActionPlan.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/PersonalBinder.css';browserPrivacy.start('other',{fresh:true});setAPITokenProvider(async()=> 'e30.'+btoa(JSON.stringify({sub:'other'}))+'.test');const language=${JSON.stringify(language)},t=(en,es)=>language==='es'?es:en;ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ActionPlan,{studentId:'alex',name:'Alex',role:'student',language,t,seed:null}));</script></body></html>`}));
   await page.goto(origin+'/recommendation-binder-smoke');const widget=page.locator('.recommendation-suggestion');await widget.getByRole('button',{name:t('Help me choose a next step','Ayúdame a elegir un próximo paso'),exact:true}).click();
   await widget.getByRole('button',{name:t('Review a suggestion','Revisar una sugerencia'),exact:true}).click();const accept=()=>widget.getByRole('button',{name:t('Accept and save this step','Aceptar y guardar este paso'),exact:true});await accept().waitFor();assert.equal(await accept().isDisabled(),true);
   await widget.getByText(t('Why this source?','¿Por qué esta fuente?'),{exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${output}/binder-${width}-${language}.png`,fullPage:true});
   await widget.getByRole('checkbox').check();drop=true;await accept().click();await widget.getByRole('button',{name:t('Check saved result','Consultar el guardado'),exact:true}).click();await widget.getByRole('status').filter({hasText:t('Saved privately','Guardado de forma privada')}).waitFor();assert.equal(confirms,1);
   assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_plan_recommendations')).rows[0].n,1);
   await f.admin({action:'revoke',id:row.id,revision:2});await page.getByText(t('The original recommendation is historical or unavailable. Your accepted action remains private and editable.','La recomendación original es histórica o no está disponible. Tu acción aceptada sigue siendo privada y editable.'),{exact:true}).waitFor({state:'attached'});
   const second=await f.create();await f.publish(second.id,1);await widget.getByRole('button',{name:t('Review a suggestion','Revisar una sugerencia'),exact:true}).click();await widget.getByRole('status').filter({hasText:t('There is no new step','No hay un nuevo paso')}).waitFor();
   assert.deepEqual(errors,[]);journeys.push({surface:'binder',width,language,realDatabase:true,explicitApproval:true,lostSave:true,duplicatePrevention:true,revocation:true,noOverflow:true,passed:true});
  }catch(e){await page.screenshot({path:`${output}/binder-${width}-${language}-failure.png`,fullPage:true});console.error({width,language,errors,body:(await page.locator('body').innerText()).slice(-4000)});throw e;}
  finally{await page.unrouteAll({behavior:'wait'});await page.close();for(const close of cleanup)await close();}
 }
 for(const width of [1280,390,320])for(const language of ['en','es'])for(const entry of ['live','realtime']){
  const cleanup=[],f=await actionLibraryFixture({after:fn=>cleanup.push(fn)});await f.grant();const row=await f.create();await f.publish(row.id,1);
  Object.assign(f.env,{OPENAI_API_KEY:'synthetic',OPENAI_MODEL_VOICE:entry==='live'?'gpt-live-1':'gpt-realtime-2.1',ALLOWED_ORIGINS:origin});
  await f.family('other',{action:'save-student',student:{id:studentId,name:'Alex Rivera',stage:'College',interest:'Nursing',gpa:'',color:'peach'}});
  let page;const configs=[],protocol=[],t=(en,es)=>language==='es'?es:en;
  try{
   const voice=createProfileVoiceHandler(f.env,async(_url,options)=>{configs.push(entry==='live'?JSON.parse(options.body).session:JSON.parse(options.body.get('session')));return entry==='live'?Response.json({transport:{sdp:'v=0\r\n'},session:{id:'synthetic-live'}}):new Response('v=0\r\n');},()=>{},f.db);
   const ui=await setup(browser,{width,language,configurePage:async p=>{page=p;await installSyntheticPlayback(p);
    await routeHandler(p,f,'profile-voice',voice,(_input,body)=>{if(body.sdp)protocol.push(body);});
    for(const [path,handler] of [['live-memory',createLiveMemoryHandler(f.db,f.env)],['plans',createPlanHandler(f.db,f.env)],['recommendations',createRecommendationDeliveryHandler(f.db,f.env)],['recommendation-voice',createRecommendationDeliveryHandler(f.db,f.env)]])await routeHandler(p,f,path,handler);
    for(const path of ['recommendation-evaluation','coordinator-connections','coordinator-notifications','review-response-context','review-response-choices','review-requests','student-follow-up','student-follow-up-report','student-follow-up-voice','conversation-opening'])await p.route('**/api/'+path,async route=>{const r=await f.httpRequest('other','/api/'+path,route.request().postDataJSON());await route.fulfill({status:r.status,json:r.body});});
    await p.route('**/api/student-memory',async route=>{const b=route.request().postDataJSON(),r=await f.memory({...b,action:b.action==='sync'?'load':b.action},'other');await route.fulfill({json:{...r,pendingCount:0,memoryPolicy:personalizationPolicy(f.env,'other')}});});
    await p.route('**/api/topic-notes',async route=>route.fulfill({json:{...await f.note(route.request().postDataJSON(),'other'),pendingCount:0}}));
   }});page=ui.page;await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');if(entry==='live')await page.evaluate(()=>window.emit({type:'session.started'}));
   assert.equal(protocol.at(-1).recommendationVoice,true);assert.ok((configs.at(-1).delegation?.responses.tools||configs.at(-1).tools).some(t=>t.name==='suggest_next_action'));
   await userTurn(page,entry,'choose-step',t('What next step should I take to contact the office?','¿Qué próximo paso puedo tomar para contactar a la oficina?'));const suggestion=await tool(page,entry,'suggest-step','suggest_next_action',{});assert.equal(suggestion.status,'recommended');
   await userTurn(page,entry,'save-step',t('Save this step.','Guarda este paso.'));const prepared=await tool(page,entry,'prepare-step','prepare_recommendation_action',{});assert.equal(prepared.status,'readback_required');
   const presented=page.waitForResponse(r=>r.url().endsWith('/api/recommendation-voice')&&r.request().postDataJSON()?.action==='present'&&r.request().postDataJSON()?.presentation===prepared.readback);
   await page.evaluate(({entry,text})=>{if(entry==='live'){window.syntheticAudioUntil=Date.now()+500;window.emit({type:'session.output_transcript.delta',delta:text});}else{const id=crypto.randomUUID();window.emit({type:'response.created',response:{id}});window.emit({type:'output_audio_buffer.started',response_id:id});window.emit({type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});window.emit({type:'response.done',response:{id,status:'completed',output:[]}});window.emit({type:'output_audio_buffer.stopped',response_id:id});}},{entry,text:prepared.readback});assert.equal((await (await presented).json()).status,'observed');
   await userTurn(page,entry,'approve-step',t('Yes, save it.','Sí, guárdalo.'));const count=await page.evaluate(()=>window.connections.length),saved=page.waitForResponse(r=>r.url().endsWith('/api/recommendation-voice')&&r.request().postDataJSON()?.action==='confirm');await tool(page,entry,'confirm-step','confirm_recommendation_action',{},false);assert.equal((await (await saved).json()).status,'saved');
   await page.waitForFunction(count=>window.connections.length>count&&window.connections.at(-1).connectionState==='connected',count);assert.equal(protocol.at(-1).openingClaim,undefined);
   const plans=await f.as('other',()=>createPlanRepository(f.db,f.env)('other',validatePlan({action:'load',studentId})));assert.equal(plans.plans.length,1);assert.equal(plans.plans[0].steps[0].action,suggestion.action);assert.ok(plans.plans[0].steps[0].recommendationSource);
   assert.deepEqual(ui.state.errors,[]);journeys.push({surface:'voice',width,language,provider:entry,realDatabase:true,syntheticAudio:true,explicitApproval:true,canonicalSave:true,noNewOpening:true,passed:true});
  }catch(e){if(page)await page.screenshot({path:`${output}/voice-${width}-${language}-${entry}-failure.png`,fullPage:true});console.error({width,language,entry,protocol});throw e;}
  finally{if(page){await page.unrouteAll({behavior:'wait'});await page.close();}for(const close of cleanup)await close();}
 }
 }finally{await browser.close();}
 const result={kind:'recommendation-acceptance-browser-verification',version:1,realDatabase:true,liveProviders:false,passed:journeys.length===18,journeys};await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,journeys:journeys.length,output}));
})().catch(e=>{console.error(e);process.exitCode=1;});
