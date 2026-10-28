// Real UI with synthetic identity and intercepted APIs. Never writes to production.
const {createRequire}=require('node:module');
const {mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const output='output/playwright/phase6-organizations';
const configs=[{width:1440,es:false},{width:390,es:true},{width:320,es:false,reduced:true}];
(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 try{for(const config of configs){for(const mode of ['admin','organization','registration']){
  // Administration is currently English; owner and registration surfaces are bilingual.
  const es=config.es&&mode!=='admin',t=(en,sp)=>es?sp:en,mobile=config.width<=700;
  const page=await browser.newPage({viewport:{width:config.width,height:900},reducedMotion:config.reduced?'reduce':'no-preference'}),errors=[],unexpected=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const content={name:'Synthetic College',website:'https://college.example/',description:'A synthetic organization for local UI checks.',programs:'Synthetic programs',admissions:'',financialAid:'',events:'',publicEmail:'',links:[]};
  const institutions=[1,2].map(i=>({id:'org-'+i,page:{...content,name:content.name+' '+i},revision:1,status:'submitted',verificationStatus:'pending',membershipRole:'owner',unitType:'institution',parentApproval:'approved',representatives:[{first_name:'Synthetic Owner',work_email:'owner@example.test',job_role:'Owner'}]}));
  const applications=[1,2].map(i=>({id:'app-'+i,displayName:'Test Coordinator '+i,email:'coordinator'+i+'@example.test',organizationName:'Synthetic College 1',organizationWebsite:'',jobRole:'Advisor',status:'pending',reviewNote:'',createdAt:'2026-10-28T12:00:00Z'}));
  let failOrganization=true,failCoordinator=true,failQueue=false,registrationStatus='pending';
  await page.addInitScript(es=>{localStorage.setItem('origen.language',es?'es':'en');},es);
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'synthetic-${mode}',given_name:'Synthetic',email:'owner@example.test'},getAccessTokenSilently:async()=> 'synthetic',isAuthenticated:true,isLoading:false,logout:async()=>{},loginWithRedirect:async()=>{}};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const input=route.request().postDataJSON();let data,status=200;
   if(url.pathname==='/api/admin'){
    if(input.action==='access')data={actions:['overview','users'],permissions:['manage:institutions','read:users']};
    if(input.action==='overview')data={totals:{},users:[],activity:[]};
    if(input.action==='approved-directory')data={items:input.kind==='coordinators'?applications.filter(x=>x.status==='approved').map(x=>({id:x.id,name:x.displayName,email:x.email,organizationName:x.organizationName,status:'active'})):institutions.filter(x=>x.status==='published').map(x=>({id:x.id,name:x.page.name,status:'active'})),next:''};
    if(input.action==='coordinator-activation')data={id:input.id,passwordSetAt:'2026-10-28T12:00:00Z',firstSignInAt:null,trackingStartedAt:'2026-10-27T12:00:00Z',lastReceivedAt:null,trackingEnabled:true};
    if(input.action==='coordinator-overview')data={id:input.id,days:input.days,active:true,linkedStudents:3,sharedBinders:2,pendingConnections:0,guidanceEntries:4,reviewedEntries:2,lastGuidanceAt:null};
    if(input.action==='organization-overview')data={organizationId:input.organizationId,days:input.days,generatedAt:'2026-10-28T12:00:00Z',periodStart:'2026-09-28T12:00:00Z',periodEnd:'2026-10-28T12:00:00Z',activeCoordinators:1,totalCoordinators:1,linkedStudents:3,sharedBinders:2,pendingConnections:0,voiceMinutes:15,voiceCalls:2,voiceTrackingSince:null};
   }
   if(url.pathname==='/api/institutions'){
    if(input.action==='load')data={institutions,adminReview:mode==='admin',canReview:mode==='admin',coordinatorAccountsEnabled:true,notifications:[],unitRequests:[],authorizedUnits:[],affiliationRequests:[]};
    if(input.action==='queue'&&failQueue){failQueue=false;return route.fulfill({status:503,json:{error:'unavailable'}});}
    if(input.action==='queue')data={submissions:institutions.filter(x=>x.status==='submitted'&&x.page.name.toLowerCase().includes((input.search||'').toLowerCase())&&(input.filter!=='ready'||x.verificationStatus==='verified')),next:''};
    if(['verify','publish'].includes(input.action)){
     writes.push(input);await new Promise(r=>setTimeout(r,250));
     if(failOrganization){failOrganization=false;status=503;data={error:'unavailable'};}
     else{const item=institutions.find(x=>x.id===input.id);assert.equal(item.revision,input.revision);item.revision++;if(input.action==='verify')item.verificationStatus='verified';else{item.status='published';failQueue=true;}data={};}
    }
    if(input.action==='signup-status')data={organization:null};
   }
   if(url.pathname==='/api/coordinator-access'){
    if(input.action==='applications')data={applications:applications.filter(x=>x.status==='pending')};
    if(input.action==='application-organizations')data={organizations:[{id:'org-1',name:'Synthetic College 1'}]};
    if(input.action==='approve-application'){
     writes.push(input);await new Promise(r=>setTimeout(r,250));
     if(failCoordinator){failCoordinator=false;status=503;data={error:'coordinator_access_unavailable'};}
     else{applications.find(x=>x.id===input.id).status='approved';data={};}
    }
    if(input.action==='organization-queue')data={canApprove:true,organizations:[{id:'org-1',name:'Synthetic College 1',pilotStatus:'active',pilotRevision:1,verificationStatus:'verified'}],next:''};
    if(input.action==='application-status')data={application:{...applications[0],status:registrationStatus}};
   }
   if(!data){unexpected.push(`${url.pathname}/${input.action}`);return route.fulfill({status:500,json:{error:'unexpected_test_request'}});}
   return route.fulfill({status,json:data});
  });
  const component=mode==='admin'?'AdminDashboard':mode==='organization'?'InstitutionPortal':'CoordinatorRegistration';
  await page.route('**/phase6-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${es?'es':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import '/src/styles.css';import '/src/brand.css';import Page from '/src/${component}.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('synthetic-${mode}',{fresh:true});setAPITokenProvider(async()=>'synthetic');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Page,${mode==='admin'?"{initialView:'approvals'}":'{}'})));
  </script></body></html>`}));
  async function noOverflow(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow');}
  async function selectRow(text){await page.locator('.org-review-row').filter({hasText:text}).click();}
  async function ownerTab(en,sp){if(mobile)await page.getByRole('button',{name:t('Organization menu','Menú de organización'),exact:true}).click();await page.getByRole('button',{name:t(en,sp),exact:true}).click();}
  try{
   await page.goto(origin+'/phase6-review');
   if(mode==='admin'){
    await page.getByRole('textbox',{name:'Search organizations',exact:true}).fill('Synthetic');await page.getByRole('button',{name:'Search',exact:true}).click();
    await selectRow('Synthetic College 1');await noOverflow();
    const note=page.getByLabel('Review note',{exact:false});await note.fill('Confirmed with an authorized synthetic representative.');
    await page.getByRole('button',{name:'Confirm affiliation',exact:true}).click();await page.getByRole('alert').filter({hasText:'Could not complete'}).waitFor();assert.match(await note.inputValue(),/Confirmed/);
    await page.getByRole('button',{name:'Confirm affiliation',exact:true}).click();await page.getByRole('heading',{name:'Synthetic College 1: affiliation confirmed',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Approve and publish',exact:true}).count(),0);
    await page.getByRole('button',{name:'Continue this review',exact:true}).click();await note.fill('The submitted page is approved.');await page.getByRole('button',{name:'Approve and publish',exact:true}).click();
    await page.getByRole('heading',{name:'Synthetic College 1: approved and published',exact:true}).waitFor();
    await page.getByRole('alert').filter({hasText:'The decision was saved, but the queue could not refresh.'}).waitFor();await page.screenshot({path:`${output}/admin-${config.width}-saved.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Next application',exact:true}).click();await page.getByRole('heading',{name:'Synthetic College 2',exact:true}).waitFor();
    if(mobile){await page.getByRole('button',{name:'Back to queue',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Search organizations',exact:true}).inputValue(),'Synthetic');}
    await page.getByRole('button',{name:'Coordinators',exact:true}).click();await selectRow('Test Coordinator 1');
    await page.getByText('✓ Organization affiliation confirmed', {exact:false}).waitFor();
    const message=page.getByLabel('Message the applicant will see');await message.fill('Welcome to our synthetic community.');
    await page.getByRole('button',{name:'Approve coordinator access',exact:true}).click();await page.locator('.approval-review-feedback[role=alert]').waitFor();assert.equal(await message.inputValue(),'Welcome to our synthetic community.');
    await page.getByRole('button',{name:'Approve coordinator access',exact:true}).click();await page.getByRole('heading',{name:'Coordinator access approved for Test Coordinator 1.',exact:true}).waitFor();
    await page.getByRole('button',{name:'Next application',exact:true}).click();await page.getByRole('heading',{name:'Test Coordinator 2',exact:true}).waitFor();
    await page.getByRole('button',{name:'Review organization access',exact:true}).click();await page.getByRole('heading',{name:'Synthetic College 1',exact:true}).waitFor();await page.getByRole('heading',{name:'At a glance'}).waitFor();await noOverflow();
    await page.goBack();await page.getByRole('heading',{name:'Test Coordinator 2',exact:true}).waitFor();
    await page.getByRole('button',{name:'Approved',exact:true}).click();if(mobile)await selectRow('Test Coordinator 1');
    await page.getByText('Password set',{exact:true}).waitFor();await page.getByText('Not yet recorded',{exact:true}).waitFor();await noOverflow();
    await page.screenshot({path:`${output}/admin-${config.width}-approved.png`,fullPage:true,animations:'disabled'});
    assert.deepEqual(writes.map(x=>x.action),['verify','verify','publish','approve-application','approve-application']);
   }else if(mode==='organization'){
    await page.getByLabel(t('Active workspace','Espacio activo'),{exact:true}).selectOption('org-2');
    await ownerTab('Programs and events','Programas y eventos');await page.getByRole('heading',{name:t('Programs and opportunities','Programas y oportunidades'),exact:true}).waitFor();
    await page.reload();await page.getByRole('heading',{name:t('Programs and opportunities','Programas y oportunidades'),exact:true}).waitFor();assert.equal(await page.getByLabel(t('Active workspace','Espacio activo'),{exact:true}).inputValue(),'org-2');
    await ownerTab('Overview','Resumen');await page.getByRole('heading',{name:t('Workspace updates','Novedades del espacio'),exact:true}).waitFor();await noOverflow();
    assert.equal(await page.locator('.registration-progress [aria-current=step]').innerText(),t('2\nVerification\nCurrent step','2\nVerificación\nPaso actual'));
    await page.screenshot({path:`${output}/owner-${config.width}-${es?'es':'en'}.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:t('Edit draft','Editar borrador'),exact:true}).click();
    const description=page.locator('.institution-editor textarea').first();await description.fill('Synthetic unsaved edits.');
    page.once('dialog',d=>d.dismiss());await ownerTab('Team and settings','Equipo y ajustes');assert.equal(await description.inputValue(),'Synthetic unsaved edits.');
    page.once('dialog',d=>d.accept());if(mobile){/* Cancel leaves the navigation open. */await page.getByRole('button',{name:t('Team and settings','Equipo y ajustes'),exact:true}).click();}else await ownerTab('Team and settings','Equipo y ajustes');
    await page.getByRole('heading',{name:t('Team and publication settings','Equipo y ajustes de publicación'),exact:true}).waitFor();await noOverflow();assert.equal(writes.length,0);
   }else{
    await page.getByRole('heading',{name:t('Your application is awaiting review','Tu solicitud está pendiente de revisión'),exact:true}).waitFor();
    assert.ok((await page.locator('.registration-progress [aria-current=step]').innerText()).includes(t('Review','Revisión')));
    registrationStatus='approved';await page.reload();await page.getByRole('heading',{name:t('Your application was approved','Tu solicitud fue aprobada'),exact:true}).waitFor();
    assert.ok((await page.locator('.registration-progress [aria-current=step]').innerText()).includes(t('Workspace access','Acceso al espacio')));
    assert.equal(await page.locator('.registration-progress [data-state=complete]').count(),3);await noOverflow();
   }
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(`PASS ${mode} ${config.width} ${es?'Spanish':'English'}${config.reduced?' reduced motion':''}`);
  }catch(e){await page.screenshot({path:`${output}/failure-${mode}-${config.width}.png`,fullPage:true,animations:'disabled'});console.error({mode,config,errors,unexpected,body:(await page.locator('body').innerText()).slice(-3500)});throw e;}finally{await page.close();}
 }}}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
