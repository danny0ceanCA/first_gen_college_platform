// Real binder/coordinator controls, synthetic auth/API; no provider calls.
const {chromium}=require('playwright');
const {mkdir,writeFile}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5187',output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-followup-step5-browser';
assert.equal(new URL(origin).hostname,'127.0.0.1');
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']}),journeys=[];
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),t=(en,es)=>language==='es'?es:en,errors=[],calls=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const source={kind:'review-response',requestId:randomUUID(),responseVersion:1},connection=randomUUID(),org=randomUUID(),now=new Date().toISOString(),recipient={connectionId:connection,coordinatorName:'Maria Rivera',organizationName:'Community College'},target={planId:randomUUID(),stepId:'call'};
  const wording=t('I called the office and am waiting for a reply.','Llamé a la oficina y espero una respuesta.'),edited=t('I emailed the office and am waiting for a reply.','Escribí a la oficina y espero una respuesta.'),original=t('What proof of insurance do I need?','¿Qué comprobante de seguro necesito?');
  let reports=[{id:randomUUID(),version:1,response_state:'answered',reported_action:'completed',reported_outcome:'pending',detail:wording,helpfulness:'PRIVATE_RATING_NOT_SHARED',occurred_on:null,time_zone:'America/Chicago',recorded_at:now}],changed=false,drop=true,delivered=false,submits=0;
  const drafts=[],previews=new Map(),related=()=>changed?{availability:'unavailable',source:null,responseVersion:1}:{availability:'current',source,responseVersion:1,question:original,coordinatorName:recipient.coordinatorName,respondedAt:now};
  const parent=()=>({id:source.requestId,version:2,studentId:'alex',status:'submitted',originalQuestion:original,proposedClarification:'',kind:'question',language,createdAt:now,submittedAt:now,recipient,entries:[],publication:{id:randomUUID(),wording:'original',access:'active',notification:'delivered',expiresAt:'2099-01-01T00:00:00Z'},coordinatorReview:{response:{version:changed?2:1,status:'available',guidance:'PRIVATE_RESPONSE_BODY',suggestedAction:'',resourceUrl:'',followUpOn:null,updatedAt:now}}});
  const record=d=>({...d,relatedResponse:related(),...(d.publication?{publication:{...d.publication,notification:delivered?'delivered':'pending'}}:{})});
  const response=(route,status,data)=>route.fulfill({status,json:data});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"export function useAuth0(){return {user:{sub:'synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=> 'synthetic'}}"});
   if(url.pathname==='/api/recommendations')return route.fulfill({json:{enabled:false}});
    if(url.pathname==='/api/recommendation-evaluation')return route.fulfill({json:{enabled:false,organizations:[],permission:null}});
    if(url.pathname.startsWith('/api/')){
    const b=route.request().postDataJSON();calls.push({path:url.pathname,...b});
    if(url.pathname==='/api/outcome-evidence')return response(route,200,{enabled:false,canRecord:false,episodes:[],evidence:[]});
    if(url.pathname==='/api/student-follow-up-report')return response(route,200,{enabled:true,canSave:true,planVersion:1,reports});
    if(url.pathname==='/api/review-response-choices')return response(route,200,{enabled:true,available:true,canFollowUp:!changed,acceptedActionCount:0,choice:{state:'available',revision:0,reviewOn:null,shouldOffer:true}});
    if(url.pathname==='/api/review-requests'){
     const d=drafts.find(x=>x.id===b.id);
     if(b.action==='list')return response(route,200,{enabled:true,available:true,deliveryEnabled:true,studentUpdatesEnabled:true,requests:[...drafts].reverse().map(record),activity:[],nextCursor:null});
     if(b.action==='options')return response(route,200,{connections:[{id:connection,...recipient},{id:randomUUID(),coordinatorName:'Other coordinator',organizationName:'Other college'}],entries:[]});
     if(b.action==='get')return response(route,200,{request:d?record(d):parent()});
     if(b.action==='create'){
      assert.equal(b.kind,'student-update');assert.deepEqual(b.relatedResponse,source);assert.equal(b.connectionId,connection);assert.deepEqual(b.entries,[]);assert.doesNotMatch(JSON.stringify(b),/PRIVATE_RATING|PRIVATE_RESPONSE|reported_action|reported_outcome|reportId/);
      const existing=drafts.find(x=>x.requestKey===b.requestKey);if(existing)return response(route,200,{request:record(existing)});
      const next={...b,id:randomUUID(),version:1,status:'draft',createdAt:new Date(Date.now()+drafts.length*1000).toISOString(),submittedAt:null,recipient,publication:null};drafts.push(next);return response(route,200,{request:record(next)});
     }
     if(b.action==='preview'){
      if(changed)return response(route,409,{error:'review_request_source_changed'});
      const p={id:randomUUID(),digest:'a'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),accessExpiresAt:'2099-01-01T00:00:00Z',selection:{kind:'student-update',question:d.originalQuestion,studentName:'Alex',coordinatorName:recipient.coordinatorName,organizationName:recipient.organizationName,language,entries:[],relatedResponse:related()}};previews.set(p.id,p);return response(route,200,{preview:p});
     }
     if(b.action==='submit'){
      assert.equal(changed,false);assert.equal(b.confirmed,true);assert.equal(b.digest,previews.get(b.previewId)?.digest);assert.equal(d.status,'draft');submits++;d.status='submitted';d.version=2;d.submittedAt=now;d.publication={id:randomUUID(),wording:'original',access:'active',notification:'pending',expiresAt:'2099-01-01T00:00:00Z'};
      if(drop){drop=false;return route.abort('failed');}return response(route,200,{request:record(d)});
     }
    }
    if(url.pathname==='/api/coordinator-review-requests'){
     const available=delivered&&!changed?drafts.filter(d=>d.status==='submitted'):[],row=d=>({id:d.id,publicationId:d.publication.id,studentName:'Alex',kind:'student-update',submittedAt:now,expiresAt:'2099-01-01T00:00:00Z',openedAt:null,reviewedAt:null,responseStatus:'none',response:null,question:d.originalQuestion,language,entries:[],relatedResponse:related()});
     if(b.action==='list')return response(route,200,{enabled:true,requests:available.map(row),nextCursor:null});
     if(b.action==='read')return available.some(d=>d.id===b.id)?response(route,200,row(available.find(d=>d.id===b.id))):response(route,404,{error:'review_unavailable'});
    }
    return response(route,503,{error:'unexpected_path'});
   }
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.route('**/shared-update-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {StudentReviewRequestsProvider,StudentReviewRequests} from '/src/StudentReviewRequests.tsx';import {PrivateFollowUpUpdates} from '/src/PrivateFollowUpUpdates.tsx';import CoordinatorReviewRequests from '/src/CoordinatorReviewRequests.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {apiFetch,setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/PersonalBinder.css';
browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
const request=async body=>{const r=await apiFetch('/api/coordinator-review-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
function App(){const [staff,setStaff]=React.useState(false);window.viewStaff=()=>setStaff(true);window.viewStudent=()=>setStaff(false);return React.createElement('main',{style:{maxWidth:'850px',margin:'16px auto',padding:'12px'}},staff?React.createElement(CoordinatorReviewRequests,{organizationId:${JSON.stringify(org)},t,es:${language==='es'},request}):React.createElement(StudentReviewRequestsProvider,{studentId:'alex',language:${JSON.stringify(language)},t},React.createElement(PrivateFollowUpUpdates,{studentId:'alex',source:${JSON.stringify(source)},target:${JSON.stringify(target)},planVersion:1,language:${JSON.stringify(language)},t}),React.createElement(StudentReviewRequests)));}ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`}));
  const button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true}),approval=()=>page.getByRole('checkbox',{name:t('I approve this exact update, these notes and this response reference for this coordinator.','Apruebo esta actualización exacta, estas notas y esta referencia a la respuesta para este coordinador.'),exact:true});
  const share=async()=>{await page.getByRole('button',{name:new RegExp(t('^My private updates','^Mis actualizaciones privadas'))}).click();await page.locator('.private-follow-up').getByRole('button',{name:t('Share an update','Compartir una actualización'),exact:true}).click();};
  try{
   await page.goto(origin+'/shared-update-smoke');await share();assert.equal(await page.getByRole('combobox',{name:t('My coordinator','Mi coordinador'),exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('textbox',{name:t('In my own words','Con mis propias palabras'),exact:true}).inputValue(),wording);await button('Preview request','Ver solicitud').click();await approval().waitFor();assert.equal(submits,0);await approval().check();
   await button('Edit before sharing','Editar antes de compartir').click();await page.getByRole('textbox',{name:t('In my own words','Con mis propias palabras'),exact:true}).fill(edited);await button('Preview request','Ver solicitud').click();await approval().waitFor();assert.equal(await approval().isChecked(),false);assert.equal(await button('Approve request','Aprobar solicitud').isDisabled(),true);
   assert.equal(await page.locator('dialog').getByText('PRIVATE_RESPONSE_BODY',{exact:true}).count(),0);await page.screenshot({path:`${output}/${width}-${language}-preview.png`,fullPage:true});await approval().check();await button('Approve request','Aprobar solicitud').click();await button('Check saved request','Comprobar solicitud guardada').click();assert.equal(submits,1);
   reports=[{...reports[0],version:2,detail:'LATER_PRIVATE_CORRECTION'}];delivered=true;await page.evaluate(()=>window.viewStaff());await page.getByRole('button',{name:new RegExp(t('^View requests','^Ver solicitudes'))}).click();await page.locator('.coordinator-review-row').click();await page.locator('.coordinator-review-question').filter({hasText:edited}).waitFor();assert.equal(await page.getByText('LATER_PRIVATE_CORRECTION',{exact:true}).count(),0);await page.getByText(t('Student-reported update · Not institution-verified.','Actualización reportada por el estudiante · No verificada por la institución.'),{exact:false}).waitFor();await page.screenshot({path:`${output}/${width}-${language}-coordinator.png`,fullPage:true});
   await page.evaluate(()=>window.viewStudent());await share();await button('Preview request','Ver solicitud').click();await approval().waitFor();changed=true;await page.waitForFunction(()=>!document.querySelector('.review-request-approval'),{},{timeout:12000});assert.equal(submits,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.equal(calls.some(c=>c.path==='/api/plans'||c.path==='/api/profile-voice'),false);journeys.push({width,language,passed:true});
  }catch(error){await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true});console.error(JSON.stringify({width,language,errors,calls:calls.map(c=>[c.path,c.action])}));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
 await writeFile(`${output}/results.json`,JSON.stringify({kind:'student-shared-update-browser-verification',schemaVersion:1,syntheticTransport:true,passed:journeys.length===6,journeys},null,2));console.log(JSON.stringify({passed:journeys.length,output}));
})().catch(e=>{console.error(e);process.exitCode=1;});
