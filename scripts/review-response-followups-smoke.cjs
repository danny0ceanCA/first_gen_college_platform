// Real binder/coordinator controls; synthetic auth, API and delivery transport.
const {chromium}=require('playwright');
const {mkdir,writeFile}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5185',output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-response-step5-browser';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});const results=[];
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'}),errors=[],calls=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const t=(en,es)=>language==='es'?es:en,id=randomUUID(),connection=randomUUID(),org=randomUUID(),now=new Date().toISOString(),source={kind:'review-response',requestId:id,responseVersion:1};
  const original=t('Which insurance waiver documents are accepted?','¿Qué documentos aceptan para la exención del seguro?'),question=t('Which document should I ask my employer for?','¿Cuál documento debo pedirle a mi trabajo?');
  const note={id:randomUUID(),version:1,topic:'costs',kind:'note',language,content:t('I have insurance through my job.','Tengo seguro por mi trabajo.')};
  const recipient={connectionId:connection,coordinatorName:'Maria Rivera',organizationName:'Community College'};
  let changed=false,delivered=false,submits=0;const drafts=[],previews=new Map();
  const related=()=>changed?{availability:'unavailable',source:null,responseVersion:1}:{availability:'current',source,responseVersion:1,question:original,coordinatorName:recipient.coordinatorName,respondedAt:now};
  const parent=()=>({id,version:2,studentId:'alex',status:'submitted',originalQuestion:original,proposedClarification:'',kind:'question',language,createdAt:now,submittedAt:now,recipient,entries:[],publication:{id:randomUUID(),wording:'original',access:'active',notification:'delivered',expiresAt:'2099-01-01T00:00:00Z',responded:true},coordinatorReview:{openedAt:now,reviewedAt:null,response:{version:changed?2:1,status:'available',guidance:'RESPONSE_BODY_NOT_ATTACHED',suggestedAction:'',resourceUrl:'',followUpOn:null,updatedAt:now}}});
  const record=d=>({...d,relatedResponse:related(),...(d.publication?{publication:{...d.publication,access:changed?'unavailable':'active',notification:delivered?'delivered':'pending'}}:{})});
  const response=(route,status,data)=>route.fulfill({status,json:data});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"export function useAuth0(){return {user:{sub:'synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=> 'synthetic'}}"});
   if(url.pathname.startsWith('/api/')){
    const b=route.request().postDataJSON();calls.push({path:url.pathname,...b});
    if(url.pathname==='/api/review-response-choices')return response(route,200,{enabled:true,available:true,canFollowUp:!changed,acceptedActionCount:0,choice:{state:'available',revision:0,reviewOn:null,shouldOffer:true}});
    if(url.pathname==='/api/review-requests'){
     const d=drafts.find(x=>x.id===b.id);
     if(b.action==='list')return response(route,200,{enabled:true,available:true,deliveryEnabled:true,requests:[...drafts].reverse().map(record).concat(parent()),activity:[],nextCursor:null});
     if(b.action==='options')return response(route,200,{connections:[{id:connection,coordinatorName:'Maria Rivera',organizationName:'Community College'},{id:randomUUID(),coordinatorName:'Another coordinator',organizationName:'Another college'}],entries:[note]});
     if(b.action==='get')return response(route,200,{request:d?record(d):parent()});
     if(b.action==='create'){
      assert.deepEqual(b.relatedResponse,source);assert.equal(b.connectionId,connection);assert.equal(b.originalQuestion,question);assert.equal(JSON.stringify(b).includes('RESPONSE_BODY_NOT_ATTACHED'),false);
      const existing=drafts.find(x=>x.requestKey===b.requestKey);if(existing)return response(route,200,{request:record(existing)});
      const next={...b,id:randomUUID(),version:1,status:'draft',studentId:'alex',createdAt:new Date(Date.now()+1000).toISOString(),submittedAt:null,recipient,publication:null};drafts.push(next);return response(route,200,{request:record(next)});
     }
     if(b.action==='preview'){
      if(changed)return response(route,409,{error:'review_request_source_changed'});
      const p={id:randomUUID(),digest:'b'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),accessExpiresAt:'2099-01-01T00:00:00Z',selection:{question:d.originalQuestion,studentName:'Alex',coordinatorName:'Maria Rivera',organizationName:'Community College',language,entries:d.entries.length?[note]:[],relatedResponse:related()}};previews.set(p.id,p);return response(route,200,{preview:p});
     }
     if(b.action==='submit'){
      assert.equal(b.confirmed,true);assert.equal(b.digest,previews.get(b.previewId)?.digest);assert.equal(changed,false);submits++;assert.equal(d.status,'draft');d.status='submitted';d.version=2;d.submittedAt=now;d.publication={id:randomUUID(),wording:'original',access:'active',notification:'pending',expiresAt:'2099-01-01T00:00:00Z'};return response(route,200,{request:record(d)});
     }
    }
    if(url.pathname==='/api/coordinator-review-requests'){
     const available=delivered&&!changed?drafts.filter(d=>d.status==='submitted'):[];
     const row=d=>({id:d.id,publicationId:d.publication.id,studentName:'Alex',kind:'question',submittedAt:now,expiresAt:'2099-01-01T00:00:00Z',openedAt:null,reviewedAt:null,responseStatus:'none',response:null,question:d.originalQuestion,language,entries:d.entries.length?[note]:[],relatedResponse:related()});
     if(b.action==='list')return response(route,200,{enabled:true,requests:available.map(row),nextCursor:null});
     if(b.action==='read')return b.id===id?response(route,200,{...row({id,publication:{id:randomUUID()},originalQuestion:original,entries:[]}),relatedResponse:null}):available.some(d=>d.id===b.id)?response(route,200,row(available.find(d=>d.id===b.id))):response(route,404,{error:'review_unavailable'});
    }
    return response(route,503,{error:'synthetic_unavailable'});
   }
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.route('**/followup-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module">
  import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
  import {StudentReviewRequestsProvider,StudentReviewRequests} from '/src/StudentReviewRequests.tsx';import CoordinatorReviewRequests from '/src/CoordinatorReviewRequests.tsx';import {SharedVoiceContext} from '/src/SharedVoiceContext.ts';
  import {browserPrivacy} from '/src/browserPrivacy.mjs';import {apiFetch,setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/PersonalBinder.css';
  browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
  const request=async body=>{const r=await apiFetch('/api/coordinator-review-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
  function App(){const [staff,setStaff]=React.useState(false);window.viewStaff=()=>setStaff(true);window.viewStudent=()=>setStaff(false);return React.createElement('main',{style:{maxWidth:'900px',margin:'16px auto',padding:'12px'}},staff?React.createElement(CoordinatorReviewRequests,{organizationId:${JSON.stringify(org)},t,es:${language==='es'},request}):React.createElement(SharedVoiceContext.Provider,{value:{ready:true,talkAbout:()=>{throw Error('No automatic voice call');}}},React.createElement(StudentReviewRequestsProvider,{studentId:'alex',language:${JSON.stringify(language)},t},React.createElement(StudentReviewRequests))));}
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`}));
  const button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true});
  const open=async()=>{await page.getByRole('button',{name:new RegExp(t('^My requests','^Mis solicitudes'))}).click();await button('Ask my coordinator a follow-up','Pedir una aclaración a mi coordinador').click();};
  const preview=async()=>{await open();assert.equal(await page.getByRole('combobox',{name:t('My coordinator','Mi coordinador'),exact:true}).isDisabled(),true);await page.getByRole('textbox',{name:new RegExp(t('^In my own words','^Con mis propias palabras'))}).fill(question);await button('Preview request','Ver solicitud').click();await button('Approve request','Aprobar solicitud').waitFor();await page.locator('dialog .review-request-related').waitFor();};
  try{
   await page.goto(origin+'/followup-smoke');await preview();assert.equal(submits,0);
   await page.locator('.review-request-related').getByText(original,{exact:false}).waitFor();assert.equal(await page.getByText('RESPONSE_BODY_NOT_ATTACHED',{exact:true}).count(),0);
   assert.equal(await button('Approve request','Aprobar solicitud').isDisabled(),true);await page.screenshot({path:`${output}/${width}-${language}-preview.png`,fullPage:true});
   await page.getByRole('checkbox',{name:t('I approve this exact question, these notes and this response reference for this coordinator.','Apruebo esta pregunta exacta, estas notas y esta referencia a la respuesta para este coordinador.'),exact:true}).check();await button('Approve request','Aprobar solicitud').click();await page.getByText(question,{exact:true}).waitFor();assert.equal(submits,1);
   delivered=true;await page.evaluate(()=>window.viewStaff());await page.getByRole('button',{name:new RegExp(t('^View requests','^Ver solicitudes'))}).click();await page.locator('.coordinator-review-row').click();await page.locator('.review-request-related').getByText(original,{exact:false}).waitFor();assert.equal(await page.getByText('RESPONSE_BODY_NOT_ATTACHED',{exact:true}).count(),0);await page.screenshot({path:`${output}/${width}-${language}-coordinator.png`,fullPage:true});
   await button('View original request','Ver solicitud original').click();await page.locator('.coordinator-review-question').filter({hasText:original}).waitFor();
   await page.evaluate(()=>window.viewStudent());await preview();changed=true;await page.waitForFunction(()=>!document.querySelector('.review-request-approval'),{},{timeout:12000});assert.equal(submits,1);assert.equal(drafts.length,2);
   await page.evaluate(()=>window.viewStaff());await page.getByRole('button',{name:new RegExp(t('^View requests','^Ver solicitudes'))}).click();assert.equal(await page.locator('.coordinator-review-row').count(),0);
   assert.equal(calls.some(c=>c.path==='/api/plans'||c.path==='/api/profile-voice'),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);results.push({width,language,passed:true});
  }catch(error){await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true});console.error(JSON.stringify({width,language,errors,calls:calls.map(c=>[c.path,c.action])}));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
 await writeFile(`${output}/results.json`,JSON.stringify({kind:'review-response-followups-browser-verification',schemaVersion:1,syntheticTransport:true,passed:results.length===6,journeys:results},null,2));console.log(JSON.stringify({passed:results.length,output}));
})().catch(e=>{console.error(e);process.exitCode=1;});
