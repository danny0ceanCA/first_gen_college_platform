// Real admin/editor components, synthetic API responses, no production access.
const {createRequire}=require('node:module');const assert=require('node:assert/strict');const fs=require('node:fs');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');const origin='http://127.0.0.1:5173';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});try{
fs.mkdirSync('output/playwright/teaching-library',{recursive:true});
for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:960},reducedMotion:'reduce'});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let items=[],failSave=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'synthetic-admin'},getAccessTokenSilently:async()=> 'synthetic',isAuthenticated:true,isLoading:false};export function useAuth0(){return auth}`});
  if(!url.pathname.startsWith('/api/'))return route.continue();const input=route.request().postDataJSON();
  if(url.pathname==='/api/admin')return route.fulfill({json:input.action==='access'?{admin:true,actions:['overview'],permissions:['read:activity','manage:institutions']}:{totals:{},users:[],activity:[]}});
  assert.equal(url.pathname,'/api/teaching-library');
  if(input.action==='list')return route.fulfill({json:{items:items.filter(i=>i.archived===input.archived)}});
  if(input.action==='history')return route.fulfill({json:{history:[{revision:1,action:'save',createdAt:new Date().toISOString()}]}});
  if(input.action==='save'&&failSave){failSave=false;return route.fulfill({status:503,json:{error:'teaching_library_unavailable'}});}
  let item=items.find(i=>i.id===input.id)||{id:input.id,revision:0,published:null,published_revision:null,archived:false};
  item={...item,revision:item.revision+1,updated_at:new Date().toISOString()};
  if(input.action==='save')item.draft=input.content;
  if(input.action==='publish'){item.published=structuredClone(item.draft);item.published_revision=item.revision;}
  if(['unpublish','archive'].includes(input.action)){item.published=null;item.published_revision=null;}
  if(input.action==='archive')item.archived=true;if(input.action==='restore')item.archived=false;
  items=[item,...items.filter(i=>i.id!==item.id)];return route.fulfill({json:{item}});
 });
 await page.route('**/teaching-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import '/src/styles.css';import '/src/brand.css';import Page from '/src/AdminDashboard.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';browserPrivacy.start('synthetic-admin',{fresh:true});setAPITokenProvider(async()=>'synthetic');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Page,{initialView:'teachings'}));</script></body></html>`}));
 await page.goto(origin+'/teaching-review');await page.getByRole('heading',{name:'Teaching library',exact:true}).waitFor();
 await page.getByRole('button',{name:'New teaching',exact:true}).click().catch(async e=>{console.error(await page.locator('body').innerText(),errors);throw e;});
 await page.getByLabel('Title',{exact:true}).fill('How colleges understand your situation');await page.getByRole('combobox').first().selectOption('finance');
 await page.getByLabel('How I explain it',{exact:true}).fill('To understand college, it first helps to understand how colleges try to understand you. Start with your situation, then explain the terms.');
 await page.getByLabel('Review by',{exact:true}).fill('2099-12-31');failSave=true;
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('alert').waitFor();assert.ok((await page.getByLabel('How I explain it',{exact:true}).inputValue().catch(async e=>{console.error(await page.locator('body').innerText(),errors);throw e;})).startsWith('To understand college'));
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft saved'}).waitFor();
 await page.getByRole('button',{name:'Preview draft',exact:true}).click();await page.getByRole('heading',{name:'How colleges understand your situation',exact:true}).waitFor();
 await page.getByLabel('I reviewed this guidance and its sources.').check();await page.getByRole('button',{name:'Publish reviewed guidance',exact:true}).click();await page.getByRole('status').filter({hasText:'Published.'}).waitFor();assert.ok(items[0].published);
 await page.getByRole('button',{name:'Write',exact:true}).click();await page.getByLabel('How I explain it',{exact:true}).fill('Draft revision, not published');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft saved'}).waitFor();assert.ok(items[0].published.explanation.startsWith('To understand college'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:`output/playwright/teaching-library/editor-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Unpublish',exact:true}).click();await page.getByRole('status').filter({hasText:'Unpublished.'}).waitFor();assert.equal(items[0].published,null);
 await page.getByRole('button',{name:'Archive',exact:true}).click();await page.getByRole('status').filter({hasText:'Archived and'}).waitFor();await page.getByRole('button',{name:'Restore draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Restored as a draft'}).waitFor();
 await page.getByLabel('Title',{exact:true}).fill('Unsaved teaching edit');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'All teachings',exact:true}).click();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Unsaved teaching edit');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Unsaved teaching edit');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'All teachings',exact:true}).click();await page.getByRole('button',{name:/How colleges understand your situation/}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,saving:'passed',retry:'passed',preview:'passed',publishIsolation:'passed',unpublishArchiveRestore:'passed',overflow:false}));await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
