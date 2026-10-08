const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
// Synthetic browser coverage: no real microphone, credentials or production API writes.
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.ORIGEN_BROWSER_CHANNEL?{channel:process.env.ORIGEN_BROWSER_CHANNEL}:{})});try{
for(const width of [1280,390])for(const saveMethod of ['voice','button']){
const page=await browser.newPage({viewport:{width,height:900},reducedMotion:process.env.ORIGEN_REDUCED_MOTION||'no-preference'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
let family={account:{firstName:'',email:''},students:[]},writes=0,calls=0,updates=0;
await page.route('**/@auth0_auth0-react.js*',r=>r.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:{isLoading:false,isAuthenticated:true,user:{sub:'synthetic-voice'},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:'synthetic-voice'}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}}},children)}export function useAuth0(){return React.useContext(Auth0Context)}`}));
await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname,body=r.request().postDataJSON()||{};
if(path==='/api/institutions')return r.fulfill({json:{memberships:[],hasPersonalAccount:false}});
if(path==='/api/admin')return r.fulfill({status:403,json:{error:'admin_required'}});
if(path==='/api/family'){if(body.action==='complete-onboarding'){writes++;family={account:body.account,students:[body.student]};}return r.fulfill({json:family});}
if(path==='/api/profile-voice'){if(body.action==='update-guide'){updates++;return r.fulfill({json:{session:{type:'realtime',instructions:'Continue '+body.mode,tools:[],tool_choice:'auto'}}});}calls++;return r.fulfill({json:{sdp:'v=0\r\n',playWelcome:true}});}
return r.fulfill({json:{items:[],summary:'Synthetic summary',plans:[]}});
});
await page.addInitScript(()=>{
window.sent=[];window.connections=[];
const track={enabled:true,stop(){}};navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]});
window.RTCPeerConnection=class{
constructor(){window.connections.push(this);this.connectionState='new';}
addTrack(){} createDataChannel(){const dc={readyState:'open',send(text){const e=JSON.parse(text);window.sent.push(e);if(e.type==='session.update')queueMicrotask(()=>dc.onmessage({data:JSON.stringify({type:'session.updated',session:e.session})}));},close(){this.readyState='closed';}};this.dc=dc;window.dc=dc;return dc;}
async createOffer(){return {type:'offer',sdp:'v=0\r\n'};}async setLocalDescription(){}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.dc.onopen?.();this.dc.onmessage({data:JSON.stringify({type:'session.created',session:{instructions:'Welcome'}})});}close(){this.connectionState='closed';}
};window.emit=e=>window.dc.onmessage({data:JSON.stringify(e)});
});
await page.goto((process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5176/')+'#app');await page.locator('.welcome-conversation').waitFor().catch(async error=>{console.error(await page.locator('body').innerText(),errors,page.url());throw error;});
await page.getByRole('button',{name:/Start live conversation/}).click();
await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'));
const opening=await page.evaluate(()=>window.sent.find(e=>e.type==='response.create').response.instructions);
assert.match(opening,/focus on profile setup/);assert.doesNotMatch(opening,/Family home keeps/);
const emit=e=>page.evaluate(e=>window.emit(e),e);
await emit({type:'response.created',response:{id:'intro'}});
await emit({type:'response.done',response:{id:'intro',status:'completed',output:[
{type:'function_call',name:'propose_account',call_id:'account',arguments:JSON.stringify({firstName:'Test',role:'parent'})},
{type:'function_call',name:'propose_profile',call_id:'profile',arguments:JSON.stringify({changes:[{field:'name',value:'Student'}]})},
...(saveMethod==='voice'?[{type:'function_call',name:'save_onboarding_profile',call_id:'save',arguments:'{"requested_by_user":true}'}]:[])]}});
if(saveMethod==='voice'){
assert.equal(writes,1);assert.equal(await page.locator('.welcome-conversation').count(),1);
await emit({type:'response.created',response:{id:'confirmation'}});await emit({type:'output_audio_buffer.started',response_id:'confirmation'});
await emit({type:'response.done',response:{id:'confirmation',status:'completed',output:[{type:'message',content:[{type:'audio',transcript:'Saved. Opening home.'}]}]}});
assert.equal(await page.locator('.welcome-conversation').count(),1,'must wait for playback');
await emit({type:'output_audio_buffer.stopped',response_id:'confirmation'});await page.locator('.app-shell').waitFor();
}else{
await emit({type:'response.created',response:{id:'draft-ready'}});await emit({type:'response.done',response:{id:'draft-ready',status:'completed',output:[]}});
await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.locator('.app-shell').waitFor();assert.equal(writes,1);
}
await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'&&e.response?.instructions?.includes('home page is now open')));
assert.equal(await page.locator('.app-shell').evaluate(node=>getComputedStyle(node).opacity),'1','home introduction waits until the page reveal finishes');
assert.equal(calls,1,'saving and opening home must keep the same call');assert.equal(updates,1);
assert.equal(await page.evaluate(()=>window.connections.length),1);
assert.equal(await page.evaluate(()=>window.connections[0].connectionState),'connected');
const intro=await page.evaluate(()=>window.sent.find(e=>e.response?.instructions?.includes('home page is now open')).response.instructions);
assert.match(intro,/Talk button on the bar at the bottom/);
await emit({type:'response.created',response:{id:'home-intro'}});
await emit({type:'response.done',response:{id:'home-intro',status:'completed',output:[]}});
await page.evaluate(()=>{window.originalAudio=document.querySelector('.shared-voice audio');window.originalAudio.volume=.65;});
await emit({type:'response.created',response:{id:'topic'}});await emit({type:'output_audio_buffer.started',response_id:'topic'});
const before=await page.evaluate(()=>window.sent.filter(e=>e.type==='response.create').length);
await emit({type:'response.done',response:{id:'topic',status:'completed',output:[{type:'function_call',name:'switch_college_guide',call_id:'topic-call',arguments:'{"guide":"finance"}'}]}});
assert.equal(calls,1);assert.equal(updates,2);assert.equal(await page.evaluate(()=>window.sent.filter(e=>e.type==='response.create').length),before);
assert.equal(await page.evaluate(()=>document.querySelector('.shared-voice audio')===window.originalAudio&&window.originalAudio.volume===.65),true);
await emit({type:'output_audio_buffer.stopped',response_id:'topic'});
assert.equal(await page.evaluate(()=>window.sent.filter(e=>e.type==='response.create').length),before+1);
assert.deepEqual(errors,[]);console.log(JSON.stringify({width,saveMethod,saveConfirmation:'passed',initialScope:'same connection',topic:'same player and volume',errors}));await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
