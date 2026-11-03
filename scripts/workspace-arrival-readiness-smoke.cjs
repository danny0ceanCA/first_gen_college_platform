// Phase 2: real loading components, synthetic authentication and APIs only.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const auth=`const auth={user:{sub:'readiness-test'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:()=>window.holdToken?new Promise(resolve=>{window.releaseToken=resolve}):Promise.resolve('synthetic')};export function useAuth0(){return auth}`;
const boot=body=>`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 import {WorkspaceArrival} from '/src/WorkspaceArrival.tsx';import {useArrivalPending} from '/src/arrivalReadiness.ts';import WorkspaceModule from '/src/LoadingSurface.tsx';
 import '/src/styles.css';import '/src/brand.css';
 ${body}
 </script></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{
  for(const [width,language,reducedMotion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
   const page=await browser.newPage({viewport:{width,height:844},reducedMotion});
   page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(language=>localStorage.setItem('origen.language',language),language);
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:auth});
    if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.abort();
    return route.continue();
   });
   await page.route('**/arrival-readiness-review',route=>route.fulfill({contentType:'text/html',body:boot(`
    let release;const Heavy=React.lazy(()=>new Promise(resolve=>{release=()=>resolve({default:Content});window.releaseModule=release}));
    function Content(){const [pending,setPending]=React.useState(true);useArrivalPending(pending);window.setPending=setPending;return React.createElement('main',null,React.createElement('h1',null,'Ready workspace'));}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(WorkspaceArrival,{active:true},React.createElement(WorkspaceModule,null,React.createElement(Heavy)))));
   `)}));
   await page.goto(origin+'/arrival-readiness-review');
   await page.locator('.loading-surface').waitFor({state:'attached'});
   assert.equal(await page.locator('.workspace-arrival-content').evaluate(el=>el.inert),true,'A suspended module exposed unfinished content');
   await page.evaluate(()=>window.releaseModule());
   await page.locator('h1').waitFor({state:'attached'});
   assert.equal(await page.locator('.workspace-arrival-content').evaluate(el=>el.inert),true,'Replacing module loading with data loading revealed too soon');
   const start=Date.now();await page.evaluate(()=>window.setPending(false));
   await page.locator('.workspace-arrival-overlay').waitFor({state:'detached',timeout:2500});
   assert.ok(Date.now()-start<2500,'A fast workspace was held for the old six-second introduction');
   await page.evaluate(()=>window.setPending(true));
   assert.equal(await page.locator('.workspace-arrival-overlay').count(),0,'Refreshing replayed the introduction');
   await page.clock.install();await page.reload();await page.locator('.loading-surface').waitFor({state:'attached'});
   await page.clock.fastForward(16000);
   const retry=page.locator('.workspace-arrival-overlay').getByRole('button',{name:language==='es'?'Intentar de nuevo':'Try again'});
   await retry.waitFor();assert.equal(await retry.isEnabled(),true);
   assert.equal(await page.locator('.workspace-arrival-content').evaluate(el=>el.inert),true,'A timeout exposed unfinished content');
   await page.evaluate(()=>window.releaseModule());await page.locator('h1').waitFor({state:'attached'});await page.evaluate(()=>window.setPending(false));
   await page.locator('.arrival-visible').waitFor();await page.clock.fastForward(600);
   await page.locator('.workspace-arrival-overlay').waitFor({state:'detached'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Recovery overflowed mobile width');
   assert.deepEqual(errors,[]);await page.close();
   console.log(`PASS ${width}/${language}/${reducedMotion}: module-to-data readiness, fast arrival, no refresh replay, accessible stalled recovery, late success.`);
  }
  // A token provider that never responds must time out before it can fetch data.
  const page=await browser.newPage({viewport:{width:1280,height:844}});page.setDefaultTimeout(8000);let overviewRequests=0,teamRequests=0;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:auth});
   if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const input=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-access'&&input.action==='overview'){overviewRequests++;data={organizations:[{id:'ready-org',name:'Synthetic organization',role:'owner',pilotStatus:'active',profile:{id:'ready-profile',status:'active',displayName:'Synthetic coordinator'}}]};}
   if(url.pathname==='/api/coordinator-access'&&input.action==='profile')data={profile:{displayName:'Synthetic coordinator',organizationName:'Synthetic organization'}};
   if(url.pathname==='/api/coordinator-access'&&input.action==='team'){teamRequests++;data={members:[]};}
   if(url.pathname==='/api/coordinator-binders')data={binders:[],counts:{all:0,new:0,help:0},nextCursor:null};
   assert.ok(data,`Unexpected API ${url.pathname}/${input.action}`);return route.fulfill({json:data});
  });
  await page.route('**/arrival-token-review',route=>route.fulfill({contentType:'text/html',body:boot(`
   import Workspace from '/src/CoordinatorWorkspace.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('readiness-test',{fresh:true});setAPITokenProvider(async()=>'synthetic');window.holdToken=true;
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WorkspaceArrival,{active:true},React.createElement(Workspace)));
  `)}));
  await page.clock.install();await page.goto(origin+'/arrival-token-review#coordinators');await page.locator('.coordinator-dashboard-placeholder').waitFor({state:'attached'});
  await page.clock.fastForward(16000);
  await page.locator('.coordinator-dashboard-main [role="alert"]').waitFor();
  await page.locator('.arrival-visible').waitFor();await page.clock.fastForward(600);
  assert.equal(overviewRequests,0,'Expired token wait sent a request');
  await page.evaluate(()=>{window.holdToken=false;window.releaseToken('synthetic');});
  await page.locator('.coordinator-dashboard-main').getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('heading',{name:'Welcome, Synthetic coordinator.'}).waitFor();
  assert.equal(overviewRequests,1,'Late token completion revived an expired request');
  assert.equal(teamRequests,0,'Login waited for secondary team data');
  assert.equal(await page.locator('.workspace-arrival-overlay').count(),0);
  await page.getByRole('navigation',{name:'Coordinator navigation'}).getByRole('button',{name:'Your team',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.loading-surface'));
  assert.equal(teamRequests,1,'The team was not loaded on demand');
  console.log('PASS token deadline: bounded sign-in, retry succeeds, stale token discarded, team loads only when visited.');
  await page.close();
  // Lazy module errors must leave a working reload action rather than an endless wave.
  const failure=await browser.newPage();
  await failure.route('**/arrival-module-error',route=>route.fulfill({contentType:'text/html',body:boot(`
   const Broken=React.lazy(()=>Promise.reject(new Error('Synthetic module download failure')));
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WorkspaceArrival,{active:true},React.createElement(WorkspaceModule,null,React.createElement(Broken))));
  `)}));
  await failure.goto(origin+'/arrival-module-error');await failure.getByRole('button',{name:'Reload page'}).waitFor();
  await failure.locator('.workspace-arrival-overlay').waitFor({state:'detached',timeout:2500});
  console.log('PASS failed module download: error boundary reveals an actionable reload state.');await failure.close();
  const registration=await browser.newPage();let releaseStatus,statusRequested=false;
  const statusReady=new Promise(resolve=>{releaseStatus=resolve;});
  await registration.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:auth});
   if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const input=route.request().postDataJSON();assert.equal(input.action,'application-status','Registration loading attempted a write');
   statusRequested=true;await statusReady;return route.fulfill({json:{application:null}});
  });
  await registration.route('**/arrival-registration-review',route=>route.fulfill({contentType:'text/html',body:boot(`
   import Registration from '/src/CoordinatorRegistration.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';
   browserPrivacy.start('readiness-test',{fresh:true});
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WorkspaceArrival,{active:true},React.createElement(Registration)));
  `)}));
  await registration.goto(origin+'/arrival-registration-review');await registration.locator('.workspace-arrival-overlay').waitFor();
  assert.equal(await registration.locator('.workspace-arrival-content').evaluate(el=>el.inert),true);
  // Resolving the pending status is read-only; no registration is submitted.
  releaseStatus();await registration.getByRole('textbox',{name:'First name',exact:true}).waitFor();
  await registration.locator('.workspace-arrival-overlay').waitFor({state:'detached',timeout:2500});
  assert.equal(statusRequested,true);console.log('PASS registration: application status stays covered until ready; form appears without an extra delay.');await registration.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
