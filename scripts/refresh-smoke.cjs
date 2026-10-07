// Synthetic account restoration: no real credentials or production writes.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ORIGEN_BROWSER_CHANNEL?{channel:process.env.ORIGEN_BROWSER_CHANNEL}:{})});
 try{for(const width of [1280,375])for(const role of ['parent','student']){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/@auth0_auth0-react.js*',r=>r.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';const {useState,useEffect}=React;export const Auth0Context=React.createContext({});const token=async()=> 'e30.'+btoa(JSON.stringify({sub:'synthetic-refresh'}))+'.test';export function Auth0Provider({children}){const [ready,setReady]=useState(false);useEffect(()=>{const timer=setTimeout(()=>setReady(true),150);return()=>clearTimeout(timer)},[]);return React.createElement(Auth0Context.Provider,{value:{isLoading:!ready,isAuthenticated:ready,user:ready?{sub:'synthetic-refresh'}:undefined,getAccessTokenSilently:token,logout:()=>{},loginWithRedirect:()=>{}}},children);}export function useAuth0(){return React.useContext(Auth0Context);}`}));
  await page.route('**/api/family',async r=>{await new Promise(resolve=>setTimeout(resolve,250));await r.fulfill({json:{account:{firstName:'Test User',email:'',role},students:[{id:'test',name:'Test Student',stage:'10th grade',interest:'',gpa:'',color:'peach'}]}})});
  await page.route('**/api/conversation-history',r=>r.fulfill({json:{items:[]}}));
  // Emulate a persisted selection whose student is no longer in this family.
  await page.addInitScript(()=>{localStorage.setItem('origen.user.synthetic-refresh.students.v1',JSON.stringify([{id:'removed',name:'Removed Student',stage:'10th grade',interest:'',gpa:'',color:'peach'}]));});
  await page.goto((process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5176/')+'#app');
  for(let refresh=0;refresh<2;refresh++){
   await page.locator('.app-shell').waitFor({timeout:15000});await page.getByRole('button',{name:role==='parent'?'Test User Signed-in account':'Test Student Signed-in account'}).waitFor();
   assert.match(await page.locator('.sidebar').innerText(),/Test Student/);assert.deepEqual(errors,[]);
   if(!refresh)await page.reload();
  }
  console.log(JSON.stringify({width,role,refresh:'passed',pageErrors:errors.length}));await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

