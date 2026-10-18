// Synthetic accounts, API responses and WebRTC only. No paid AI or production writes.
const {createRequire}=require('node:module');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const assert=require('node:assert/strict');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Run this smoke check against a local development server.');
const subject='synthetic-onboarding-review';
let scenarios=0;
async function setup(browser,{voice=false,width=1280}={}){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(12000);
 const state={family:{account:{firstName:'',email:''},students:[]},writes:[],requests:[],failEligibility:false,denied:false,hangSave:false,release:null,errors:[]};
 page.on('pageerror',e=>state.errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(u.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:u.pathname,action:body.action});
   if(u.pathname==='/api/eligibility'){
    if(state.failEligibility){state.failEligibility=false;return route.fulfill({status:503,json:{error:'permission_unavailable'}});}
    return route.fulfill({json:{subject,allowed:!state.denied,status:state.denied?'revoked':'adult',ageBand:'18plus'}});
   }
   if(u.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(u.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   if(u.pathname==='/api/family'){
    if(body.action==='complete-onboarding'){
     state.writes.push(structuredClone(body));
     if(state.hangSave)await new Promise(resolve=>state.release=resolve);
     state.family={account:body.account,students:body.student?[body.student]:[]};
    }
    return route.fulfill({json:state.family}).catch(()=>{});
   }
   if(u.pathname==='/api/profile-voice')return route.fulfill({json:body.action==='update-guide'?{session:{type:'realtime',instructions:'Continue planning',tools:[],tool_choice:'auto'}}:{sdp:'v=0\r\n',playWelcome:true}});
   return route.fulfill({json:{ok:true,items:[],summary:'Synthetic summary',plans:[]}});
  }
  if(u.origin===origin||['data:','blob:','about:'].includes(u.protocol))return route.continue();
  return route.fulfill({status:200,contentType:u.hostname.startsWith('fonts.')?'text/css':'application/json',body:u.hostname.startsWith('fonts.')?'':'{}'});
 });
 if(voice)await page.addInitScript(()=>{
  window.sent=[];window.connections=[];
  const track={enabled:true,stop(){}};navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]});
  window.RTCPeerConnection=class{
   constructor(){window.connections.push(this);this.connectionState='new';}
   addTrack(){}createDataChannel(){const dc={readyState:'open',send(text){const event=JSON.parse(text);window.sent.push(event);if(event.type==='session.update')queueMicrotask(()=>dc.onmessage({data:JSON.stringify({type:'session.updated',session:event.session})}));},close(){this.readyState='closed';}};this.dc=dc;window.dc=dc;return dc;}
   async createOffer(){return {type:'offer',sdp:'v=0\r\n'};}async setLocalDescription(){}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.dc.onopen?.();this.dc.onmessage({data:JSON.stringify({type:'session.created',session:{instructions:'Welcome'}})});}close(){this.connectionState='closed';}
  };window.emit=async event=>window.dc.onmessage({data:JSON.stringify(event)});
 });
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.welcome-conversation').waitFor({state:'visible'});
 return {page,state};
}
async function manual(page){
 await page.getByRole('button',{name:'Edit details',exact:true}).click();
 await page.getByRole('button',{name:'Edit my name or role',exact:true}).click();
 await page.getByLabel('Your first name',{exact:true}).fill('Alex');
 await page.getByLabel('I am a student',{exact:true}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Enter details myself',exact:true}).click();
 await page.getByLabel('Your name',{exact:true}).fill('Alex');
 await page.getByLabel(/^Goals/).fill('Study nursing');
}

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ORIGEN_BROWSER_EXECUTABLE?{executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1280,390]){
  // A transient permission failure must block activity without losing the draft.
  {
   const {page,state}=await setup(browser,{width});
   try{
    await manual(page);
    await page.waitForFunction(subject=>sessionStorage.getItem(`origen.onboarding.${subject}.v1`)?.includes('Study nursing'),subject);
    state.failEligibility=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').filter({hasText:'We could not confirm permission'}).waitFor();
    assert.equal(await page.locator('.welcome-panel,.welcome-conversation').count(),0,'onboarding must be gated while verification is unavailable');
    assert.ok(await page.evaluate(subject=>sessionStorage.getItem(`origen.onboarding.${subject}.v1`)?.includes('Study nursing'),subject));
    await page.getByRole('button',{name:'Check status',exact:true}).click();
    await page.locator('.welcome-conversation').waitFor();
    const restored=await page.locator('.welcome-live-notes').innerText();
    assert.match(restored,/Alex/);assert.match(restored,/Study nursing/);
    // A confirmed revocation must still purge the recovered private draft.
    state.denied=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('status').filter({hasText:'This account cannot continue'}).waitFor();
    assert.equal(await page.evaluate(subject=>sessionStorage.getItem(`origen.onboarding.${subject}.v1`),subject),null);
    assert.deepEqual(state.errors,[]);scenarios++;console.log(`PASS ${width}px: transient failure preserves draft; confirmed revocation purges it.`);
   }finally{await page.close();}
  }
  // A lost save response must unlock the preserved form and allow an idempotent retry.
  {
   const {page,state}=await setup(browser,{width});
   try{
    await manual(page);state.hangSave=true;
    await page.getByRole('button',{name:'Save profile',exact:true}).click();
    await page.getByRole('button',{name:'Saving…',exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'Could not save'}).waitFor({timeout:15000});
    assert.equal(await page.getByRole('button',{name:'Save profile',exact:true}).isEnabled(),true);
    assert.equal(await page.getByLabel(/^Goals/).inputValue(),'Study nursing');
    // The first server write may finish even though its response was lost.
    state.hangSave=false;state.release();
    await page.getByRole('button',{name:'Save profile',exact:true}).click();
    await page.locator('.app-shell').waitFor();
    assert.equal(state.writes.length,2);assert.equal(state.writes[0].student.id,state.writes[1].student.id);
    assert.equal(state.family.students.length,1);assert.equal(state.family.students[0].goals,'Study nursing');
    assert.deepEqual(state.errors,[]);scenarios++;console.log(`PASS ${width}px: stalled save times out, retains details, and retries the same profile.`);
   }finally{state.release?.();await page.close();}
  }
  // A final spoken correction must settle before Save becomes available.
  {
   const {page,state}=await setup(browser,{width,voice:true});
   try{
    await page.getByRole('button',{name:'Talk with Origen',exact:true}).click();
    await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'));
    const emit=e=>page.evaluate(async e=>window.emit(e),e);
    await emit({type:'response.created',response:{id:'initial'}});
    await emit({type:'response.done',response:{id:'initial',status:'completed',output:[{type:'function_call',name:'propose_account',call_id:'account',arguments:JSON.stringify({firstName:'Alex',role:'student'})},{type:'function_call',name:'propose_profile',call_id:'profile',arguments:JSON.stringify({changes:[{field:'name',value:'Alex'},{field:'goals',value:'Study biology'}]})}]}});
    await emit({type:'response.created',response:{id:'initial-ack'}});
    await emit({type:'response.done',response:{id:'initial-ack',status:'completed',output:[]}});
    await page.getByRole('heading',{name:'Welcome, Alex.',exact:true}).waitFor();
    await emit({type:'input_audio_buffer.speech_started',item_id:'correction'});
    assert.equal(await page.getByRole('button',{name:'Save profile',exact:true}).isDisabled(),true);
    await emit({type:'input_audio_buffer.speech_stopped',item_id:'correction'});
    await emit({type:'conversation.item.input_audio_transcription.completed',item_id:'correction',transcript:'Actually, I want to study nursing instead of biology.'});
    await emit({type:'response.created',response:{id:'correction-response'}});
    assert.equal(await page.getByRole('button',{name:'Save profile',exact:true}).isDisabled(),true);
    assert.equal(state.writes.length,0);
    await emit({type:'response.done',response:{id:'correction-response',status:'completed',output:[{type:'function_call',name:'propose_profile',call_id:'last-goals',arguments:JSON.stringify({changes:[{field:'goals',value:'Study nursing'}]})}]}});
    assert.equal(await page.getByRole('button',{name:'Save profile',exact:true}).isDisabled(),true,'wait through the tool follow-up');
    await emit({type:'response.created',response:{id:'correction-ack'}});
    await emit({type:'output_audio_buffer.started',response_id:'correction-ack'});
    await emit({type:'response.done',response:{id:'correction-ack',status:'completed',output:[]}});
    assert.equal(await page.getByRole('button',{name:'Save profile',exact:true}).isDisabled(),true,'wait for reply playback');
    await emit({type:'output_audio_buffer.stopped',response_id:'correction-ack'});
    await page.getByRole('button',{name:'Save profile',exact:true}).click();
    await page.locator('.app-shell').waitFor();
    assert.equal(state.writes.length,1);assert.equal(state.family.students[0].goals,'Study nursing');
    assert.equal(await page.evaluate(()=>window.connections.length),1,'saving must retain the voice connection');
    assert.equal(await page.evaluate(()=>window.connections[0].connectionState),'connected');
    assert.deepEqual(state.errors,[]);scenarios++;console.log(`PASS ${width}px: final voice correction persists and the live call continues.`);
   }finally{await page.close();}
  }
 }}finally{await browser.close();}
 assert.equal(scenarios,6);console.log('All 6 onboarding recovery scenarios passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
