// Real workspace, intercepted synthetic APIs. Never reads or writes live binders.
const {createRequire}=require('node:module'),{mkdir}=require('node:fs/promises'),assert=require('node:assert/strict');
const resolve=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'),{chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/binder-transitions',{recursive:true});
 try{for(const [width,language,motion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:motion}),errors=[];
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  const t=(en,es)=>language==='es'?es:en;let readGate;
  const binder={id:'binder-4',studentName:'Alex Rivera',publicationId:'publication',version:1,publishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer'],isNew:false,helpRequested:false,entries:Array.from({length:8},(_,i)=>({id:'entry-'+i,topic:'transfer',kind:'note',language:'en',content:'We discussed transfer planning and balancing my science classes with work. I want to bring a course list to my next advising appointment.'}))};
  const binders=Array.from({length:12},(_,i)=>({...binder,id:'binder-'+i,studentName:i===4?'Alex Rivera':`Synthetic student ${i+1}`}));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"const auth={user:{sub:'synthetic-transition'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>'synthetic'};export function useAuth0(){return auth}"});
   if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.fulfill({body:''});
   const input=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-access'){
    if(input.action==='overview')data={organizations:[{id:'org',name:'Test Organization',role:'outreach',pilotStatus:'active',profile:{id:'profile',status:'active',displayName:'Test Coordinator'}}]};
    if(input.action==='profile')data={profile:{displayName:'Test Coordinator',organizationName:'Test Organization'}};
   }
   if(url.pathname==='/api/coordinator-binders'){
    if(input.action==='list')data={binders,counts:{all:12,new:0,help:0},nextCursor:null};
    if(input.action==='read'){if(readGate)await readGate;data=binder;}
   }
   if(url.pathname==='/api/coordinator-feedback')data={feedback:[],writesEnabled:true};
   assert.ok(data,`Unexpected synthetic request ${url.pathname}/${input.action}`);return route.fulfill({json:data});
  });
  await page.route('**/binder-transition-preview',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import Workspace from '/src/CoordinatorWorkspace.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';
   browserPrivacy.start('synthetic-transition',{fresh:true});setAPITokenProvider(async()=>'synthetic');localStorage.setItem('origen.language','${language}');
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Workspace)));
  </script></html>`}));
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const waitScene=()=>page.waitForFunction(()=>!document.querySelector('.coordinator-binders')?.hasAttribute('data-binder-transition'));
  const sample=()=>page.evaluate(()=>{
   window.motionFrames=[];window.recordMotion=true;
   const frame=()=>{const el=document.querySelector('.coordinator-binders');if(!window.recordMotion||!el)return;
    window.motionFrames.push({binder:!!el.querySelector('.coordinator-shared-binder'),opacity:Number(getComputedStyle(el).opacity),x:el.getBoundingClientRect().x,scrollY,inert:el.inert});requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const frames=()=>page.evaluate(()=>{window.recordMotion=false;return window.motionFrames;});
  try{
   await page.goto(origin+'/binder-transition-preview');await page.locator('.coordinator-welcome').waitFor();await settle();
   const menu=page.locator('.coordinator-menu-toggle');if(await menu.isVisible())await menu.click();
   await page.getByRole('navigation',{name:t('Coordinator navigation','Navegación del coordinador')}).getByRole('button',{name:t('Shared binders','Carpetas compartidas'),exact:true}).click();
   const card=page.locator('[data-binder-id="binder-4"]');await card.waitFor();await settle();
   await card.scrollIntoViewIfNeeded();const listScroll=await page.evaluate(()=>scrollY);
   await sample();await card.click();await page.locator('.shared-binder-reading').waitFor();await waitScene();await settle();
   const opening=await frames();
   if(motion!=='reduce'){
    assert.ok(opening.some(f=>!f.binder&&f.opacity>0&&f.opacity<.95),'List disappeared without fading out');
    assert.ok(opening.find(f=>f.binder).opacity<.2,'Binder appeared before the outgoing scene was hidden');
    assert.ok(opening.some(f=>f.binder&&f.opacity>0&&f.opacity<.95),'Binder did not ease into view');
   }else assert.ok(opening.every(f=>!f.inert),'Reduced motion delayed navigation');
   await page.screenshot({path:`output/playwright/binder-transitions/${width}-open.png`});
   await page.locator('.shared-paper-footer').scrollIntoViewIfNeeded();await settle();
   const close=page.getByRole('button',{name:t('Close binder','Cerrar carpeta'),exact:true});
   await sample();await close.click();await card.waitFor();await waitScene();await settle();
   const closing=await frames();
   if(motion!=='reduce'){
    assert.ok(closing.some(f=>f.binder&&f.opacity>0&&f.opacity<.95),'Paper disappeared without a closing transition');
    assert.ok(closing.find(f=>!f.binder).opacity<.2,'List replacement was visible before the binder faded');
   }
   assert.ok(Math.abs(await page.evaluate(()=>scrollY)-listScroll)<2,'Closing lost the list scroll position');
   assert.equal(await card.evaluate(el=>el===document.activeElement),true,'Closing lost the originating card focus');
   assert.equal(await card.evaluate(el=>el.getAnimations().length),0,'List replayed its entrance after the scene completed');
   await page.screenshot({path:`output/playwright/binder-transitions/${width}-closed.png`});
   // Close while the read is pending; its eventual response cannot reopen paper.
   let release;readGate=new Promise(resolve=>{release=resolve;});
   await card.click();await page.locator('.shared-binder-placeholder').waitFor();await close.click();await card.waitFor();
   const returned=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-binders')&&r.request().postDataJSON().action==='read');
   release();readGate=undefined;await (await returned).finished();await waitScene();
   assert.equal(await page.locator('.coordinator-shared-binder').count(),0,'Late loading reopened a closed binder');
   // Opening immediately after closing interrupts the incoming list motion cleanly.
   await card.click();await page.locator('.shared-binder-reading').waitFor();await close.click();await card.waitFor();await card.click();
   await page.locator('.shared-binder-reading').waitFor();await waitScene();await settle();
   assert.equal(await page.locator('.coordinator-binders').evaluate(el=>el.inert||Number(getComputedStyle(el).opacity)<1),false,'Interrupted motion left a hidden or inert workspace');
   await close.click();await card.waitFor();await waitScene();await settle();
   if(motion!=='reduce'){
    // A privacy interruption cancels a pending navigation, without an old snapshot.
    await card.click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await page.locator('.coordinator-binder-list button').waitFor({state:'detached'});
    assert.equal(await page.locator('.coordinator-binders').evaluate(el=>el.inert),false);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.shared-binder-reading').count(),0,'A cancelled transition restored private paper');
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Transition caused horizontal overflow');
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}/${language}/${motion}: phased open/close, deep-scroll return, card focus, no replay, slow reads, rapid reversal and privacy cancellation.`);
  }finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
