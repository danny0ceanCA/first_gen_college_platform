// Real components; every API request is intercepted. No production writes.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const mode of ['admin','organization']){
  const page=await browser.newPage({viewport:{width:Number(process.env.ORIGEN_SMOKE_WIDTH||1280),height:900}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.stack));page.setDefaultTimeout(10000);
  const content={name:'Synthetic College',website:'https://college.example/',description:'A synthetic institution.',programs:'Synthetic programs',admissions:'',financialAid:'',events:'',publicEmail:'',links:[]};
  const institutions=[1,2].map(i=>({id:'synthetic-org-'+i,page:{...content,name:content.name+' '+i},revision:1,status:'submitted',verificationStatus:'pending',membershipRole:'owner',unitType:'institution',parentApproval:'approved',representatives:[]}));
  const applications=[1,2].map(i=>({id:'synthetic-app-'+i,displayName:'Test Coordinator '+i,email:'coordinator'+i+'@example.test',organizationName:'Synthetic College 1',organizationWebsite:'',jobRole:'Advisor',status:'pending',reviewNote:'',createdAt:new Date().toISOString()}));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'synthetic-${mode}',given_name:'Test',email:'test@example.test'},getAccessTokenSilently:async()=> 'synthetic',isAuthenticated:true,isLoading:false};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const input=route.request().postDataJSON();requests.push(input);let data;
   if(url.pathname==='/api/admin'){
    if(input.action==='access')data={actions:['overview','users'],permissions:['manage:institutions','read:users']};
    if(input.action==='overview')data={totals:{},users:[],activity:[]};
    if(input.action==='approved-directory')data={items:[],next:''};
   }
   if(url.pathname==='/api/institutions'){
    if(input.action==='load')data={institutions,adminReview:mode==='admin',canReview:mode==='admin',notifications:[],unitRequests:[],authorizedUnits:[],affiliationRequests:[]};
    if(input.action==='queue')data={submissions:institutions,next:''};
   }
   if(url.pathname==='/api/coordinator-access'){
    if(input.action==='applications')data={applications};
    if(input.action==='application-organizations')data={organizations:[{id:'synthetic-org-1',name:'Synthetic College 1'}]};
   }
   assert.ok(data,`Unexpected synthetic API ${url.pathname}/${input.action}`);return route.fulfill({json:data});
  });
  await page.route('**/navigation-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><meta charset="utf-8"><body><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import '/src/styles.css';import '/src/brand.css';import Page from '/src/${mode==='admin'?'AdminDashboard':'InstitutionPortal'}.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('synthetic-${mode}',{fresh:true});setAPITokenProvider(async()=>'synthetic');
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Page,${mode==='admin'?"{initialView:'approvals'}":'{}'})));
  </script></body></html>`}));
  try{
   await page.goto(origin+'/navigation-review');
   if(mode==='admin'){
    const orgRows=page.locator('.org-review-rows button');await orgRows.nth(1).click();
    await page.reload();await page.getByRole('heading',{name:'Synthetic College 2',exact:true}).waitFor();
    await page.getByRole('button',{name:'Coordinators',exact:true}).click();await page.getByRole('heading',{name:'Test Coordinator 1',exact:true}).waitFor();
    await page.locator('.org-review-row').filter({hasText:'Test Coordinator 2'}).click();
    await page.reload();await page.getByRole('heading',{name:'Test Coordinator 2',exact:true}).waitFor();
    const note=page.getByLabel('Message the applicant will see');await note.fill('Please keep this review draft.');
    page.once('dialog',dialog=>dialog.dismiss());await page.goBack();await page.waitForTimeout(200);assert.equal(await note.inputValue(),'Please keep this review draft.');
    page.once('dialog',dialog=>dialog.accept());await page.goBack();await page.getByRole('heading',{name:'Test Coordinator 1',exact:true}).waitFor();
    await page.getByRole('button',{name:'Approved',exact:true}).click();await page.getByRole('searchbox').count();
    await page.reload();await page.getByRole('button',{name:'Approved',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Approved',exact:true}).getAttribute('aria-pressed'),'true');
    await page.goBack();await page.getByRole('heading',{name:'Test Coordinator 1',exact:true}).waitFor();
   }else{
    await page.getByLabel('Active workspace').selectOption('synthetic-org-2');
    await page.getByRole('button',{name:'Programs and events',exact:true}).click();
    await page.reload();await page.getByLabel('Active workspace').waitFor();assert.equal(await page.getByLabel('Active workspace').inputValue(),'synthetic-org-2');
    await page.getByRole('heading',{name:'Programs and opportunities',exact:true}).waitFor();
    await page.goBack();await page.getByRole('heading',{name:'Workspace updates',exact:true}).waitFor();
    await page.goBack();assert.equal(await page.getByLabel('Active workspace').inputValue(),'synthetic-org-1');
    await page.goForward();assert.equal(await page.getByLabel('Active workspace').inputValue(),'synthetic-org-2');
   }
   assert.deepEqual(errors,[]);assert.ok(requests.every(r=>['access','overview','approved-directory','load','queue','applications','application-organizations'].includes(r.action)));
   console.log(`PASS ${mode}: restored selected record, section, refresh and Back/Forward${mode==='admin'?', approval status and unsaved review guard':''}.`);
  }catch(error){console.error(errors);console.error((await page.locator('body').innerText()).slice(0,2500));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
