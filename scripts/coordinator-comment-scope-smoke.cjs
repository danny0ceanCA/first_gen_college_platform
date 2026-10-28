// Local browser regression: every API request is intercepted with synthetic data.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const resolve=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json');
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const [width,language,motion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:motion}),errors=[],writes=[];
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const t=(en,es)=>language==='es'?es:en;
  const now=new Date().toISOString();
  const binder={id:'grant',studentName:'Alex Scope Test',publicationId:'publication',version:1,publishedAt:now,expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer','applications'],isNew:false,helpRequested:false,entries:[
   {id:'transfer-entry',topic:'transfer',kind:'note',language:'en',content:'I want to compare transfer course sequences.'},
   {id:'application-entry',topic:'applications',kind:'note',language:'en',content:'I discussed an essay about a community garden.'}
  ]};
  const comment=(id,topic,publicationItemId,body)=>({id,topic,publicationItemId,body,kind:'guidance',resourceUrl:'',version:1,authorName:'Jordan',organizationName:'Synthetic Organization',createdAt:now,editedAt:null,withdrawn:false,hidden:false,reviewed:false,connectionEnded:false,replyCount:0});
  const feedback=[
   comment('transfer-note','transfer','transfer-entry','Compare the prerequisites together.'),
   comment('transfer-page','transfer',null,'Bring your course list.'),
   comment('application-note','applications','application-entry','This is a great essay idea!'),
   comment('application-page','applications',null,'Focus on one specific moment.'),
   comment('earlier-note','applications','earlier-entry','Keep the earlier draft for comparison.')
  ];
  let feedbackGate;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"const auth={user:{sub:'synthetic-scope'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>'test'};export function useAuth0(){return auth}"});
   if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.fulfill({body:''});
   const input=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-binders'){
    if(input.action==='list')data={binders:[binder],counts:{all:1,new:0,help:0},nextCursor:null};
    if(input.action==='read')data=binder;
   }
   if(url.pathname==='/api/coordinator-feedback'){
    if(input.action==='staff-list'){if(feedbackGate)await feedbackGate;data={feedback,writesEnabled:true};}
    if(input.action==='staff-create'){
     writes.push(input);feedback.push(comment('created-note',input.topic,input.publicationItemId||null,input.body));data={id:'created-note'};
    }
    if(input.action==='staff-edit'){
     writes.push(input);const item=feedback.find(f=>f.id===input.feedbackId);item.body=input.body;item.version++;data={id:item.id};
    }
   }
   assert.ok(data,`Unexpected synthetic API ${url.pathname}/${input.action}`);
   return route.fulfill({json:data});
  });
  await page.route('**/comment-scope-preview',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import CoordinatorBinders from '/src/CoordinatorBinders.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';
   import '/src/styles.css';import '/src/brand.css';
   browserPrivacy.start('synthetic-scope',{fresh:true});
   const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   const request=path=>async input=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return response.json();};
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main',{style:{maxWidth:'1100px',padding:'12px',margin:'auto'}},React.createElement(CoordinatorBinders,{organizationId:'org',request:request('/api/coordinator-binders'),feedbackRequest:request('/api/coordinator-feedback'),t,es:${language==='es'}})));
  </script></html>`}));
  const tab=name=>page.getByRole('tab',{name:new RegExp('^'+name)});
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const goSummary=async()=>{
   await tab(t('Summary','Resumen')).click();
   await page.locator('.shared-notebook-overview').waitFor();
   assert.equal(await page.locator('.guidance-card').count(),0,'Summary displayed another divider’s comments');
   assert.equal(await page.locator('#shared-binder-page .coordinator-guidance').count(),0,'Summary displayed a misleading guidance area');
  };
  const expectComments=async ids=>{
   for(const id of ids)await page.locator(`[data-comment-id="${id}"]`).waitFor();
   assert.deepEqual((await page.locator('.guidance-card').evaluateAll(els=>els.map(el=>el.dataset.commentId))).sort(),[...ids].sort());
  };
  try{
   await page.goto(origin+'/comment-scope-preview');
   await page.locator('.coordinator-binder-list button').click();await goSummary();
   let releaseInitial;feedbackGate=new Promise(resolve=>{releaseInitial=resolve;});
   await tab(t('Applications','Solicitudes')).click();
   await page.locator('.shared-paper-row .ink-loading-placeholder').waitFor();await settle();
   assert.equal(await page.locator('.guidance-card').count(),0,'Pending comments displayed invented content');
   assert.equal(await page.locator('.shared-paper-row .binder-annotation-content').getAttribute('aria-busy'),'true');
   await page.evaluate(()=>{
    window.slotFrames=[];window.recordSlots=true;
    const sample=()=>{if(!window.recordSlots)return;const slot=document.querySelector('.shared-paper-row .binder-annotation-slot');window.slotFrames.push(slot.getBoundingClientRect().height);requestAnimationFrame(sample);};requestAnimationFrame(sample);
   });
   releaseInitial();feedbackGate=undefined;
   await expectComments(['application-note','application-page','earlier-note']);
   const initialMotion=await page.locator('[data-comment-id="application-note"]').evaluate(el=>el.getAnimations().map(a=>({duration:a.effect.getTiming().duration,delay:a.effect.getTiming().delay})));
   assert.deepEqual(initialMotion,motion==='reduce'?[]:[{duration:560,delay:0}],'Missing or unexpected comment arrival');
   assert.deepEqual(await page.locator('[data-comment-id="application-page"]').evaluate(el=>el.getAnimations().map(a=>a.effect.getTiming().delay)),motion==='reduce'?[]:[45],'The comments did not stagger within this divider');
   await settle();
   const slotFrames=await page.evaluate(()=>{window.recordSlots=false;return window.slotFrames;});
   if(motion!=='reduce')assert.ok(new Set(slotFrames.map(h=>Math.round(h))).size>3,'Loading replaced the margin height in one abrupt jump');
   assert.equal(await page.locator('.ink-loading-placeholder').count(),0);
   assert.equal(await page.locator('.shared-paper-row .binder-annotation-content').getAttribute('aria-busy'),'false');
   assert.equal(await page.locator('.shared-paper-row [data-comment-id="application-note"]').count(),1);
   assert.equal(await page.locator('.shared-page-margin [data-comment-id="application-page"]').count(),1);
   assert.equal(await page.locator('.shared-earlier-annotations [data-comment-id="earlier-note"]').count(),1);
   await page.locator('[data-comment-id="application-note"]').getByRole('button',{name:t('Edit comment','Editar comentario'),exact:true}).click();
   await page.getByLabel(t('Your guidance','Tu orientación'),{exact:true}).fill('Edited essay feedback, still beside the same entry.');
   await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();
   await page.locator('[data-comment-id="application-note"].ink-just-sent').waitFor();
   assert.equal(writes[0].feedbackId,'application-note');
   await goSummary();
   await tab(t('Transfer & courses','Transferencia y cursos')).click();
   await expectComments(['transfer-note','transfer-page']);
   await page.locator('.shared-page-margin .ink-add').click();
   await page.getByLabel(t('Your guidance','Tu orientación'),{exact:true}).fill('A new note for the transfer divider.');
   // Switching to Summary must still protect the unsent, scoped comment.
   page.once('dialog',dialog=>dialog.dismiss());await tab(t('Summary','Resumen')).click();
   assert.equal(await page.getByLabel(t('Your guidance','Tu orientación'),{exact:true}).inputValue(),'A new note for the transfer divider.');
   await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();
   await page.locator('[data-comment-id="created-note"].ink-just-sent').waitFor();
   assert.equal(await page.locator('[data-comment-id="created-note"]').evaluate(el=>el.getAnimations().some(a=>a.effect.getTiming().duration===560)),false,'Saved note played the loading reveal over its drop');
   assert.equal(writes[1].topic,'transfer');assert.ok(!writes[1].publicationItemId);
   await expectComments(['transfer-note','transfer-page','created-note']);
   await goSummary();
   // A late list response after leaving a divider must not add comments to Summary.
   let release;feedbackGate=new Promise(resolve=>{release=resolve;});
   const requested=page.waitForRequest(r=>r.url().endsWith('/api/coordinator-feedback'));
   await tab(t('Applications','Solicitudes')).click();await requested;await goSummary();
   const returned=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-feedback'));
   release();feedbackGate=undefined;await (await returned).finished();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.locator('.guidance-card').count(),0,'A late divider response leaked onto Summary');
   await tab(t('Applications','Solicitudes')).click();await expectComments(['application-note','application-page','earlier-note']);
   await settle();
   await page.locator('[data-comment-id="application-note"]').evaluate(el=>{window.existingComment=el;});
   let releaseRefresh;feedbackGate=new Promise(resolve=>{releaseRefresh=resolve;});
   await page.locator('.guidance-heading').getByRole('button',{name:t('Refresh','Actualizar'),exact:true}).click();
   assert.equal(await page.locator('.ink-loading-placeholder').count(),0,'Refresh flashed loading placeholders over existing comments');
   assert.equal(await page.locator('.shared-paper-row .ink-add').count(),1,'Refresh removed the Add comment control');
   const refreshResponse=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-feedback'));
   releaseRefresh();feedbackGate=undefined;await (await refreshResponse).finished();
   await page.waitForFunction(()=>!document.querySelector('.shared-paper-row .ink-add').disabled);
   assert.equal(await page.locator('[data-comment-id="application-note"]').evaluate(el=>el===window.existingComment&&el.getAnimations().length===0),true,'Refresh replaced or replayed an existing comment');
   await page.locator('.shared-binder-toolbar').getByRole('button',{name:t('Refresh binder','Actualizar carpeta'),exact:true}).click();
   await page.locator('.coordinator-binders[aria-busy="false"]').waitFor();
   await expectComments(['application-note','application-page','earlier-note']);
   await goSummary();await page.getByRole('button',{name:t('Close binder','Cerrar carpeta'),exact:true}).click();
   await page.locator('.coordinator-binder-list button').click();await goSummary();
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}/${language}/${motion}: staggered comment arrival, eased margin height, steady refresh, divider scope, saved-note drop, draft guard, late response and reopen.`);
  }finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
