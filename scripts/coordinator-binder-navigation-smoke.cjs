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
  const binder={id:'synthetic-grant',studentName:'Alex Navigation Test',publicationId:'synthetic-publication',version:1,publishedAt:now,expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer'],entries:[{id:'synthetic-entry',topic:'transfer',kind:'question',language:'en',content:'Which course sequence fits the planned transfer major?'}],isNew:false,helpRequested:true};
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
    if(input.action==='list'){lists.push(input);if(listGate)await listGate.promise;data={binders:input.view==='new'||input.search?[ ]:includeSecond?[binder,secondBinder]:[binder],counts,nextCursor:null};}
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
   overviewGate=gate();profileGate=gate();
   await page.goto(origin+'/binder-navigation-review');
   const sidebar=page.getByRole('navigation',{name:t('Coordinator navigation','Navegación del coordinador'),includeHidden:true});
   const navigate=async(name)=>{const menu=page.locator('.coordinator-menu-toggle');if(await menu.isVisible()&&!await sidebar.isVisible())await menu.click();await sidebar.getByRole('button',{name,exact:true}).click();};
   const openList=()=>navigate(t('Shared binders','Carpetas compartidas'));
   const student=page.locator('.coordinator-binder-list button').filter({hasText:binder.studentName});
   const search=page.getByRole('searchbox',{name:t('Find a shared binder by name','Buscar una carpeta por nombre')});
   const readyHome=page.locator('.coordinator-dashboard-main > .coordinator-welcome');
   const refreshWorkspace=page.locator('.admin-header').getByRole('button',{name:t('Refresh','Actualizar'),exact:true});
   const sharedStat=page.locator('.coordinator-home-stats').getByRole('button',{name:new RegExp('^'+t('Shared binders','Carpetas compartidas'))});
   const helpStat=page.locator('.coordinator-home-stats button').filter({hasText:t('Students asking for help','Estudiantes que piden ayuda')});
   await page.locator('.coordinator-dashboard-placeholder').waitFor();await page.evaluate(()=>document.fonts.ready);
   const initialOrganization=await page.locator('.coordinator-organization-bar').boundingBox();
   const profileRequest=page.waitForRequest(r=>r.url().endsWith('/api/coordinator-access')&&r.postDataJSON().action==='profile');
   overviewGate.release();overviewGate=undefined;await profileRequest;
   assert.equal(await page.locator('.coordinator-access-state').count(),0,'Profile loading flashed pending access');
   profileGate.release();profileGate=undefined;await readyHome.waitFor();
   await helpStat.locator('strong').filter({hasText:'1'}).waitFor();
   const readyOrganization=await page.locator('.coordinator-organization-bar').boundingBox();
   assert.ok(Math.abs(initialOrganization.y-readyOrganization.y)<2,'Opening moved organization header');
   assert.equal(await page.locator('.coordinator-home-stats button').count(),2);
   assert.equal(await page.getByText(t('New updates','Nuevas actualizaciones'),{exact:true}).count(),0);
   assert.equal(await page.locator('.coordinator-updates').count(),0);
   await mkdir('output/playwright/shared-binder-loading',{recursive:true});
   await page.screenshot({path:`output/playwright/shared-binder-loading/overview-${language}-${width}.png`,fullPage:true});
   const heroBefore=await readyHome.boundingBox();
   overviewGate=gate();profileGate=gate();listGate=gate();counts={all:2,new:0,help:0};
   const refreshedProfile=page.waitForRequest(r=>r.url().endsWith('/api/coordinator-access')&&r.postDataJSON().action==='profile');
   await refreshWorkspace.click();
   assert.equal(await readyHome.count(),1,'Workspace refresh removed the overview');
   assert.equal(await sidebar.locator('button').count(),4,'Workspace refresh removed navigation');
   overviewGate.release();overviewGate=undefined;await refreshedProfile;
   assert.equal(await readyHome.count(),1,'Profile refresh removed the overview');
   profileGate.release();profileGate=undefined;
   await page.locator('.coordinator-dashboard-main[aria-busy="false"]').waitFor();
   assert.equal(await helpStat.locator('strong').textContent(),'1','Count refresh flashed an empty value');
   listGate.release();listGate=undefined;await helpStat.locator('strong').filter({hasText:'0'}).waitFor();
   assert.equal(await sharedStat.locator('strong').textContent(),'2','Workspace refresh did not refresh counts');
   const heroAfter=await readyHome.boundingBox();
   assert.ok(Math.abs(heroBefore.y-heroAfter.y)<2&&Math.abs(heroBefore.height-heroAfter.height)<2,'Workspace refresh shifted the overview');
   counts={all:1,new:0,help:1};
   denyOverview=true;await refreshWorkspace.click();await page.getByRole('alert').waitFor();
   assert.equal(await readyHome.count(),0,'Denied workspace kept the overview');
   assert.equal(await sidebar.locator('button').count(),1,'Denied workspace kept staff navigation');
   denyOverview=false;await refreshWorkspace.click();await readyHome.waitFor();
   overviewGate=gate();await refreshWorkspace.click();await page.getByRole('alert').waitFor();
   assert.equal(await readyHome.count(),0,'A stalled access check retained content past its deadline');
   const lateResponse=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-access')&&r.request().postDataJSON().action==='overview');
   overviewGate.release();overviewGate=undefined;await lateResponse;
   assert.equal(await readyHome.count(),0,'A late response restored timed-out content');
   await refreshWorkspace.click();await readyHome.waitFor();
   listGate=gate();await openList();await page.locator('.binder-card-placeholder').waitFor();
   const initialControls=await search.boundingBox();
   listGate.release();listGate=undefined;await student.waitFor();
   const readyControls=await search.boundingBox();
   assert.ok(Math.abs(initialControls.y-readyControls.y)<2,'List loading moved search');
   assert.ok(Math.abs(initialControls.width-readyControls.width)<2,'Count arrival resized search');
   assert.equal(await page.getByRole('combobox',{name:t('Show','Mostrar'),exact:true}).count(),0);
   assert.equal(await page.locator('.coordinator-updates').count(),0);assert.equal(notificationRequests,0);
   await mkdir('output/playwright/shared-binder-loading',{recursive:true});
   await page.screenshot({path:`output/playwright/shared-binder-loading/${language}-${width}.png`,fullPage:true});
   assert.equal(await page.locator('.coordinator-binder-views button').count(),0);
   await page.getByRole('searchbox',{name:t('Find a shared binder by name','Buscar una carpeta por nombre')}).fill('Nobody');
   await page.getByRole('button',{name:t('Search','Buscar'),exact:true}).click();await student.waitFor({state:'detached'});
   await openList();assert.equal(await page.getByRole('searchbox').inputValue(),'Nobody','The current navigation item must preserve the search');await page.getByRole('button',{name:t('Clear search','Borrar búsqueda'),exact:true}).click();await student.waitFor();assert.equal(await page.getByRole('searchbox').inputValue(),'');
   readGate=gate();const listRequestsBeforeOpen=lists.length;
   await student.click();await page.locator('.shared-binder-placeholder').waitFor();
   assert.equal(await page.locator('.coordinator-binders-heading').count(),0,'Opening a binder flashed the list header');
   assert.equal(await page.getByRole('searchbox').count(),0,'Opening a binder flashed search');
   const closeBinder=page.getByRole('button',{name:t('Close binder','Cerrar carpeta'),exact:true});
   await closeBinder.click();await student.waitFor();
   const lateBinderResponse=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-binders')&&r.request().postDataJSON().action==='read');
   readGate.release();readGate=undefined;await (await lateBinderResponse).finished();
   assert.equal(await page.locator('.coordinator-shared-binder').count(),0,'A late response reopened a closed binder');
   const listRequestsBeforeReopen=lists.length;await student.click();
   await page.locator('.shared-notebook-overview').waitFor();
   assert.equal(listRequestsBeforeReopen,listRequestsBeforeOpen+1,'Closing did not reload the binder list');
   assert.equal(lists.length,listRequestsBeforeReopen,'Opening a binder unnecessarily reloaded the list');
   includeSecond=true;counts={all:2,new:0,help:1};
   await page.getByRole('tab',{name:new RegExp(t('Transfer & courses','Transferencia y cursos'))}).click();
   await page.getByRole('button',{name:t('Add comment','Agregar comentario'),exact:true}).click();
   const draft=page.getByRole('textbox',{name:t('Your guidance','Tu orientación'),exact:true});
   await draft.fill('Unsaved synthetic annotation');
   page.once('dialog',dialog=>dialog.dismiss());await closeBinder.click();
   assert.equal(await draft.inputValue(),'Unsaved synthetic annotation','Cancelling Close lost an annotation');
   await page.locator('.shared-paper-footer').scrollIntoViewIfNeeded();
   const closeBounds=await closeBinder.boundingBox();
   assert.ok(closeBounds.y>=0&&closeBounds.y+closeBounds.height<900,'Close binder is not visible when reading the bottom of the page');
   await page.screenshot({path:`output/playwright/shared-binder-loading/close-binder-${language}-${width}.png`});
   page.once('dialog',dialog=>dialog.accept());await closeBinder.click();
   const otherStudent=page.locator('.coordinator-binder-list button').filter({hasText:secondBinder.studentName});
   await otherStudent.waitFor();
   assert.equal(await student.evaluate(el=>el===document.activeElement),true,'Closing did not restore focus to the selected binder');
   await otherStudent.click();await page.locator('.shared-binder-heading').getByText(secondBinder.studentName,{exact:true}).waitFor();
   assert.equal(await draft.count(),0,'Another binder inherited an unsaved annotation');
   await closeBinder.click();await student.click();await page.locator('.shared-notebook-overview').waitFor();
   readGate=gate();await page.locator('.shared-binder-toolbar').getByRole('button',{name:t('Refresh binder','Actualizar carpeta'),exact:true}).click();
   assert.equal(await page.locator('.shared-notebook-overview').count(),1,'A refresh removed the authorized view');
   readGate.release();readGate=undefined;await page.locator('.coordinator-binders[aria-busy="false"]').waitFor();
   readGate=gate();
   const refreshedBinder=page.waitForRequest(r=>r.url().endsWith('/api/coordinator-binders')&&r.postDataJSON().action==='read');
   await refreshWorkspace.click();await refreshedBinder;
   assert.equal(await page.locator('.shared-notebook-overview').count(),1,'Workspace refresh removed the open binder');
   const refreshedBinderResponse=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-binders')&&r.request().postDataJSON().action==='read');
   readGate.release();readGate=undefined;await (await refreshedBinderResponse).finished();
   denyRead=true;await page.locator('.shared-binder-toolbar').getByRole('button',{name:t('Refresh binder','Actualizar carpeta'),exact:true}).click();
   await page.getByRole('alert').waitFor();assert.equal(await page.locator('.shared-notebook-overview').count(),0,'Denied access kept private content');
   denyRead=false;
   await page.getByRole('button',{name:t('Return to shared binders','Volver a las carpetas'),exact:true}).click();await student.waitFor();assert.equal(await page.locator('.coordinator-shared-binder').count(),0);
   await navigate(t('Overview','Resumen'));
   assert.equal(await page.locator('.coordinator-home-stats button').count(),2);
   await helpStat.click();await student.waitFor();
   assert.ok(lists.length>=5);assert.ok(lists.every(input=>input.view==='all'),'A navigation path applied a hidden filter');
   assert.deepEqual(errors,[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows the viewport');
   console.log(`PASS ${language}/${width}: stable loading, close during loading, late response discarded, sticky close control, unsaved annotation guard, return to list and open another binder, refresh and access denial, Strict Mode.`);
  }catch(error){console.error('Synthetic browser errors:',errors);console.error((await page.locator('body').innerText()).slice(0,2000));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
