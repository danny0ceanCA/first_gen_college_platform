// Real browser, synthetic account and intercepted APIs. No production or paid AI requests.
const {createRequire}=require('node:module');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const assert=require('node:assert/strict');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use a local development server.');
const subject='synthetic-binder-review',studentId='binder-student',date='2026-10-01T12:00:00.000Z';
function summary(language){return language==='es'?'Hablamos de estudiar y trabajar.':'We discussed studying while working.';}
async function setup(browser,{width=1280,language='en',reducedMotion='reduce',nativeResearch=false,configurePage}={}){
 const page=await browser.newPage({viewport:{width,height:width===320?568:900},reducedMotion});page.setDefaultTimeout(12000);
 const state={memories:[{id:'memory-one',studentId,category:'constraint',content:language==='es'?'Mi padre informa que trabajo por las tardes.':'My parent reports that I work evenings.',language,status:'proposed',speaker:'parent',reportedBy:'parent',summaryId:'conversation-1',sourceVersion:'a'.repeat(64),quote:'The parent reports that the student works evenings.',version:1,updatedAt:date,conversationAt:date}],revision:1,failSave:false,failSync:true,pending:1,voiceRevisions:[],notes:[],summary:summary(language),writes:[],errors:[],requests:[]};
 page.on('pageerror',error=>state.errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(language=>localStorage.setItem('origen.language',language),language);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(url.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:url.pathname,action:body.action});
   if(url.pathname==='/api/eligibility')return route.fulfill({json:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   if(url.pathname==='/api/conversation-recovery')return route.fulfill({json:body.action==='stop'?{stopped:true}:{enabled:false,items:[]}});
   if(url.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(url.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   // The student home mounts coordinator updates even with no shared binder.
   // Match the list contract; the generic fallback lacks notifications and crashes it.
   if(url.pathname==='/api/coordinator-notifications'){
    assert.equal(body.action,'list','This fixture only supports an empty notification list.');
    return route.fulfill({json:{notifications:[]}});
   }
   if(url.pathname==='/api/coordinator-feedback'){
    assert.equal(body.action,'student-list','This fixture has no coordinator guidance.');
    return route.fulfill({json:{feedback:[],writesEnabled:false}});
   }
   if(url.pathname==='/api/coordinator-connections'){
    assert.ok(['available','list'].includes(body.action),'This fixture has no coordinator connections.');
    return route.fulfill({json:body.action==='available'?{available:false}:{connections:[],sharingEnabled:false}});
   }
   if(url.pathname==='/api/binder-sharing'){
    assert.equal(body.action,'status','This fixture has no shared binder.');
    return route.fulfill({json:{available:false,enabled:false,connections:[],grants:[]}});
   }
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',email:'alex@example.test',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:studentId,name:'Alex Rivera',stage:'High school',interest:'Nursing and community health',gpa:'3.6',color:'peach',goals:'Explore a college path that lets me care for my community.'}]}});
   if(url.pathname==='/api/conversation-history')return route.fulfill({json:{items:[{id:'conversation-1',studentId,date,mode:'planning',summary:'We discussed majors, college costs, and preparing applications.',sources:[]}]}});
   if(url.pathname==='/api/conversation-summary')return route.fulfill({json:{summary:state.summary,sources:[],date}});
   if(url.pathname==='/api/plans')return route.fulfill({json:{plans:[],creationIds:[],limited:false,supportsActions:true}});
   if(url.pathname==='/api/profile-voice'){state.voiceRevisions.push(state.revision);return route.fulfill({json:{sdp:'v=0\r\n',playWelcome:false,memoryRevision:state.revision}});}
   if(url.pathname==='/api/student-memory'){
    if(body.action==='revision')return route.fulfill({json:{available:true,revision:state.revision}});
    if(body.action==='sync'){if(state.failSync)return route.fulfill({status:503,json:{error:'memory_unavailable'}});state.pending=0;}
    if(['create','update','confirm','delete'].includes(body.action)){
     if(state.failSave){state.failSave=false;return route.fulfill({status:503,json:{error:'memory_unavailable'}});}
     const current=state.memories.find(m=>m.id===body.id);
     if(current&&body.version!==current.version)return route.fulfill({status:409,json:{error:'memory_changed'}});
     state.writes.push(body);state.revision++;
     if(body.action==='delete')state.memories=state.memories.filter(m=>m.id!==body.id);
     else if(current)Object.assign(current,body.memory||{},{status:'confirmed',version:current.version+1});
     else state.memories.push({...body.memory,id:body.id,studentId,version:1,status:'confirmed',reportedBy:'student',summaryId:null,quote:'',updatedAt:date});
    }
    return route.fulfill({json:{available:true,memories:state.memories,revision:state.revision,pendingCount:state.pending}});
   }
   if(url.pathname==='/api/topic-notes'){
    if(['create','update','delete'].includes(body.action)){
     state.writes.push(structuredClone(body));
     if(body.action==='delete')state.notes=state.notes.filter(note=>note.id!==body.id);
     else if(body.action==='update')state.notes=state.notes.map(note=>note.id===body.id?{...note,...body.note,status:'saved',version:note.version+1}:note);
     else state.notes.push({id:body.id,studentId,...body.note,status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:date,sources:[],conversationAt:null});
    }
    return route.fulfill({json:{notes:state.notes,generatedSummaryIds:['conversation-1'],pendingCount:0}});
   }
   return route.fulfill({json:{ok:true,items:[],summary:'Synthetic summary',plans:[]}});
  }
  if(url.origin===origin||['data:','blob:','about:'].includes(url.protocol))return route.continue();
  return route.fulfill({status:200,contentType:url.hostname.startsWith('fonts.')?'text/css':'application/json',body:url.hostname.startsWith('fonts.')?'':'{}'});
 });
 await page.addInitScript(({language,audioBlocked,nativeResearch})=>{
  localStorage.setItem('origen.language',language);
  window.sent=[];window.connections=[];window.researchRequests=0;window.allowAudio=!audioBlocked;
  window.mediaPlays=0;
  const nativeFetch=window.fetch;
  window.fetch=async(...args)=>{
   if(!nativeResearch&&String(args[0]).match(/\/api\/(finance|admissions)-research/)){
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
 },{language,audioBlocked:false,nativeResearch});
 await configurePage?.(page);
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor({state:'visible'});await page.locator('.voice-ready').waitFor();
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
 return {page,state};
}
async function openBinder(page){await page.locator('.binder-cover').click();await page.locator('.binder-open').waitFor();}

module.exports={setup,openBinder,subject,studentId};
if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const {page,state}=await setup(browser,{width,language});const tr=(en,es)=>language==='es'?es:en;
  try{
   await openBinder(page);const memory=page.locator('.student-memory');
   await memory.locator(':scope > summary').focus();await page.keyboard.press('Enter');
   await memory.getByRole('combobox').first().selectOption('constraint');await memory.locator('.memory-entry').waitFor();
   assert.match(await memory.innerText(),/To review|Por revisar/);
   await memory.getByText(tr('See source','Ver fuente'),{exact:true}).click();assert.match(await memory.locator('blockquote').innerText(),/parent reports/);
   await memory.getByRole('button',{name:tr('Confirm detail','Confirmar dato'),exact:true}).focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.memory-meta')?.textContent.match(/Confirmed|Confirmado/));assert.equal(state.memories[0].speaker,'parent');
   await memory.getByRole('button',{name:tr('Edit detail','Editar dato'),exact:true}).click();await memory.locator('textarea').fill(tr('I now work mornings.','Ahora trabajo por las mañanas.'));
   state.failSave=true;await memory.getByRole('button',{name:tr('Save detail','Guardar dato'),exact:true}).click();await memory.locator('[role=alert]').waitFor();
   assert.match(await memory.locator('textarea').inputValue(),/mornings|mañanas/);assert.equal(state.memories[0].version,2);
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections[0]?.connectionState==='connected');
   await memory.getByRole('button',{name:tr('Save detail','Guardar dato'),exact:true}).click();await page.waitForFunction(()=>window.connections[0]?.connectionState==='closed');assert.equal(state.memories[0].version,3);
   assert.match(await page.locator('.voice-notice').innerText(),/not saved|no se guardó/);
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections[1]?.connectionState==='connected');assert.equal(state.voiceRevisions.at(-1),state.revision);
   // Another device changes the revision. The active provider must be discarded.
   state.revision++;await page.waitForFunction(()=>window.connections[1]?.connectionState==='closed',null,{timeout:12000});
   await memory.getByRole('button',{name:tr('Edit detail','Editar dato'),exact:true}).click();await memory.locator('textarea').fill('Draft retained on conflict');state.memories[0].version++;
   await memory.getByRole('button',{name:tr('Save detail','Guardar dato'),exact:true}).click();await memory.locator('[role=alert]').waitFor();assert.equal(await memory.locator('textarea').inputValue(),'Draft retained on conflict');
   await memory.getByRole('button',{name:tr('Reload','Recargar'),exact:true}).click();await page.waitForFunction(()=>document.querySelector('.memory-editor')?.textContent.match(/newer version|más reciente/));
   await memory.getByRole('button',{name:tr('Cancel','Cancelar'),exact:true}).click();
   await memory.getByRole('button',{name:tr('Remove detail','Quitar dato'),exact:true}).click();await memory.locator('.memory-entry').waitFor({state:'detached'});assert.equal(state.memories.length,0);
   state.failSync=false;await memory.getByRole('button',{name:/Retry suggestions|Reintentar sugerencias/}).click();await page.waitForFunction(()=>!document.querySelector('.student-memory')?.textContent.match(/Retry suggestions|Reintentar sugerencias/));assert.equal(state.pending,0);
   await memory.getByRole('button',{name:tr('Add a detail','Agregar un dato'),exact:true}).click();await memory.locator('textarea').fill(tr('One example at a time helps.','Me ayuda un ejemplo a la vez.'));
   await memory.locator('.memory-editor select').first().selectOption('preference');await memory.getByRole('button',{name:tr('Save detail','Guardar dato'),exact:true}).click();await memory.locator('.memory-entry').waitFor();assert.equal(state.memories[0].category,'preference');
   await page.locator('.shared-voice .voice-origen-button').first().click();await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');
   await page.evaluate(({subject,studentId})=>window.dispatchEvent(new StorageEvent('storage',{key:'origen.memory.change',newValue:JSON.stringify({subject,studentId:'different-student',nonce:'test'})})),{subject,studentId});
   assert.equal(await page.evaluate(()=>window.connections.at(-1).connectionState),'connected');
   await page.evaluate(({subject,studentId})=>window.dispatchEvent(new StorageEvent('storage',{key:'origen.memory.change',newValue:JSON.stringify({subject,studentId,nonce:'test'})})),{subject,studentId});
   await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='closed');
   const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth-innerWidth,bad:[...document.querySelectorAll('.student-memory button,.student-memory textarea,.student-memory select')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;}).map(e=>e.textContent)}));assert.ok(overflow.width<=1,JSON.stringify(overflow));assert.deepEqual(overflow.bad,[]);
   await memory.scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/origen-memory-${width}-${language}.png`,fullPage:true});
   assert.deepEqual(state.errors,[]);count++;console.log(`PASS ${width}/${language}: keyboard review, source, correction, failed save, stale edit, removal, retry, fresh voice and cross-device invalidation.`);
  }finally{await page.close();}
 }
 console.log(`Passed ${count} student-memory browser journeys.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
