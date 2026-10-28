// Exercise the actual sharing, connection, login and admin dialogs. No live API traffic.
const {createRequire}=require('node:module'),assert=require('node:assert/strict');
const {chromium}=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json')('playwright');
const origin='http://127.0.0.1:5173';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const [width,language] of [[1280,'en'],[390,'es'],[320,'en']]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en;
  const entry={id:'entry',topic:'transfer',kind:'note',language:'en',content:'Alex is comparing environmental science programs and wants to check how biology and statistics will transfer.'};
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`export function useAuth0(){return {user:{sub:'synthetic'},isAuthenticated:false,isLoading:false,getAccessTokenSilently:async()=>'synthetic',loginWithRedirect:async()=>{}}}`});
   if(u.pathname.startsWith('/api/')){
    const body=route.request().postDataJSON()||{};let data={available:true,connections:[]};
    if(u.pathname==='/api/binder-sharing'){
     if(body.action==='status')data={available:true,enabled:true,connections:[{id:'connection',coordinatorName:'Jordan',organizationName:'Community Center'}],grants:[]};
     else if(body.action==='entries')data={entries:[entry]};
     else if(body.action==='preview')data={previewId:'preview',studentName:'Alex',coordinatorName:'Jordan',organizationName:'Community Center',topics:['transfer'],entries:[entry],message:body.message,requestHelp:body.requestHelp,expiresAt:new Date(Date.now()+120000).toISOString(),shareExpiresAt:new Date(Date.now()+86400000).toISOString()};
     else if(body.action==='cancel'){await new Promise(resolve=>setTimeout(resolve,250));data={ok:true};}else writes.push(body.action);
    }
    if(u.pathname==='/api/coordinator-connections'&&body.action==='cancel'){writes.push('cancel-connection');await new Promise(resolve=>setTimeout(resolve,700));data={status:'cancelled'};}
    if(u.pathname==='/api/admin')return route.fulfill({status:503,json:{error:'synthetic_unavailable'}});
    return route.fulfill({json:data});
   }
   return u.origin===origin?route.continue():route.fulfill({body:''});
  });
  await page.route('**/dialog-integration',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import Sharing from '/src/BinderSharing.tsx';import {CoordinatorConfirm} from '/src/CoordinatorConnection.tsx';import Drawer from '/src/AdminUserDrawer.tsx';import Landing from '/src/Landing.tsx';
   import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';import '/src/admin.css';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');const h=React.createElement,t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   function App(){const [view,setView]=React.useState('sharing'),[open,setOpen]=React.useState(false);return h('main',{style:{padding:24}},h('nav',null,...['sharing','connection','admin','login'].map(name=>h('button',{key:name,onClick:()=>{setView(name);setOpen(false)}},name))),view==='sharing'?h(Sharing,{studentId:'alex',t}):view==='login'?h(Landing):h('button',{onClick:()=>setOpen(true)},'Open details'),open&&(view==='admin'?h(Drawer,{id:'synthetic',days:30,revision:0,onClose:()=>setOpen(false),onDenied:()=>setOpen(false)}):h(CoordinatorConfirm,{card:{contextId:'context',sequence:0,challengeId:'challenge',expiresAt:new Date(Date.now()+120000).toISOString(),studentName:'Alex',coordinator:{id:'jordan',name:'Jordan',organization:'Community Center',role:'coordinator'}},t,onClose:()=>setOpen(false),onSent:()=>{}})));}
   ReactDOM.createRoot(document.getElementById('root')).render(h(React.StrictMode,null,h(App)));
  </script></html>`}));
  try{
   await page.goto(origin+'/dialog-integration');
   await page.getByRole('button',{name:t('Share binder','Compartir carpeta'),exact:true}).click();
   const sheet=page.locator('dialog.binder-share-sheet');await sheet.waitFor();
   await sheet.locator('.binder-share-choices input').check();
   await sheet.getByRole('textbox').fill(t('Please help me compare these courses.','Ayúdame a comparar estos cursos.'));
   await sheet.getByRole('button',{name:t('Review & share','Revisar y compartir'),exact:true}).click();
   const review=page.locator('section.binder-share-review');await review.waitFor();assert.equal(await page.locator('dialog[open]').count(),1,'Sharing review must stay in one sheet');
   assert.equal(await review.locator('.binder-share-preview-entries p').textContent(),entry.content);
   await review.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
   await page.screenshot({path:`output/playwright/phase3-design-system/${width}-sharing-review.png`});
   await page.keyboard.press('Escape');await review.waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
   await page.waitForFunction(()=>document.activeElement===document.querySelector('.binder-share-footer button'));
   assert.deepEqual(writes,[]);
   assert.equal(await sheet.getByRole('textbox').inputValue(),t('Please help me compare these courses.','Ayúdame a comparar estos cursos.'));
   await sheet.getByRole('button',{name:t('Review & share','Revisar y compartir'),exact:true}).click();await review.waitFor();
   await review.getByRole('button',{name:t('Share these notes','Compartir estas notas'),exact:true}).click();await review.waitFor({state:'detached'});
   await sheet.getByRole('status').filter({hasText:t('Your notes are shared.','Tus notas están compartidas.')}).waitFor();
   assert.ok(await page.locator('#binder-share-title').evaluate(el=>el===document.activeElement));
   await sheet.getByRole('button',{name:t('Close sharing','Cerrar acceso'),exact:true}).click();await sheet.waitFor({state:'detached'});assert.deepEqual(writes,['publish']);
   await page.getByRole('button',{name:'connection',exact:true}).click();await page.getByRole('button',{name:'Open details'}).click();
   const confirmation=page.locator('dialog.connection-confirm');await confirmation.waitFor();await confirmation.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.keyboard.press('Escape');
   await page.getByRole('button',{name:t('Sending…','Enviando…'),exact:true}).waitFor();assert.equal(await confirmation.evaluate(el=>getComputedStyle(el).opacity),'1','Pending cancellation must stay visible');
   await confirmation.waitFor({state:'detached'});assert.deepEqual(writes,['publish','cancel-connection']);
   await page.getByRole('button',{name:'admin',exact:true}).click();await page.getByRole('button',{name:'Open details'}).click();
   await page.locator('dialog.admin-user-drawer').waitFor();await page.getByRole('button',{name:'Close account details'}).click();await page.locator('dialog.admin-user-drawer').waitFor({state:'detached'});
   assert.ok(await page.getByRole('button',{name:'Open details'}).evaluate(el=>el===document.activeElement));
   await page.getByRole('button',{name:'login',exact:true}).click();await page.locator('.landing-login').click();await page.locator('dialog.landing-auth-dialog').waitFor();
   await page.locator('dialog.landing-auth-dialog').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
   if(width>600)assert.ok((await page.locator('dialog.landing-auth-dialog').boundingBox()).width<=460,'Login dialog grew wider than its content');
   await page.screenshot({path:`output/playwright/phase3-design-system/${width}-login.png`});
   await page.keyboard.press('Escape');await page.locator('dialog.landing-auth-dialog').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.deepEqual(errors,[]);
   console.log(`PASS ${width}/${language}: single-sheet sharing preview/cancel/publish, retained draft and focus, connection cancellation, admin close/focus, login close.`);
  }catch(error){console.error({errors,body:(await page.locator('body').innerText()).slice(0,1500)});throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
