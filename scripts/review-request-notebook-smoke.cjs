// Real React UI with deterministic synthetic transport; PostgreSQL is tested separately.
const {createRequire}=require('node:module');
const {mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-review-step3-browser';
(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});
 let journeys=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:width===390?'no-preference':'reduce'}),errors=[];
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const t=(en,es)=>language==='es'?es:en,now=new Date().toISOString(),connectionId=randomUUID();
  const entry={id:randomUUID(),version:1,topic:'costs',kind:'note',language,content:t('My insurance charge is $1,200. I already have coverage.','El cargo por mi seguro es de $1,200. Ya tengo cobertura.'),status:'saved',origin:'user',summaryId:null};
  const privateNote={...entry,id:randomUUID(),content:'PRIVATE_FAMILY_SENTINEL',origin:'conversation'};
  const recipient={id:connectionId,coordinatorName:'Jordan Rivera',organizationName:'Community College'};
  const question=t('Can you help me understand the insurance waiver deadline?','¿Me ayudas a entender la fecha límite para exentar el seguro?');
  const records=[],calls=[],previews=new Map(),keys=new Map();
  let enabled=true,failCreate=false,failSubmit=false,expireNext=false,delayOptions=false,conflictNext=false;
  const receipt=r=>({...r,entries:r.entries.map(e=>({id:e.id,version:e.version}))});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"export function useAuth0(){return {user:{sub:'synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:'synthetic'}))+'.test'}}"});
   if(url.pathname==='/api/review-requests'){
    const body=route.request().postDataJSON();calls.push(body);let data,status=200;
    const r=records.find(r=>r.id===body.id&&r.studentId===body.studentId);
    if(body.action==='list'){
     const own=records.filter(r=>r.studentId===body.studentId).slice().reverse();
     data={enabled,available:true,deliveryEnabled:false,requests:own.map(receipt),nextCursor:null,activity:own.flatMap(r=>r.entries.map(e=>({entryId:e.id,id:r.id,createdAt:r.createdAt,status:r.status,recipient:r.recipient,publication:r.publication})))};
    }else if(body.action==='options'){
     if(delayOptions){delayOptions=false;await new Promise(resolve=>setTimeout(resolve,500));}
     data={connections:[recipient],entries:[entry]};
    }else if(body.action==='create'){
     assert.equal(body.origin,'notebook');assert.equal(body.originalQuestion,question);assert.equal(body.connectionId,connectionId);
     if(!keys.has(body.requestKey)){
      const created={...body,id:randomUUID(),status:'draft',version:1,createdAt:now,submittedAt:null,recipient:{connectionId,...recipient},publication:null};
      records.push(created);keys.set(body.requestKey,created);
     }
     data={request:receipt(keys.get(body.requestKey))};
     if(failCreate){failCreate=false;return route.abort('failed');}
    }else if(body.action==='preview'){
     const preview={id:randomUUID(),digest:'a'.repeat(64),expiresAt:new Date(Date.now()+(expireNext?1200:600000)).toISOString(),accessExpiresAt:new Date(Date.now()+30*86400000).toISOString(),selection:{question:r.originalQuestion,studentName:'Alex',coordinatorName:recipient.coordinatorName,organizationName:recipient.organizationName,language,entries:r.entries.map(()=>entry)}};
     expireNext=false;previews.set(preview.id,preview);data={preview};
    }else if(body.action==='submit'){
     assert.equal(body.confirmed,true);assert.equal(body.digest,previews.get(body.previewId).digest);assert.equal(body.version,1);
     if(conflictNext){conflictNext=false;status=409;data={error:'review_request_sources_changed'};}
     else{r.status='submitted';r.version=2;r.submittedAt=now;r.publication={id:randomUUID(),wording:'original',access:'active',notification:'pending',expiresAt:previews.get(body.previewId).accessExpiresAt};data={request:receipt(r)};if(failSubmit){failSubmit=false;return route.abort('failed');}}
    }else if(body.action==='get')data={request:receipt(r)};
    else if(body.action==='withdraw'){assert.equal(body.version,2);r.status='withdrawn';r.version=3;r.publication.access='unavailable';data={request:receipt(r)};}
    else if(body.action==='cancel'){r.status='cancelled';r.version=2;data={request:receipt(r)};}
    else if(body.action==='remove'){records.splice(records.indexOf(r),1);data={removed:true};}
    assert.ok(data,JSON.stringify(body));return route.fulfill({status,json:data});
   }
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:'alex',name:'Alex',stage:'Community college'}]}});
   if(url.pathname==='/api/topic-notes')return route.fulfill({json:{notes:[{...entry,studentId:'alex',updatedAt:now,conversationAt:null,translations:{},sources:[],quote:''}],generatedSummaryIds:[],pendingCount:0}});
   if(url.pathname==='/api/conversation-history')return route.fulfill({json:{items:[]}});
   if(url.pathname==='/api/student-memory')return route.fulfill({json:{available:false,pendingCount:0,memories:[]}});
   if(url.pathname==='/api/coordinator-feedback')return route.fulfill({json:{feedback:[],writesEnabled:false}});
   if(url.pathname==='/api/binder-sharing')return route.fulfill({json:{available:true,enabled:false,connections:[],grants:[]}});
   if(url.pathname==='/api/coordinator-notifications')return route.fulfill({json:{notifications:[]}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'synthetic_unavailable'}});
   if(url.origin!==origin)return route.abort();
   return route.continue();
  });
  await page.route('**/review-request-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:16px;font-family:system-ui;background:#f5f5ee"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {StudentReviewRequestsProvider,StudentReviewRequests,StudentReviewRequestEntry} from '/src/StudentReviewRequests.tsx';
   import '/src/PersonalBinder.css';import '/src/styles.css';
   import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');window.endSession=()=>browserPrivacy.stop('logout');
   function App(){const [student,setStudent]=React.useState('alex');window.switchStudent=()=>setStudent('other');const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
    return React.createElement(StudentReviewRequestsProvider,{studentId:student,language:${JSON.stringify(language)},t},React.createElement(React.Fragment,null,
     React.createElement(StudentReviewRequests),React.createElement('article',{'data-note':'manual'},React.createElement('p',null,${JSON.stringify(entry.content)}),React.createElement(StudentReviewRequestEntry,{note:${JSON.stringify(entry)}})),React.createElement('article',{'data-note':'derived'},React.createElement(StudentReviewRequestEntry,{note:${JSON.stringify(privateNote)}}))));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  </script></body></html>`}));
  await page.route('**/review-notebook-integration',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import Notebook from '/src/TopicNotebook.tsx';import {FamilyProvider} from '/src/FamilyStore.tsx';import {ConversationHistoryProvider} from '/src/ConversationHistory.tsx';
   import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   function App(){const [role,setRole]=React.useState('student');window.asParent=()=>setRole('parent');return React.createElement(FamilyProvider,{previewStudents:[]},React.createElement(ConversationHistoryProvider,null,React.createElement('main',{style:{maxWidth:'1100px',margin:'auto',padding:'12px'}},React.createElement(Notebook,{studentId:'alex',name:'Alex',role,initiallyOpen:true,language:${JSON.stringify(language)},t,navigate:()=>{}}))));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  </script></html>`}));
  const button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true});
  const approval=()=>page.getByLabel(t('I approve this exact question and these notes for this coordinator.','Apruebo esta pregunta exacta y estas notas para este coordinador.'),{exact:true});
  const write=async()=>{await button('Write a request','Escribir una solicitud').first().click();await page.getByLabel(t('In my own words','Con mis propias palabras'),{exact:true}).fill(question);};
  try{
   await page.goto(origin+'/review-request-smoke');await button('Write a request','Escribir una solicitud').waitFor();
   assert.equal(await page.locator('[data-note=derived] button').count(),0);
   await button('Ask my coordinator','Consultar a mi coordinador').click();
   await page.getByLabel(t('In my own words','Con mis propias palabras'),{exact:true}).fill(question);
   assert.equal(await page.locator('.review-request-note-choices input:checked').count(),1);
   assert.equal(calls.filter(c=>c.action==='create').length,0);
   await button('Preview request','Ver solicitud').click();await approval().waitFor();
   assert.equal(await button('Approve request','Aprobar solicitud').isDisabled(),true);
   assert.ok(await page.locator('dialog').innerText().then(text=>text.includes(question)&&text.includes(entry.content)&&text.includes(recipient.coordinatorName)&&!text.includes('PRIVATE_FAMILY_SENTINEL')));
   assert.equal(calls.filter(c=>c.action==='submit').length,0);
   await approval().focus();await page.keyboard.press('Space');await button('Approve request','Aprobar solicitud').focus();await page.keyboard.press('Enter');
   await page.locator('.review-request-history article').waitFor();assert.equal(calls.filter(c=>c.action==='submit').length,1);
   await page.screenshot({path:`${output}/${width}-${language}-history.png`});
   await button('Close requests','Cerrar solicitudes').click();await page.locator('dialog').waitFor({state:'detached'});
   assert.ok((await page.locator('.review-request-margin').innerText()).includes(t('Delivery is pending','La entrega está pendiente')));
   await page.reload();await page.locator('.review-request-margin').click();await button('Withdraw request','Retirar solicitud').waitFor();await button('All my requests','Todas mis solicitudes').click();
   enabled=false;await button('Refresh requests','Actualizar solicitudes').click();await page.getByText(t('New requests are paused. Your saved requests remain here to manage.','Las solicitudes nuevas están en pausa. Puedes administrar aquí las guardadas.'),{exact:true}).waitFor();
   await button('Withdraw request','Retirar solicitud').click();await page.getByText(t('I withdrew this request.','Retiré esta solicitud.'),{exact:true}).last().waitFor();
   await button('Delete request','Eliminar solicitud').click();await button('Keep request','Conservar solicitud').click();assert.equal(records.length,1);
   await button('Delete request','Eliminar solicitud').click();await button('Confirm deletion','Confirmar eliminación').click();await page.getByText(t('No requests yet. Start with one question.','Todavía no hay solicitudes. Comienza con una pregunta.'),{exact:true}).waitFor();
   assert.equal(records.length,0);enabled=true;await button('Refresh requests','Actualizar solicitudes').click();await button('Close requests','Cerrar solicitudes').click();
   // Lost create response: retry must preserve the same idempotency key.
   failCreate=true;await write();await button('Preview request','Ver solicitud').click();await button('Retry this draft','Reintentar este borrador').waitFor();assert.equal(records.length,1);
   await button('Retry this draft','Reintentar este borrador').click();await approval().waitFor();assert.equal(records.length,1);
   const creates=calls.filter(c=>c.action==='create');assert.equal(creates.at(-1).requestKey,creates.at(-2).requestKey);
   // Lost submit response: read the receipt instead of sending a second approval.
   failSubmit=true;await approval().check();await button('Approve request','Aprobar solicitud').click();await button('Check saved request','Comprobar solicitud guardada').click();await button('Withdraw request','Retirar solicitud').waitFor();assert.equal(calls.filter(c=>c.action==='submit').length,2);
   await button('Close requests','Cerrar solicitudes').click();
   expireNext=true;await write();await button('Preview request','Ver solicitud').click();await approval().waitFor();await button('Prepare new preview','Preparar nueva vista previa').waitFor();assert.equal(await approval().isDisabled(),true);
   await button('Prepare new preview','Preparar nueva vista previa').click();await button('Approve request','Aprobar solicitud').waitFor();assert.equal(await approval().isChecked(),false);
   conflictNext=true;await approval().check();await button('Approve request','Aprobar solicitud').click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.review-request-approval').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert.ok(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await button('Close requests','Cerrar solicitudes').click();
   // A delayed response for Alex cannot paint into another student's notebook.
   delayOptions=true;await button('Ask my coordinator','Consultar a mi coordinador').click();await page.evaluate(()=>window.switchStudent());await page.locator('dialog').waitFor({state:'detached'});
   await page.waitForTimeout(700);assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.locator('.review-request-margin').count(),0);
   await button('Write a request','Escribir una solicitud').click();await page.evaluate(()=>window.endSession());await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.locator('.student-review-requests').count(),0);
   if(width===1280&&language==='en'||width===320&&language==='es'){
    await page.goto(origin+'/review-notebook-integration');
    await page.locator('.personal-binder [data-topic=costs]').first().click();
    const actualNote=page.locator(`[data-note-id="${entry.id}"]`);await actualNote.getByRole('button',{name:t('Ask my coordinator','Consultar a mi coordinador'),exact:true}).click();
    await page.getByLabel(t('In my own words','Con mis propias palabras'),{exact:true}).waitFor();
    assert.equal(await page.locator('.review-request-note-choices input:checked').count(),1);
    await button('Close requests','Cerrar solicitudes').click();await page.locator('dialog').waitFor({state:'detached'});
    await page.screenshot({path:`${output}/${width}-${language}-notebook.png`,fullPage:true});
    await page.evaluate(()=>window.asParent());await page.locator('.student-review-requests').waitFor({state:'detached'});
    assert.equal(await button('Ask my coordinator','Consultar a mi coordinador').count(),0);
   }
   assert.deepEqual(errors,[]);journeys++;console.log(`PASS ${width}/${language}: note selection, explicit approval, reload, paused withdrawal, deletion, response recovery, expiry, conflict, account scope, privacy cleanup${width===1280&&language==='en'||width===320&&language==='es'?', full notebook integration and parent exclusion':''}.`);
  }catch(error){await page.screenshot({path:`${output}/${width}-${language}-failure.png`}).catch(()=>{});console.error('Browser errors:',errors);throw error;}finally{await page.close();}
 }}finally{await browser.close();}
 console.log(`Passed ${journeys} notebook request journeys.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
