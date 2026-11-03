// Actual voice UI with synthetic accounts and simulated WebRTC events.
// No production records, microphone, or paid model calls are used.
const {createRequire}=require('node:module');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const assert=require('node:assert/strict');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname));

async function setup(browser,{width,language,audioBlocked=false,reducedMotion='no-preference'}){
 const subject=`synthetic-voice-${width}-${language}`;
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion});
 page.setDefaultTimeout(12000);
 const state={errors:[],requests:[],statuses:[]};page.on('pageerror',e=>{state.errors.push(e.message);console.error(e.message)});page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))console.error(m.text())});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(url.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:url.pathname,body});
   if(url.pathname==='/api/eligibility')return route.fulfill({json:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   if(url.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(url.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',email:'',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:'student-review',name:'Alex',stage:'Community college',interest:'Nursing',gpa:'',color:'lilac'}]}});
   if(url.pathname==='/api/profile-voice')return route.fulfill({json:body.action==='update-guide'?{session:{type:'realtime',instructions:'Continue planning',tools:[],tool_choice:'auto'}}:{sdp:'v=0\r\n',playWelcome:false}});
   return route.fulfill({json:{ok:true,enabled:false,available:false,items:[],entries:[],notes:[],connections:[],grants:[],requests:[],activity:[],notifications:[],feedback:[],summary:'Synthetic summary',plans:[]}});
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
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.voice-ready').waitFor().catch(async e=>{console.error((await page.locator('body').innerText()).slice(0,1200));throw e});
 await page.screenshot({path:`output/playwright/voice-presence/${width}-ready.png`});await page.locator('.voice-ready .voice-start-label').click();await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'));
 const opening=state.requests.find(request=>request.path==='/api/profile-voice'&&!request.body.action)?.body;
 assert.equal(opening?.studentId,'student-review','The first call must carry the saved student scope');
 assert.equal(opening?.scopeRestart,false,'A new call is not a mid-conversation scope reconnection');
 assert.equal(opening?.profile.name,'Alex','The first call must retain the saved profile');
 const emit=event=>page.evaluate(event=>window.emit(event),event);
 await emit({type:'response.created',response:{id:'opening'}});
 await emit({type:'response.done',response:{id:'opening',status:'completed',output:[]}});
 return {page,state,emit,close:async()=>{await page.close();}};
}

(async()=>{
 await require('node:fs/promises').mkdir('output/playwright/voice-presence',{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const [width,language,reducedMotion] of [[1366,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const h=await setup(browser,{width,language,reducedMotion});
  try{
   const {page,emit}=h;const heights=[];
   async function check(state){
    await page.locator(`.voice-presence[data-state="${state}"]`).waitFor();
    heights.push(await page.locator('.shared-voice.compact').evaluate(el=>el.getBoundingClientRect().height));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Voice dock caused horizontal overflow');
    const rect=await page.locator('.shared-voice.compact').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);const surface=await page.locator('.main-shell').boundingBox();assert.ok(Math.abs(rect.x-surface.x)<1&&Math.abs(rect.width-surface.width)<1,`Dock must span the content edge to edge: ${JSON.stringify({rect,surface,root:await page.evaluate(()=>({width:document.documentElement.clientWidth,inner:innerWidth,vars:document.querySelector('.shared-voice-dock').style.cssText}))})}`);
    await page.screenshot({path:`output/playwright/voice-presence/${width}-${state}.png`});
   }
   await check('listening');
   await emit({type:'input_audio_buffer.speech_started',item_id:'visual-turn'});await check('user-speaking');
   const animation=await page.locator('.presence-orbit').evaluate(el=>getComputedStyle(el).animationName);
   assert.equal(animation,reducedMotion==='reduce'?'none':'presence-orbit');
   await emit({type:'input_audio_buffer.speech_stopped',item_id:'visual-turn'});await check('thinking');
   await emit({type:'conversation.item.input_audio_transcription.completed',item_id:'visual-turn',transcript:language==='es'?'Quiero hablar de transferencias.':'I want to discuss transfer planning.'});
   await emit({type:'response.created',response:{id:'visual-answer'}});
   await emit({type:'output_audio_buffer.started'});await check('speaking');
   await emit({type:'response.done',response:{id:'visual-answer',status:'completed',output:[]}});
   await emit({type:'output_audio_buffer.stopped'});await check('listening');
   await page.locator('.voice-mute').click();await check('muted');
   await emit({type:'input_audio_buffer.speech_started',item_id:'muted-stale'});await check('muted');
   assert.ok(Math.max(...heights)-Math.min(...heights)<2,`Dock resized across voice states: ${heights}`);
   assert.deepEqual(h.state.errors,[]);
   console.log(JSON.stringify({width,language,reducedMotion,heights,animation,errors:h.state.errors}));
  }finally{await h.close()}
 }}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
