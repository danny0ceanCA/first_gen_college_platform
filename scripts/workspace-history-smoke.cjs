// Exercise the real workspace navigation with isolated synthetic APIs and identity.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {mkdir}=require('node:fs/promises');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const [language,width] of [['en',1280],['es',390]]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],lists=[];
  let listGate,readGate,overviewGate,profileGate,denyRead=false,denyOverview=false,notificationRequests=0,includeSecond=false;
  let counts={all:1,new:0,help:1};
  const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en,now=new Date().toISOString();
  const binder={id:'synthetic-grant',studentName:'Alex Navigation Test',publicationId:'synthetic-publication',version:1,publishedAt:now,expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer','options'],entries:[{id:'synthetic-entry',topic:'transfer',kind:'question',language:'en',content:'Which course sequence fits the planned transfer major?'}],isNew:false,helpRequested:true};
  const secondBinder={...binder,id:'synthetic-grant-2',studentName:'Jordan Navigation Test',publicationId:'synthetic-publication-2',helpRequested:false};
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'synthetic-navigation'},getAccessTokenSilently:async()=> 'synthetic',isAuthenticated:true,isLoading:false};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const input=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-access'){
    if(input.action==='overview'){if(overviewGate)await overviewGate.promise;if(denyOverview)return route.fulfill({status:403,json:{error:'coordinator_access_denied'}});data={organizations:[{id:'synthetic-org',name:'Synthetic Organization',role:'outreach',pilotStatus:'active',pilotRevision:1,verificationStatus:'verified',profile:{id:'synthetic-profile',status:'active',displayName:'Test Coordinator'}}]};}
    if(input.action==='profile'){if(profileGate)await profileGate.promise;data={profile:{displayName:'Test Coordinator',organizationName:'Synthetic Organization'}};}
   }
   if(url.pathname==='/api/coordinator-notifications'){notificationRequests++;data={notifications:[{id:'test-notice',kind:'published',read:true,createdAt:now}]};}
   if(url.pathname==='/api/coordinator-feedback')data={feedback:[],writesEnabled:true};
   if(url.pathname==='/api/coordinator-binders'){
    if(input.action==='list'){lists.push(input);if(listGate)await listGate.promise;data={binders:input.search?[binder]:[...Array.from({length:15},(_,i)=>({...binder,id:'filler-'+i,studentName:'Synthetic '+i})),binder,secondBinder],counts,nextCursor:null};}
    if(input.action==='read'){const denied=denyRead;if(readGate)await readGate.promise;if(denied)return route.fulfill({status:403,json:{error:'binder_unavailable'}});data=input.grantId===secondBinder.id?secondBinder:binder;}
   }
   assert.ok(data,`Unexpected synthetic request ${url.pathname}/${input.action}`);
   return route.fulfill({json:data});
  });
  await page.route('**/binder-navigation-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><body><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import '/src/styles.css';import '/src/brand.css';
   import Workspace from '/src/CoordinatorWorkspace.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('synthetic-navigation',{fresh:true});setAPITokenProvider(async()=>'synthetic');localStorage.setItem('origen.language','${language}');
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Workspace)));
  </script></body></html>`}));
  try{
   await page.goto(origin+'/binder-navigation-review');
   const sidebar=page.getByRole('navigation',{name:t('Coordinator navigation','Navegación del coordinador'),includeHidden:true});
   const navigate=async(name)=>{const menu=page.locator('.coordinator-menu-toggle');if(await menu.isVisible()&&!await sidebar.isVisible())await menu.click();await sidebar.getByRole('button',{name,exact:true}).click();};
   const student=page.locator('.coordinator-binder-list button').filter({hasText:binder.studentName});
   const waitList=()=>student.waitFor();
   await page.locator('.coordinator-home-stats').waitFor();
   await navigate(t('Shared binders','Carpetas compartidas'));await waitList();
   const initialLength=await page.evaluate(()=>history.length),initialLists=lists.length;
   await navigate(t('Shared binders','Carpetas compartidas'));
   assert.equal(await page.evaluate(()=>history.length),initialLength,'Current nav item created a duplicate history entry');
   assert.equal(lists.length,initialLists,'Current nav item reloaded data');
   await student.scrollIntoViewIfNeeded();await student.click();await page.locator('.shared-notebook-overview').waitFor();const sourceY=await page.evaluate(()=>history.state.origenNavigation.values['coordinator.binders.synthetic-org.origin'].y);await page.goBack();await waitList();await page.waitForTimeout(150);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-sourceY)<3,JSON.stringify({message:'Back lost list scroll',sourceY,currentY:await page.evaluate(()=>scrollY),history:await page.evaluate(()=>history.state.origenNavigation)}));assert.equal(await student.evaluate(el=>el===document.activeElement),true,'Back lost card focus');
   const search=page.getByRole('searchbox');await search.fill('Alex');await page.locator('.coordinator-binder-search').getByRole('button').click();await waitList();
   await student.click();await page.locator('.shared-notebook-overview').waitFor();
   await page.getByRole('tab',{name:/Transfer/}).click();await page.locator('.ink-add').first().waitFor();
   await page.reload();await page.locator('.ink-add').first().waitFor();
   assert.equal(await page.getByRole('tab',{name:/Transfer/}).getAttribute('aria-selected'),'true','Reload lost divider');
   await page.goBack();await page.locator('.shared-notebook-overview').waitFor();
   await page.goBack();await waitList();assert.equal(await search.inputValue(),'Alex','Back lost search');
   await page.goForward();await page.locator('.shared-notebook-overview').waitFor();
   await page.goForward();await page.locator('.ink-add').first().waitFor();
   await page.locator('.ink-add').first().click();
   const draft=page.locator('.guidance-editor textarea').first();await draft.fill('Keep this unsent comment.');
   page.once('dialog',dialog=>dialog.dismiss());await page.goBack();await page.waitForTimeout(300);
   assert.equal(await draft.inputValue(),'Keep this unsent comment.','Cancelled Back lost draft');
   assert.equal(await page.getByRole('tab',{name:/Transfer/}).getAttribute('aria-selected'),'true','Cancelled Back left divider');
   page.once('dialog',dialog=>dialog.accept());await page.goBack();await page.locator('.shared-notebook-overview').waitFor();
   await page.goForward();await page.locator('.ink-add').first().waitFor();
   assert.equal(await page.locator('.guidance-editor textarea').count(),0,'Discarded comment was restored');
   await page.locator('.ink-add').first().click();await draft.fill('Protect this across workspaces.');
   const beforeHash=page.url();
   // Same-origin outer route changes must use the same guard as internal Back.
   const outerLink=page.locator('a[href="#institutions"]').first();
   page.once('dialog',dialog=>dialog.dismiss());await outerLink.evaluate(el=>el.click());
   assert.equal(page.url(),beforeHash,'Cancelled workspace link changed URL');assert.equal(await draft.inputValue(),'Protect this across workspaces.');
   page.once('dialog',dialog=>dialog.accept());await outerLink.evaluate(el=>el.click());
   assert.equal(new URL(page.url()).hash,'#institutions');
   await page.goBack();await page.locator('.ink-add').first().waitFor();
   assert.equal(page.url(),beforeHash);assert.equal(await page.locator('.guidance-editor textarea').count(),0,'Workspace Back revived discarded draft');
   await page.locator('.shared-binder-close').click();await waitList();
   await navigate(t('Overview','Resumen'));await page.locator('.coordinator-home-stats').waitFor();
   await page.goBack();await waitList();assert.equal(await search.inputValue(),'Alex');
   // Return to the saved binder route, but require fresh authorization after reload.
   await student.click();await page.locator('.shared-notebook-overview').waitFor();denyRead=true;
   await page.reload();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.shared-notebook-overview').count(),0,'Reload restored content without access');
   denyRead=false;await page.getByRole('button',{name:t('Return to shared binders','Volver a las carpetas')}).click();await waitList();
   await page.evaluate(async()=>{const {browserPrivacy}=await import('/src/browserPrivacy.mjs');browserPrivacy.stop('logout');browserPrivacy.start('synthetic-other-account',{fresh:true});});
   await page.goBack();await page.waitForTimeout(200);
   const state=await page.evaluate(()=>history.state.origenNavigation);
   assert.equal(state.owner,'synthetic-other-account');assert.ok(!Object.keys(state.values).some(key=>key.startsWith('coordinator.binders.')),'Other-account history retained binder identifiers');
   assert.deepEqual(errors,[]);
   console.log(`PASS ${language}/${width}: refresh, Back/Forward, search restoration, same-tab no-op, unsent comment cancel/discard, revoked access and account isolation.`);
  }catch(error){console.error('Synthetic browser errors:',errors);console.error((await page.locator('body').innerText()).slice(0,1800));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
