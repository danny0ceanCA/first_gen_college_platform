// Local browser rendering/interaction checks with synthetic sharing responses.
// Database authorization and snapshot equality are tested separately on PostgreSQL.
const {createRequire}=require('node:module'),{mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'output/playwright/student-first-phase7';
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const t=(en,es)=>language==='es'?es:en;
  const entry={id:'11111111-1111-4111-8111-111111111111',topic:'options',kind:'note',language,content:t('From a student conversation summary; not a verbatim quote. Tentative, not a decision: Maybe nursing would be a good fit.','De un resumen de conversación con el estudiante; no es una cita literal. Posibilidad, no una decisión: Tal vez estudiar enfermería sería una buena opción.')};
  const connectionId='22222222-2222-4222-8222-222222222222',grantId='33333333-3333-4333-8333-333333333333',previewId='44444444-4444-4444-8444-444444444444';
  let published=false,stale=false,publishCalls=0,reviewed=[];
  await page.route('**/api/binder-sharing',async route=>{
   const body=route.request().postDataJSON();let data;
   if(body.action==='status')data={available:true,enabled:true,connections:[{id:connectionId,coordinatorName:'Jordan',organizationName:'Community Pilot'}],grants:published?[{id:grantId,status:'active',coordinatorName:'Jordan',organizationName:'Community Pilot',topics:['options'],expiresAt:new Date(Date.now()+86400000).toISOString(),items:[entry]}]:[]};
   if(body.action==='entries')data={entries:[entry]};
   if(body.action==='preview'){assert.deepEqual(body.entryIds,[entry.id]);reviewed=[entry];data={previewId,studentName:'Alex',coordinatorName:'Jordan',organizationName:'Community Pilot',topics:['options'],entries:reviewed,expiresAt:new Date(Date.now()+120000).toISOString(),shareExpiresAt:new Date(Date.now()+86400000).toISOString()};}
   if(body.action==='publish'){publishCalls++;assert.equal(body.confirmed,true);assert.equal(body.previewId,previewId);if(stale){stale=false;return route.fulfill({status:409,json:{error:'sharing_changed'}});}published=true;data={status:'published'};}
   if(body.action==='cancel')data={status:'cancelled'};
   if(body.action==='revoke-all'||body.action==='revoke'||body.action==='withdraw'){published=false;data={status:'withdrawn'};}
   assert.ok(data,body.action);await route.fulfill({json:data});
  });
  await page.route('**/phase7-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:12px;font-family:system-ui"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import Sharing from '/src/BinderSharing.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');window.testPrivacy=browserPrivacy;
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Sharing,{studentId:'alex',t:(en,es)=>${JSON.stringify(language)}==='es'?es:en}));
  </script></body></html>`}));
  try{
   await page.goto(origin+'/phase7-review');
   await page.getByRole('button',{name:t('People with access','Personas con acceso'),exact:true}).click();
   const choose=async()=>{
    await page.getByRole('combobox').selectOption(connectionId);
    await page.getByRole('checkbox',{name:t('College options','Opciones universitarias'),exact:true}).check();
    await page.locator('.binder-share-choices input').check();
    await page.getByRole('button',{name:t('Review selected entries (1/50)','Revisar notas seleccionadas (1/50)'),exact:true}).click();
    await page.getByRole('dialog').waitFor();assert.equal(published,false);assert.equal(await page.locator('.binder-share-preview-entries p').textContent(),entry.content);
   };
   await choose();assert.equal(publishCalls,0);
   if(process.env.ORIGEN_SMOKE_ACCESSIBILITY==='true'){
    const dialog=page.getByRole('dialog',{name:t('Your selected pages','Tus páginas seleccionadas'),exact:true});await dialog.waitFor();
    assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'native sharing review receives focus');
    const cancel=dialog.getByRole('button',{name:t('Cancel','Cancelar'),exact:true});await cancel.focus();await page.keyboard.press('Tab');
    assert.ok(await dialog.getByRole('button',{name:t('Publish these entries','Publicar estas notas'),exact:true}).evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Shift+Tab');assert.ok(await cancel.evaluate(el=>el===document.activeElement));
   }
   if(width===320)await page.screenshot({path:`${output}/${width}-${language}-preview.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(process.env.ORIGEN_SMOKE_ACCESSIBILITY==='true')await page.keyboard.press('Escape');else await page.getByRole('button',{name:t('Cancel','Cancelar'),exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(publishCalls,0);
   await choose();stale=true;
   await page.getByRole('button',{name:t('Publish these entries','Publicar estas notas'),exact:true}).click();
   await page.getByRole('alert').waitFor();assert.equal(published,false);
   assert.equal(await page.getByRole('button',{name:t('Publish these entries','Publicar estas notas'),exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:t('Close review and check sharing','Cerrar revisión y comprobar acceso'),exact:true}).click();
   await page.getByRole('dialog').waitFor({state:'detached'});await choose();
   await page.getByRole('button',{name:t('Publish these entries','Publicar estas notas'),exact:true}).click();
   await page.locator('.binder-share-current').waitFor();assert.equal(await page.locator('.binder-share-current p').textContent(),reviewed[0].content);
   await page.getByRole('button',{name:t('Stop all sharing','Dejar de compartir todo'),exact:true}).click();await page.locator('.binder-share-current').waitFor({state:'detached'});assert.equal(published,false);
   await choose();await page.evaluate(()=>window.testPrivacy.stop());await page.getByRole('dialog').waitFor({state:'detached'});
   assert.ok(!(await page.locator('body').textContent()).includes(entry.content));
   const storage=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));assert.ok(!storage.includes('nursing')&&!storage.includes('enfermería'));
   assert.deepEqual(errors,[]);count++;console.log(`PASS ${width}/${language}: explicit selection, exact attributed preview, cancel, stale rejection, publish, stop sharing, logout clear, no persistent text.`);
  }finally{await page.close();}
 }}finally{await browser.close();}
 console.log(`Passed ${count} synthetic sharing browser journeys.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
