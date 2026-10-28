// Verify the real public entry point paints before decorative SVG preparation.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {mkdir}=require('node:fs/promises');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/phase2-loading',{recursive:true});
 try{for(const [width,reducedMotion] of [[1280,'no-preference'],[390,'no-preference'],[320,'reduce']]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion}),modules=new Set(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.heroMeasurements=0;window.deferredDecoration=new Map();let id=0;
   window.requestIdleCallback=callback=>{window.deferredDecoration.set(++id,callback);return id;};
   window.cancelIdleCallback=key=>window.deferredDecoration.delete(key);
   for(const name of ['getTotalLength','getPointAtLength']){
    const original=SVGPathElement.prototype[name];
    SVGPathElement.prototype[name]=function(...args){if(this.closest('.landing-hero'))window.heroMeasurements++;return original.apply(this,args);};
   }
  });
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/src/'))modules.add(url.pathname);
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:false,getAccessTokenSilently:async()=>'',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
   if(url.pathname.startsWith('/api/')||url.origin!==origin)return route.fulfill({contentType:'application/json',body:'{}'});
   return route.continue();
  });
  await page.goto(origin+'/');await page.locator('.landing-hero h1').waitFor();
  if(reducedMotion!=='reduce')await page.waitForFunction(()=>window.deferredDecoration.size>0);
  assert.equal(await page.evaluate(()=>window.heroMeasurements),0,'Decorative geometry blocked the first paint');
  for(const name of ['App','AdminDashboard','CoordinatorWorkspace','CoordinatorRegistration','NativeWelcome','AISupport','DiscussionBoard'])assert.equal(modules.has(`/src/${name}.tsx`),false,`Landing eagerly fetched ${name}`);
  const heading=page.locator('.landing-hero h1'),before=await heading.boundingBox();
  await page.screenshot({path:`output/playwright/phase2-loading/${width}-first-paint.png`});
  const duration=await page.evaluate(()=>{const start=performance.now();for(const callback of window.deferredDecoration.values())callback({didTimeout:false,timeRemaining:()=>50});window.deferredDecoration.clear();return performance.now()-start;});
  assert.equal(await page.locator('.scene-reveal-content').getAttribute('mask'),null,'Decoration hid a previously painted illustration');
  assert.ok(Math.abs((await heading.boundingBox()).y-before.y)<1,'Decoration shifted the main message');
  const measurements=await page.evaluate(()=>window.heroMeasurements);
  assert.ok(reducedMotion==='reduce'?measurements===0:measurements>0,'Decorative initialization ignored motion preference');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Landing overflowed horizontally');
  await page.screenshot({path:`output/playwright/phase2-loading/${width}-ready.png`});
  assert.deepEqual(errors,[]);console.log(`PASS landing/${width}/${reducedMotion}: headline first, secondary workspaces deferred, no reveal flash or shift; decoration preparation ${Math.round(duration)}ms.`);
  await page.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
