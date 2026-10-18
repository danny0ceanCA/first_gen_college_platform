// Synthetic accounts, mocked WebRTC/research, and a real local API gateway.
// No production records, microphone, or paid model calls are used.
const {createRequire}=require('node:module');
const {createServer}=require('node:http');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const assert=require('node:assert/strict');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));
let scenarios=0;

async function gateway(subject){
 const [{fixture},{createPermissionRepository},{createApp}]=await Promise.all([
  import('../server/family-fixture.mjs'),import('../server/guardian-permission.mjs'),import('../server/index.mjs'),
 ]);
 const {pool,run}=await fixture();
 await createPermissionRepository(pool).account(subject,{action:'screen',ageBand:'18plus',audience:'grade9plus'});
 await run(subject,{action:'complete-onboarding',account:{firstName:'Alex',email:'',role:'student'}});
 const server=createServer(createApp({ALLOWED_ORIGINS:origin},async()=>({sub:subject}),pool,()=>{}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();}};
}

async function setup(browser,{width,language,actualGateway=false,audioBlocked=false}){
 const subject=`synthetic-voice-${width}-${language}`,api=actualGateway?await gateway(subject):null;
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
 page.setDefaultTimeout(12000);
 const state={errors:[],requests:[],statuses:[]};page.on('pageerror',e=>state.errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(url.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:url.pathname,body});
   if(api&&['/api/eligibility','/api/voice-diagnostics'].includes(url.pathname)){
    const response=await fetch(api.url+url.pathname,{method:'POST',headers:{origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
    state.statuses.push({path:url.pathname,status:response.status});
    return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'}).catch(()=>{});
   }
   if(url.pathname==='/api/eligibility')return route.fulfill({json:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   if(url.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(url.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',email:'',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:'student-review',name:'Alex',stage:'Community college',interest:'Nursing',gpa:'',color:'lilac'}]}});
   if(url.pathname==='/api/profile-voice')return route.fulfill({json:body.action==='update-guide'?{session:{type:'realtime',instructions:'Continue planning',tools:[],tool_choice:'auto'}}:{sdp:'v=0\r\n',playWelcome:false}});
   return route.fulfill({json:{ok:true,items:[],summary:'Synthetic summary',plans:[]}});
  }
  if(url.origin===origin||['data:','blob:','about:'].includes(url.protocol))return route.continue();
  return route.fulfill({status:200,contentType:'text/plain',body:''});
 });
 await page.addInitScript(({language,audioBlocked})=>{
  localStorage.setItem('origen.language',language);
  window.sent=[];window.connections=[];window.researchRequests=0;window.allowAudio=!audioBlocked;
  window.mediaPlays=0;
  const nativeFetch=window.fetch;
  window.fetch=async(...args)=>{
   if(String(args[0]).match(/\/api\/(finance|admissions)-research/)){
    window.researchRequests++;
    const value={text:'Synthetic verified evidence',sources:[{title:'Synthetic official source',url:'https://example.edu/',checkedAt:'2026-10-18T00:00:00Z'}]};
    // Deliberately ignore AbortSignal to exercise late dependency completion.
    if(window.researchBehavior==='body')return new Response(new ReadableStream({start(controller){window.releaseResearch=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();};}}),{headers:{'Content-Type':'application/json'}});
    if(window.researchBehavior!=='success')return new Promise(r=>window.releaseResearch=()=>r(new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})));
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
   }
   return nativeFetch(...args);
  };
  const track={enabled:true,stop(){}};
  navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]});
  Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{configurable:true,get(){return this._stream;},set(value){this._stream=value;}});
  HTMLMediaElement.prototype.play=function(){window.mediaPlays++;if(!window.allowAudio)return Promise.reject(new DOMException('Autoplay denied','NotAllowedError'));this.dispatchEvent(new Event('playing'));return Promise.resolve();};
  window.RTCPeerConnection=class{
   constructor(){window.connections.push(this);this.connectionState='new';}
   addTrack(){}createDataChannel(){const dc={readyState:'open',send(text){const event=JSON.parse(text);window.sent.push(event);if(event.type==='session.update')queueMicrotask(()=>dc.onmessage({data:JSON.stringify({type:'session.updated',session:event.session})}));},close(){this.readyState='closed';}};this.dc=dc;window.dc=dc;return dc;}
   async createOffer(){return {type:'offer',sdp:'v=0\r\n'};}async setLocalDescription(){}
   async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.dc.onopen?.();this.dc.onmessage({data:JSON.stringify({type:'session.created',session:{instructions:'Continue'}})});this.ontrack?.({streams:[{}]});}
   close(){this.connectionState='closed';}
  };
  window.emit=event=>window.dc.onmessage({data:JSON.stringify(event)});
 },{language,audioBlocked});
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.voice-ready').waitFor();
 await page.locator('.voice-ready button').first().click();await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'));
 const emit=event=>page.evaluate(event=>window.emit(event),event);
 await emit({type:'response.created',response:{id:'opening'}});
 await emit({type:'response.done',response:{id:'opening',status:'completed',output:[]}});
 return {page,state,emit,close:async()=>{await page.close();await api?.close();}};
}

async function question(emit,id,text){
 await emit({type:'input_audio_buffer.speech_started',item_id:id});
 await emit({type:'input_audio_buffer.speech_stopped',item_id:id});
 await emit({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
}
async function lookup(page,emit,{two=false}={}){
 await emit({type:'response.created',response:{id:'lookup'}});
 await page.evaluate(two=>{void window.emit({type:'response.done',response:{id:'lookup',status:'completed',output:Array.from({length:two?2:1},(_,i)=>({type:'function_call',name:'lookup_financial_aid',call_id:'research-'+i,arguments:JSON.stringify({question:'What is a Pell Grant?',institution:''})}))}});},two);
 await page.waitForFunction(()=>window.researchRequests===1);
 await page.locator('.voice-research-cancel').waitFor();
}
async function recovered(page,error){
 await page.waitForFunction(error=>window.sent.some(e=>e.item?.type==='function_call_output'&&JSON.parse(e.item.output).error===error),error);
 await page.waitForFunction(()=>window.sent.filter(e=>e.type==='response.create'&&!e.response).length===2);
 assert.equal(await page.locator('.voice-research-cancel').count(),0);
 assert.equal(await page.evaluate(()=>window.connections[0].connectionState),'connected');
}
async function noLateEvidence(page){
 await page.evaluate(()=>window.releaseResearch?.());
 await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
 assert.equal(await page.locator('.voice-sources').count(),0);
 assert.equal(await page.evaluate(()=>window.sent.filter(e=>e.item?.type==='function_call_output'&&JSON.parse(e.item.output).status==='source_check_completed').length),0);
 assert.equal(await page.evaluate(()=>window.sent.filter(e=>e.type==='response.create'&&!e.response).length),2);
}

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ORIGEN_BROWSER_EXECUTABLE?{executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1280,390])for(const language of ['en','es']){
  {
   const h=await setup(browser,{width,language,audioBlocked:true});const {page,state}=h;
   try{
    const play=page.getByRole('button',{name:language==='en'?'Play Origen audio':'Reproducir audio de Origen',exact:true});
    await play.waitFor();const rect=await play.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=900);
    await play.click();assert.equal(await play.isVisible(),true,'a failed retry remains actionable');
    await page.locator('.voice-expand').click();assert.equal(await play.isVisible(),true);
    await page.evaluate(()=>window.allowAudio=true);await play.focus();await page.keyboard.press('Enter');
    await play.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.connections.length),1);
    assert.deepEqual(state.errors,[]);scenarios++;console.log(`PASS ${width}/${language}: visible keyboard audio recovery and retry.`);
   }finally{await h.close();}
  }
  for(const behavior of ['fetch','body']){
   const h=await setup(browser,{width,language});const {page,emit,state}=h;
   try{
    await page.clock.install();await page.evaluate(b=>window.researchBehavior=b,behavior);await lookup(page,emit);
    await page.clock.fastForward(11000);
    // A provider status response can itself be delayed. It must not lock recovery.
    await page.clock.fastForward(35000);await recovered(page,'lookup_timeout');await noLateEvidence(page);
    const metadata=await page.evaluate(()=>window.sent.find(e=>e.response?.metadata?.topic==='origen_lookup_progress')?.response.metadata);
    if(metadata){await emit({type:'response.created',response:{id:'late-progress',metadata}});await emit({type:'response.done',response:{id:'late-progress',status:'completed',metadata,output:[]}});}
    assert.equal(await page.evaluate(()=>window.sent.filter(e=>e.type==='response.create'&&!e.response).length),2);
    assert.deepEqual(state.errors,[]);scenarios++;console.log(`PASS ${width}/${language}: ${behavior} deadline, late evidence and late progress recovery.`);
   }finally{await h.close();}
  }
  for(const cancellation of ['button','speech']){
   const h=await setup(browser,{width,language});const {page,emit,state}=h;
   try{
    await lookup(page,emit,{two:true});
    // Empty transcripts must leave the useful lookup running.
    await question(emit,'noise','');assert.equal(await page.locator('.voice-research-cancel').isVisible(),true);
    if(cancellation==='button')await page.getByRole('button',{name:language==='en'?'Cancel search':'Cancelar búsqueda',exact:true}).click();
    else await question(emit,'new-question',language==='en'?'Never mind the search. What is a college major?':'Cancela la búsqueda. ¿Qué es una carrera universitaria?');
    await recovered(page,'lookup_cancelled');await noLateEvidence(page);
    assert.equal(await page.evaluate(()=>window.researchRequests),1,'queued old tools must not start');
    assert.equal(await page.evaluate(()=>window.sent.filter(e=>e.item?.type==='function_call_output').length),2,'each tool receives one terminal result');
    assert.deepEqual(state.errors,[]);scenarios++;console.log(`PASS ${width}/${language}: ${cancellation} cancellation, noise, queued tools and continued connection.`);
   }finally{await h.close();}
  }
  {
   const h=await setup(browser,{width,language,actualGateway:true});const {page,emit,state}=h;
   try{
    await page.clock.install();
    for(let i=0;i<28;i++){
     await question(emit,'question-'+i,language==='en'?'What should I do next?':'¿Qué hago ahora?');
     await emit({type:'response.created',response:{id:'answer-'+i}});
     await emit({type:'output_audio_buffer.started',response_id:'answer-'+i});
     await emit({type:'response.output_audio_transcript.done',transcript:language==='en'?'Here is one useful next step.':'Este es un próximo paso útil.'});
     await emit({type:'response.done',response:{id:'answer-'+i,status:'completed',output:[]}});
     await emit({type:'output_audio_buffer.stopped',response_id:'answer-'+i});
     await page.clock.fastForward(1000);
    }
    const eligibilityBefore=state.statuses.filter(r=>r.path==='/api/eligibility').length;
    const checked=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/eligibility');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await checked;
    assert.ok(state.statuses.filter(r=>r.path==='/api/eligibility').length>eligibilityBefore);
    assert.ok(state.statuses.some(r=>r.path==='/api/voice-diagnostics'&&r.status===429),'diagnostic budget remains enforced');
    assert.ok(state.statuses.filter(r=>r.path==='/api/eligibility').every(r=>r.status===200));
    assert.equal(await page.evaluate(()=>window.connections[0].connectionState),'connected');
    assert.equal(await page.locator('.voice-end').isVisible(),true);assert.deepEqual(state.errors,[]);
    scenarios++;console.log(`PASS ${width}/${language}: 28 turns, bounded diagnostics and permission checks through actual local gateway.`);
   }finally{await h.close();}
  }
 }
  {
   const h=await setup(browser,{width:1280,language:'en'});
   try{
    const result=await h.page.evaluate(async()=>{
     const {apiFetch,setAPITokenProvider}=await import('/src/api.ts');
     const {voiceResearchRequest}=await import('/src/voiceResearchRequest.mjs');
     let release;const token=new Promise(resolve=>release=resolve);
     setAPITokenProvider(()=>token);
     const task=voiceResearchRequest({timeoutMs:20});
     let reason;
     try{await task.run(signal=>apiFetch('/api/finance-research',{method:'POST',signal}));}catch(error){reason=error.name;}
     release('synthetic');await new Promise(r=>setTimeout(r,0));
     setAPITokenProvider(async()=> 'synthetic');
     return {reason,researchRequests:window.researchRequests,connection:window.connections[0].connectionState};
    });
    assert.deepEqual(result,{reason:'TimeoutError',researchRequests:0,connection:'connected'});
    assert.deepEqual(h.state.errors,[]);scenarios++;console.log('PASS authentication: actual apiFetch stops after a stalled token resolves late.');
   }finally{await h.close();}
  }
 }finally{await browser.close();}
 assert.equal(scenarios,25);console.log('All 25 voice reliability browser scenarios passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
