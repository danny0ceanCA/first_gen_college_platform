// Real arrival and workspace components with synthetic, intercepted APIs only.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {mkdir}=require('node:fs/promises');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/coordinator-motion',{recursive:true});
 try{for(const [width,language,reducedMotion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  let overviewGate=gate(),listGate,readGate,deny=false;
  const t=(en,es)=>language==='es'?es:en;
  const binder={id:'motion-grant',studentName:'Alex Rivera (Test)',publicationId:'motion-publication',version:1,publishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer'],isNew:false,helpRequested:false,message:'Could you help me review my plan for next semester?',entries:[{id:'motion-entry',topic:'transfer',kind:'note',language:'en',content:'We talked about transferring into public health. I want to compare the courses I still need with my work schedule before choosing next semester’s classes.'}]};
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'motion-test'},getAccessTokenSilently:async()=>'synthetic',isAuthenticated:true,isLoading:false};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const input=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-access'){
    if(input.action==='overview'){if(overviewGate)await overviewGate.promise;data={organizations:[{id:'motion-org',name:'Test Organization',role:'outreach',pilotStatus:'active',profile:{id:'motion-profile',status:'active',displayName:'Test Coordinator'}}]};}
    if(input.action==='profile')data={profile:{displayName:'Test Coordinator',organizationName:'Test Organization'}};
   }
   if(url.pathname==='/api/coordinator-binders'){
    if(input.action==='list'){if(listGate)await listGate.promise;data={binders:[binder],counts:{all:1,new:0,help:0},nextCursor:null};}
    if(input.action==='read'){if(readGate)await readGate.promise;if(deny)return route.fulfill({status:403,json:{error:'binder_unavailable'}});data=binder;}
   }
   if(url.pathname==='/api/coordinator-feedback')data={feedback:[],writesEnabled:true};
   assert.ok(data,`Unexpected request ${url.pathname}/${input.action}`);return route.fulfill({json:data});
  });
  await page.route('**/coordinator-motion-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import '/src/styles.css';import '/src/brand.css';
   import Arrival from '/src/WorkspaceArrival.tsx';import Workspace from '/src/CoordinatorWorkspace.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   localStorage.setItem('origen.language','${language}');browserPrivacy.start('motion-test',{fresh:true});setAPITokenProvider(async()=>'synthetic');
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Arrival,null,React.createElement(Workspace))));
  </script></html>`}));
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const animationNames=locator=>locator.evaluate(el=>el.getAnimations().map(a=>a.animationName));
  try{
   await page.clock.install();
   await page.goto(origin+'/coordinator-motion-review#coordinators');
   await page.locator('.coordinator-dashboard-placeholder').waitFor({state:'attached'});
   await page.clock.fastForward(6200);
   assert.equal(await page.locator('.workspace-arrival-content').evaluate(el=>el.inert),true,'Slow access exposed a half-loaded workspace');
   assert.equal(await page.locator('.workspace-arrival-overlay.is-leaving').count(),0);
   await page.screenshot({path:`output/playwright/coordinator-motion/${width}-welcome.png`});
   overviewGate.release();overviewGate=undefined;
   await page.locator('.workspace-arrival-content.arrival-visible').waitFor();
   if(reducedMotion!=='reduce')assert.ok((await animationNames(page.locator('.workspace-arrival-content'))).includes('account-arrive'),'Missing welcome handoff');
   await page.clock.fastForward(600);await settle();
   assert.equal(await page.locator('.workspace-arrival-overlay').count(),0);
   const sidebar=page.getByRole('navigation',{name:t('Coordinator navigation','Navegación del coordinador')});
   const menu=page.locator('.coordinator-menu-toggle');if(await menu.isVisible())await menu.click();
   listGate=gate();await sidebar.getByRole('button',{name:t('Shared binders','Carpetas compartidas'),exact:true}).click();
   await page.locator('.binder-card-placeholder').waitFor();await settle();
   const search=page.getByRole('searchbox'),before=await search.boundingBox();
   listGate.release();listGate=undefined;
   const card=page.locator('.coordinator-binder-list button');await card.waitFor();
   if(reducedMotion!=='reduce')assert.ok((await animationNames(card)).includes('shared-content-arrive'),'Missing list reveal');
   else assert.deepEqual(await animationNames(card),[],'Reduced motion animated binder cards');
   await settle();const after=await search.boundingBox();assert.ok(Math.abs(before.y-after.y)<2,'List arrival moved the search field');
   await page.screenshot({path:`output/playwright/coordinator-motion/${width}-list.png`,fullPage:true});
   readGate=gate();await card.click();await page.locator('.shared-binder-placeholder').waitFor();await settle();
   const close=page.locator('.shared-binder-close'),heading=page.locator('.shared-binder-heading');
   const closeBefore=await close.boundingBox(),headingBefore=await heading.boundingBox();
   await close.evaluate(el=>{window.previousClose=el;el.focus();});
   readGate.release();readGate=undefined;await page.locator('.shared-binder-reading').waitFor();
   if(reducedMotion!=='reduce')assert.ok((await animationNames(page.locator('.shared-binder-reading'))).includes('shared-paper-arrive'),'Missing paper reveal');
   else assert.deepEqual(await animationNames(page.locator('.shared-binder-reading')),[],'Reduced motion animated paper');
   await settle();
   assert.equal(await close.evaluate(el=>el===window.previousClose&&el===document.activeElement),true,'Loading replaced the close control or lost focus');
   assert.ok(Math.abs((await close.boundingBox()).y-closeBefore.y)<2,'Loading moved Close binder');
   assert.ok(Math.abs((await heading.boundingBox()).y-headingBefore.y)<2,'Loading moved the binder heading');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Motion caused horizontal overflow');
   await page.screenshot({path:`output/playwright/coordinator-motion/${width}-binder.png`,fullPage:true});
   await page.locator('.shared-binder-toolbar').getByRole('button',{name:t('Refresh binder','Actualizar carpeta'),exact:true}).click();
   await page.locator('.coordinator-binders[aria-busy="false"]').waitFor();
   assert.equal((await animationNames(page.locator('.shared-binder-reading'))).length,0,'Refresh replayed the opening');
   assert.equal(await page.locator('.workspace-arrival-overlay').count(),0,'Refresh replayed the welcome');
   deny=true;await page.locator('.shared-binder-toolbar').getByRole('button',{name:t('Refresh binder','Actualizar carpeta'),exact:true}).click();await page.getByRole('alert').waitFor();
   assert.equal(await page.locator('.shared-binder-reading').count(),0,'A denial retained a fading copy of private notes');
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}/${language}/${reducedMotion}: slow sign-in, welcome handoff, list and paper entrances, stable controls/focus, no replay on refresh, immediate access clearing.`);
  }finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
