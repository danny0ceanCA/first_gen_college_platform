// Real coordinator screens, isolated identities/APIs, and no production writes.
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {mkdir,writeFile}=require('node:fs/promises');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const audit=process.env.ORIGEN_NAV_AUDIT==='1';
const folder='output/playwright/coordinator-navigation';
(async()=>{
 await mkdir(folder,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 const problems=[];
 try{for(const [language,width,height,reducedMotion] of [['en',1864,900,'no-preference'],['en',1024,768,'no-preference'],['es',768,1024,'no-preference'],['en',390,844,'no-preference'],['es',320,740,'no-preference'],['es',844,390,'no-preference'],['en',640,720,'reduce']]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion}),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en;
  const organizationName='First Generation Student and Community Opportunity Center';
  const coordinatorName='Alexandria Rivera Martinez';
  const grant={id:'nav-grant',studentName:'Jordan Synthetic Student',publicationId:'nav-publication',version:1,publishedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer','applications','costs','options'],entries:[{id:'nav-entry',topic:'transfer',kind:'question',language:'en',content:'We discussed the classes I need for transfer and how to balance them with my work schedule. I would like help checking my next semester plan.'}],isNew:false,helpRequested:true};
  let inboxGate,denyInbox=false;
  const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};};
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'navigation-owner'},getAccessTokenSilently:async()=>'synthetic',isAuthenticated:true,isLoading:false};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const body=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-access'){
    if(body.action==='overview')data={organizations:[{id:'nav-org',name:organizationName,role:'owner',pilotStatus:'active',profile:{id:'nav-profile',displayName:coordinatorName,status:'active'}},{id:'nav-org-2',name:'Another Synthetic Organization',role:'owner',pilotStatus:'active',profile:{id:'nav-profile-2',displayName:coordinatorName,status:'active'}}]};
    if(body.action==='profile')data={profile:{displayName:coordinatorName,organizationName}};
    if(body.action==='team')data={members:[{subject:'nav-colleague',name:'avery-long-unbroken-synthetic-coordinator-display-name@example.test',role:'outreach',coordinatorStatus:'active'}]};
   }
   if(url.pathname==='/api/coordinator-binders')data=body.action==='read'?grant:{binders:[grant],counts:{all:1,new:0,help:1},nextCursor:null};
   if(url.pathname==='/api/coordinator-feedback')data={feedback:[],writesEnabled:true};
   if(url.pathname==='/api/coordinator-connections'){
    if(inboxGate)await inboxGate.promise;
    if(denyInbox)return route.fulfill({status:403,json:{error:'connection_denied'}});
    data={connections:[{id:'nav-connection',displayName:'Jordan Synthetic Student',topics:['transfer','applications'],status:'requested',expiresAt:grant.expiresAt}]};
   }
   if(url.pathname==='/api/institutions'&&body.action==='team')data={members:[{auth0_subject:'nav-colleague',first_name:'Alexandria Synthetic Colleague',work_email:'a-very-long-synthetic-work-email-for-layout-testing@example.test',role:'outreach'}],invites:[],history:[]};
   assert.ok(data,`Unexpected request ${url.pathname}/${body.action}`);
   return route.fulfill({json:data});
  });
  await page.route('**/workspace-navigation-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import '/src/styles.css';import '/src/brand.css';
   import Workspace from '/src/CoordinatorWorkspace.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('navigation-owner',{fresh:true});setAPITokenProvider(async()=>'synthetic');localStorage.setItem('origen.language','${language}');
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Workspace)));
  </script></body></html>`}));
  const report=(condition,message)=>{if(!condition)problems.push(`${language}/${width}x${height}: ${message}`);};
  const navigation=page.getByRole('navigation',{name:t('Coordinator navigation','Navegación del coordinador')});
  const menu=page.locator('.coordinator-menu-toggle');
  const openMenu=async()=>{if(await menu.isVisible()&&!await navigation.isVisible())await menu.click();};
  const nav=async(en,es)=>{await openMenu();await navigation.getByRole('button',{name:t(en,es),exact:true}).click();};
  async function inspect(screen){
   await page.evaluate(()=>document.fonts.ready);
   const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('main *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+2&&!el.closest('.notebook-topics');}).slice(0,6).map(el=>el.className||el.tagName)}));
   report(overflow.scroll<=width+1,`${screen} overflows (${overflow.scroll}px): ${overflow.items.join(', ')}`);
   await page.screenshot({path:`${folder}/${audit?'before-':''}${language}-${width}-${screen}.png`,fullPage:true});
  }
  try{
   await page.goto(origin+'/workspace-navigation-review');await page.locator('.coordinator-dashboard-main > .coordinator-welcome').waitFor();await inspect('overview');
   await nav('Profile & code','Perfil y código');await page.getByLabel(t('Name students will see','Nombre que verán los estudiantes'),{exact:true}).waitFor();await inspect('profile');
   report(await page.locator('.admin-header h1').evaluate(el=>el===document.activeElement),'Navigation does not focus the destination heading');
   await nav('Your team','Tu equipo');await page.getByRole('button',{name:t('Invitations and team','Invitaciones y equipo'),exact:true}).click();await page.getByRole('heading',{name:t('Members','Miembros'),exact:true}).waitFor();await inspect('team');
   if(!audit){
    const invite=page.getByLabel(t('Their sign-in email','Su correo de inicio de sesión'),{exact:true});await invite.fill('synthetic@example.test');
    let warned=false;page.once('dialog',async dialog=>{warned=true;await dialog.dismiss();});await nav('Overview','Resumen');
    report(warned&&await invite.inputValue()==='synthetic@example.test','Navigation lost an unfinished team invitation');await invite.fill('');
   }
   inboxGate=gate();await nav('Connections','Conexiones');
   report(await page.locator('.coordinator-inbox').count()===1,'Connections has no loading shell');
   inboxGate.release();inboxGate=undefined;await page.getByRole('button',{name:t('Accept','Aceptar'),exact:true}).waitFor();await inspect('connections');
   if(!audit){denyInbox=true;await page.getByRole('button',{name:t('Refresh connections','Actualizar conexiones'),exact:true}).click();await page.getByRole('alert').waitFor();report(await page.locator('.coordinator-connection').count()===0,'Denied connection access retained student rows');denyInbox=false;}
   await nav('Shared binders','Carpetas compartidas');await page.locator('.coordinator-binder-list button').click();await page.getByRole('tab',{name:new RegExp(t('Transfer & courses','Transferencia y cursos'))}).click();
   await page.getByRole('button',{name:t('Add a red note','Agregar una nota roja'),exact:true}).click();
   const draft=page.getByRole('textbox',{name:t('Your guidance','Tu orientación'),exact:true});await draft.fill('Draft for navigation test');await inspect('binder');
   let warned=false;page.once('dialog',async dialog=>{warned=true;await dialog.dismiss();});await nav('Profile & code','Perfil y código');
   report(warned,'Sidebar navigation discarded an annotation without asking');report(await draft.count()===1,'Cancelled navigation lost the annotation');
   page.removeAllListeners('dialog');
   if(!audit){
    await page.getByRole('button',{name:t('Cancel','Cancelar'),exact:true}).click();await nav('Profile & code','Perfil y código');
    const nameInput=page.getByLabel(t('Name students will see','Nombre que verán los estudiantes'),{exact:true});await nameInput.fill('Unsaved name');
    let nameWarned=false;page.once('dialog',async dialog=>{nameWarned=true;await dialog.dismiss();});await nav('Overview','Resumen');
    report(nameWarned&&await nameInput.inputValue()==='Unsaved name','Profile changes were lost while navigating');
    await nameInput.fill(coordinatorName);await nav('Overview','Resumen');
    if(await menu.isVisible()){
     const before=await page.locator('.admin-header').boundingBox();await menu.click();report(await navigation.isVisible(),'Mobile menu did not open');
     const after=await page.locator('.admin-header').boundingBox();report(Math.abs(before.y-after.y)<1,'Opening the mobile menu pushed the page');
     const targets=await navigation.locator('button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));report(targets.every(height=>height>=44),'Mobile navigation has small tap targets');
     await page.screenshot({path:`${folder}/${language}-${width}-menu.png`});
     await page.keyboard.press('Escape');report(!await navigation.isVisible(),'Escape did not close mobile menu');report(await menu.evaluate(el=>el===document.activeElement),'Escape did not return focus to Menu');
    }
   }
   report(errors.length===0,errors.join('; '));console.log(`CHECKED ${language}/${width}x${height} ${reducedMotion}`);
  }finally{await page.close();}
 }}finally{await browser.close();}
 await writeFile(`${folder}/${audit?'before-':''}results.json`,JSON.stringify(problems,null,2));
 if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log('PASS: all coordinator views, responsive sizing, navigation focus, draft guards, loading and denied access.');
})().catch(error=>{console.error(error);process.exitCode=1;});
