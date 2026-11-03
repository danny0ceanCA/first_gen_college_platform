// Actual React/CSS, synthetic account transport. No provider or production data.
const {chromium}=require('playwright');
const {mkdir,writeFile}=require('node:fs/promises');
const assert=require('node:assert/strict');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5187',output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-followup-step4-browser';
assert.equal(new URL(origin).hostname,'127.0.0.1');
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']}),journeys=[];
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:1050},timezoneId:'America/Chicago'}),t=(en,es)=>language==='es'?es:en,errors=[],calls=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  let reports=[],preview,drop=false,enabled=true;const target={planId:'00000000-0000-4000-8000-000000000001',stepId:'call'};
  const snapshot=()=>({enabled,canSave:true,planVersion:1,reports});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:'export function useAuth0(){return {user:{sub:"synthetic"},isAuthenticated:true}}'});
   if(url.pathname==='/api/recommendation-evaluation')return route.fulfill({json:{enabled:false,organizations:[],permission:null}});
   if(url.pathname==='/api/recommendations')return route.fulfill({json:{enabled:false}});
   if(url.pathname.startsWith('/api/')){
    const body=route.request().postDataJSON();calls.push({path:url.pathname,...body});assert.equal(body.studentId,'alex');let result=snapshot();
    if(url.pathname==='/api/outcome-evidence')return route.fulfill({json:{enabled:false,canRecord:false,episodes:[],evidence:[]}});
    if(url.pathname==='/api/student-follow-up-report'){
     if(body.action==='prepare'){assert.equal(body.planVersion,1);assert.deepEqual(body.target,target);preview={id:body.operationId,digest:'a'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),kind:'report',language,action:{title:t('Call the insurance office','Llamar a la oficina de seguros'),content:'Ask for required proof.'},payload:body.payload};result={preview};}
     else if(body.action==='confirm'){
      assert.equal(body.confirmed,true);assert.equal(body.digest,preview.digest);const p=preview.payload,r=p.report;
      const saved={id:p.reportId||'00000000-0000-4000-8000-000000000002',version:(p.reportVersion||0)+1,response_state:r.responseState,reported_action:r.reportedAction,reported_outcome:r.reportedOutcome,detail:r.detail,helpfulness:r.helpfulness,occurred_on:r.occurredOn,time_zone:r.timeZone,recorded_at:new Date().toISOString()};reports=[saved];result={status:'saved',kind:'report'};
      if(drop){drop=false;return route.abort('failed');}
     }else assert.equal(body.action,'load');
    }else if(url.pathname==='/api/student-follow-up'){assert.equal(body.action,'delete-report');assert.equal(body.reportId,reports[0].id);assert.equal(body.revision,reports[0].version);reports=[];}
    else throw Error('Unexpected private disclosure path '+url.pathname);
    return route.fulfill({json:result});
   }
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
   if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.route('**/private-update-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:16px;background:#f5f5ee"><main style="max-width:720px;margin:auto"><div id="root"></div></main><script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {PrivateFollowUpUpdates} from '/src/PrivateFollowUpUpdates.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';
browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');window.endPrivacy=()=>browserPrivacy.stop('logout');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(PrivateFollowUpUpdates,{studentId:'alex',target:${JSON.stringify(target)},planVersion:1,language:${JSON.stringify(language)},t:(en,es)=>${JSON.stringify(language)}==='es'?es:en}));</script></body></html>`}));
  const button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true}),label=(en,es)=>page.getByLabel(t(en,es),{exact:true}),review=()=>page.getByRole('region',{name:t('Review private update','Revisar actualización privada'),exact:true});
  try{
   await page.goto(origin+'/private-update-smoke');await button('My private updates','Mis actualizaciones privadas').click();await button('Write a private update','Escribir una actualización privada').click();
   const detail=t('I called. They still need a letter from my employer.','Llamé. Todavía necesitan una carta de mi empleador.');
   await label('In my own words','En mis propias palabras').fill(detail);await label('My action','Mi acción').selectOption('completed');await label('What happened with the issue','Qué pasó con el asunto').selectOption('pending');await label('Action progress','Progreso de la acción').selectOption('complete');
   await button('Review my update','Revisar mi actualización').click();await review().waitFor();assert.equal(reports.length,0);assert.match(await review().innerText(),language==='es'?/no está verificado/:/not verified/);assert.ok((await review().innerText()).includes(detail));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${output}/${width}-${language}-review.png`,fullPage:true});
   await button('Save this private update','Guardar esta actualización privada').click();await button('Correct update','Corregir actualización').waitFor();assert.equal(reports[0].reported_outcome,'pending');assert.equal(reports[0].helpfulness,null);assert.equal(calls.find(c=>c.action==='prepare').payload.planStatus,'complete');
   await button('Correct update','Corregir actualización').click();const correction=t('I emailed, and I am still waiting.','Envié un correo y aún espero respuesta.');await label('In my own words','En mis propias palabras').fill(correction);await label('My action','Mi acción').selectOption('attempted');await button('Review my update','Revisar mi actualización').click();await review().waitFor();
   drop=true;await button('Save this private update','Guardar esta actualización privada').click();await button('Check saved updates','Consultar actualizaciones guardadas').waitFor();assert.equal(reports.length,1);assert.equal(reports[0].version,2);
   const confirms=calls.filter(c=>c.action==='confirm').length;await button('Check saved updates','Consultar actualizaciones guardadas').click();await page.getByText(correction,{exact:true}).waitFor();assert.equal(calls.filter(c=>c.action==='confirm').length,confirms);assert.equal(await page.getByText(detail,{exact:true}).count(),0);
   await page.screenshot({path:`${output}/${width}-${language}-saved.png`,fullPage:true});
   await button('Correct update','Corregir actualización').click();await button('Review my update','Revisar mi actualización').click();await review().waitFor();await page.context().setOffline(true);await page.waitForFunction(()=>!document.querySelector('.follow-up-review'));await page.context().setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await button('Cancel','Cancelar').click();
   await button('Correct update','Corregir actualización').click();await button('Review my update','Revisar mi actualización').click();await review().waitFor();
   enabled=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!document.querySelector('.private-update-form')&&!document.querySelector('.follow-up-review'));await button('Delete update','Eliminar actualización').waitFor();await button('Delete update','Eliminar actualización').click();await page.waitForFunction(()=>!document.querySelector('.private-follow-up'));assert.equal(reports.length,0);
   enabled=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.private-follow-up').waitFor();await page.evaluate(()=>window.endPrivacy());await page.waitForFunction(()=>!document.querySelector('.private-follow-up'));assert.deepEqual(errors,[]);
   assert.ok(calls.every(c=>['/api/student-follow-up-report','/api/student-follow-up','/api/outcome-evidence'].includes(c.path)));journeys.push({width,language,passed:true});
  }catch(e){await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true});console.error({width,language,errors,actions:calls.map(c=>c.action)});throw e;}finally{await page.close();}
 }}finally{await browser.close();}
 await writeFile(`${output}/results.json`,JSON.stringify({kind:'private-follow-up-browser-verification',schemaVersion:1,syntheticTransport:true,passed:journeys.length===6,journeys},null,2));console.log(JSON.stringify({passed:journeys.length,output}));
})().catch(e=>{console.error(e);process.exitCode=1;});
