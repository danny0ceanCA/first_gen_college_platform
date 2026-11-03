// Actual entry, permission and privacy components; isolated synthetic auth/APIs.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {mkdir,writeFile}=require('node:fs/promises');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const subject='auth-transition-student';
const auth=`import React from '/node_modules/.vite/deps/react.js';
 export const Auth0Context=React.createContext({});const token=async()=>'e30.'+btoa(JSON.stringify({sub:'${subject}'}))+'.test';
 export function useAuth0(){return React.useContext(Auth0Context)}
 export function Auth0Provider({children}){
  const [state,setState]=React.useState({isLoading:true,isAuthenticated:!sessionStorage.getItem('synthetic-signed-out'),user:{sub:'${subject}',email:'__EMAIL__',email_verified:true}});
  window.finishAuth=()=>setState(s=>({...s,isLoading:false}));
  const logout=React.useCallback(async()=>{sessionStorage.setItem('synthetic-signed-out','1');location.assign('/')},[]);
  return React.createElement(Auth0Context.Provider,{value:{...state,getAccessTokenSilently:token,logout,loginWithRedirect:async()=>{}}},children);
 }`;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 const results=[];await mkdir('output/playwright/auth-transitions',{recursive:true});
 try{for(const [width,language,reducedMotion,scenario] of [[1366,'en','no-preference','ready'],[390,'es','no-preference','ready'],[320,'en','reduce','ready'],[1366,'en','no-preference','permission-required'],[390,'es','no-preference','permission-error'],[1366,'en','no-preference','profile-error']]){
  const page=await browser.newPage({viewport:{width,height:892},reducedMotion});page.setDefaultTimeout(10000);
  const eligibility=deferred(),family=deferred(),errors=[],requests=[],cleanupOpacity=[];let eligibilityRequested=false,stopAttempts=0;
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message)});
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:')){errors.push(m.text());console.error('React:',m.text())}});
  await page.addInitScript(language=>localStorage.setItem('origen.language',language),language);
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:auth.replace('__EMAIL__',width===320?'test@test.org':'sam@example.test')});
   if(u.origin!==origin)return route.fulfill({contentType:u.hostname.startsWith('fonts.')?'text/css':'application/json',body:u.hostname.startsWith('fonts.')?'':'{}'});
   if(!u.pathname.startsWith('/api/'))return route.continue();
   const action=route.request().postDataJSON()?.action;requests.push([u.pathname,action]);
   if(u.pathname==='/api/eligibility'){
    eligibilityRequested=true;await eligibility.promise;
    if(scenario==='permission-error')return route.fulfill({status:503,json:{error:'unavailable'}});
    return route.fulfill({json:scenario==='permission-required'?{subject,allowed:false,status:'unknown'}:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   }
   if(u.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(u.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:true}});
   if(u.pathname==='/api/family'){await family.promise;if(scenario==='profile-error')return route.fulfill({status:503,json:{error:'family_unavailable'}});return route.fulfill({json:{account:{firstName:'Sam',email:'sam@example.test',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:'synthetic-student',name:'Sam Test',stage:'Community college',interest:'Biology',goals:'Explore colleges',color:'peach'}]}})}
   if(u.pathname==='/api/binder-sharing')return route.fulfill({json:{available:true,enabled:false,connections:[],grants:[]}});
   if(u.pathname==='/api/conversation-recovery'){
    if(action==='stop'){
     cleanupOpacity.push(await page.locator('.logout-transition').evaluate(el=>Number(getComputedStyle(el).opacity)));
     if(width===390&&++stopAttempts===1)return route.fulfill({status:503,json:{error:'unavailable'}});
    }
    return route.fulfill({json:{stopped:true,available:false}});
   }
   if(u.pathname==='/api/account-data')return route.fulfill({json:{reset:true}});
   if(u.pathname==='/api/review-requests')return route.fulfill({json:{enabled:true,available:false,deliveryEnabled:false,requests:[],activity:[],nextCursor:null}});
   return route.fulfill({json:{ok:true,items:[],entries:[],notes:[],plans:[],notifications:[],feedback:[],summary:'',generatedSummaryIds:[],pendingCount:0}});
  });
  await page.goto(origin+'/#app');await page.waitForFunction(()=>typeof window.finishAuth==='function');
  await page.evaluate(()=>window.finishAuth());
  await page.waitForFunction(()=>!!document.querySelector('.eligibility-panel'));
  // Allow the old two-frame readiness handoff and fade to finish. The permission
  // request is deliberately still unresolved, so its checking form must stay covered.
  await page.waitForTimeout(650);
  const heldPermission=await page.locator('.workspace-arrival-content').evaluate(el=>el.inert);
  const visibleGates=await page.locator('.eligibility-panel:visible').count();
  assert.ok(heldPermission,'Login revealed the permission-checking form before account readiness');assert.equal(visibleGates,0);
  if(scenario.startsWith('permission-')){
   eligibility.resolve();await page.locator('.eligibility-panel').waitFor({state:'visible'});
   await page.locator('.workspace-arrival-overlay').waitFor({state:'detached'});
   assert.ok(await page.locator('.eligibility-panel button:visible').count(),'Actionable permission/retry controls stayed hidden');
   assert.equal(requests.some(([path])=>path==='/api/family'),false);
   assert.deepEqual(errors,[]);results.push({width,language,scenario,heldPermission,visibleGates,errors});await page.close();continue;
  }
  const profileRequested=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/family');
  eligibility.resolve();
  await profileRequested;
  const heldProfile=await page.locator('.workspace-arrival-content').evaluate(el=>el.inert);
  assert.ok(heldProfile,'Login replayed a loading screen during profile loading');
  if(scenario==='profile-error'){
   family.resolve();await page.locator('.application-panel').waitFor({state:'visible'});
   await page.locator('.workspace-arrival-overlay').waitFor({state:'detached'});
   assert.ok(await page.locator('.application-panel button:visible').count());assert.deepEqual(errors,[]);
   results.push({width,scenario,heldPermission,heldProfile,errors});await page.close();continue;
  }
  const destination=width===320?'.welcome-conversation':'.app-shell';
  family.resolve();await page.locator(destination).waitFor({state:'visible'}).catch(async e=>{await page.screenshot({path:'output/playwright/auth-transitions/debug.png'});console.error(JSON.stringify({requests,text:(await page.locator('body').innerText()).slice(0,1500)}));throw e});
  await page.locator('.workspace-arrival-overlay').waitFor({state:'detached'});
  const animations=await page.locator(destination).evaluate(el=>getComputedStyle(el).animationName);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await page.screenshot({path:`output/playwright/auth-transitions/${width}-signed-in.png`});
  // Exit using the real app action and PrivateSession wrapper, with a fake SDK
  // redirect back to this same isolated browser context.
  if(width===1366)await page.addStyleTag({content:'dialog.logout-transition[data-dialog-surface][data-enter=true]{animation-duration:700ms}'});
  await page.getByRole('button',{name:language==='es'?'Cerrar sesión':'Log out',exact:true}).click();
  if(width===390){await page.locator('.logout-transition[data-phase=error]').waitFor();assert.equal(await page.locator('.app-shell').count(),1);await page.getByRole('button',{name:'Intentar de nuevo',exact:true}).click();}
  await page.waitForURL(origin+'/');await page.waitForFunction(()=>typeof window.finishAuth==='function');
  await page.locator('.logout-transition[data-phase=returning]').waitFor();
  const returnCovered=await page.locator('.logout-transition').isVisible();
  await page.evaluate(()=>window.finishAuth());await page.locator('.logout-transition').waitFor({state:'detached'});
  await page.locator('.landing-home').waitFor();
  const privateAfterLogout=await page.locator('.app-shell,.welcome-conversation,.eligibility-panel,.account-opening').count();
  const testResets=requests.filter(([path,action])=>path==='/api/account-data'&&action==='reset-test-session').length;
  assert.equal(testResets,width===320?1:0,'The test-account cleanup must still run exactly once');
  const result={width,language,reducedMotion,scenario,eligibilityRequested,heldPermission,visibleGates,heldProfile,animations,overflow,returnCovered,privateAfterLogout,cleanupOpacity,testResets,errors};results.push(result);
  assert.equal(animations,'none','The workspace still has a second entrance animation');assert.equal(overflow,false);assert.ok(returnCovered);assert.equal(privateAfterLogout,0);assert.deepEqual(errors,[]);assert.ok(cleanupOpacity.length>0&&cleanupOpacity.every(opacity=>opacity===1),'Cleanup started before the curtain became opaque');
  console.log(JSON.stringify(result));await page.close();
 }}finally{await writeFile('output/playwright/auth-transitions/after.json',JSON.stringify(results,null,2));await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
