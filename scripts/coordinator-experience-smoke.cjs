// Phase 5: real components, synthetic identities, and all APIs intercepted.
const {createRequire}=require('node:module'),assert=require('node:assert/strict'),{mkdir}=require('node:fs/promises');
const resolve=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'),{chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const gate=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/coordinator-experience',{recursive:true});
 try{for(const [width,language,motion] of [[1440,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:motion}),errors=[],writes=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en;
  let listGate,readGate,failSend=true,feedback=[],name='Jordan Coordinator';
  const now=new Date().toISOString();
  const entries=[...Array.from({length:3},(_,i)=>({id:`entry-${i}`,topic:'transfer',kind:'question',language:'en',content:`Conversation ${i+1}: Alex discussed balancing community college classes, work, and transferring into environmental science. `+('They wanted to compare the course sequence with a counselor. ').repeat(12)})),{id:'option-entry',topic:'options',kind:'note',language:'en',content:'We compared campus support for first-generation transfer students.'}];
  const binders=Array.from({length:12},(_,i)=>({id:`grant-${i}`,studentName:`Alexandra Rivera ${i+1}`,publicationId:`publication-${i}`,version:1,publishedAt:now,expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['transfer','options'],entries,isNew:false,helpRequested:false}));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'phase5-synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>'synthetic'};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.fulfill({body:''});
   const input=route.request().postDataJSON();let data;
   if(url.pathname==='/api/coordinator-access'){
    if(input.action==='overview')data={organizations:[{id:'org',name:'Community Opportunity Center',role:'owner',pilotStatus:'active',profile:{id:'profile',status:'active',displayName:name}}]};
    if(input.action==='profile')data={profile:{displayName:name,organizationName:'Community Opportunity Center'}};
    if(input.action==='save-profile'){name=input.displayName;data={ok:true};}
    if(input.action==='team')data={members:[{subject:'colleague',name:'Taylor Rivera',coordinatorStatus:'active',role:'outreach'}]};
   }
   if(url.pathname==='/api/coordinator-binders'){
    if(input.action==='list'){if(listGate)await listGate.promise;data={binders:input.search?binders.filter(b=>b.studentName.includes(input.search)):binders,counts:{all:12,new:0,help:0},nextCursor:null};}
    if(input.action==='read'){if(readGate)await readGate.promise;data=binders.find(b=>b.id===input.grantId);}
   }
   if(url.pathname==='/api/coordinator-feedback'){
    if(input.action==='staff-list')data={feedback,writesEnabled:true};
    if(input.action==='staff-create'){
     writes.push(input);if(failSend){failSend=false;return route.fulfill({status:503,json:{error:'feedback_unavailable'}});}
     feedback=[{id:'comment',topic:input.topic,publicationItemId:input.publicationItemId,kind:'guidance',body:input.body,resourceUrl:'',version:1,authorName:name,organizationName:'Community Opportunity Center',createdAt:now,editedAt:null,withdrawn:false,hidden:false,reviewed:false,connectionEnded:false,replyCount:0}];data={id:'comment'};
    }
   }
   if(url.pathname==='/api/coordinator-connections')data={connections:[]};
   assert.ok(data,`Unmocked ${url.pathname}/${input.action}`);return route.fulfill({json:data});
  });
  await page.route('**/phase5-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import Workspace from '/src/CoordinatorWorkspace.tsx';import '/src/styles.css';import '/src/brand.css';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('phase5-synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');localStorage.setItem('origen.language','${language}');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Workspace)));
  </script></html>`}));
  const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
  const nav=async(en,es)=>{const sidebar=page.getByRole('navigation',{name:t('Coordinator navigation','Navegación del coordinador')}),menu=page.locator('.coordinator-menu-toggle');if(await menu.isVisible()&&!await sidebar.isVisible())await menu.click();await sidebar.getByRole('button',{name:t(en,es),exact:true}).click();};
  const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
  try{
   await page.goto(origin+'/phase5-review');await page.locator('.coordinator-home-stats').waitFor();
   await nav('Shared binders','Carpetas compartidas');const student=page.locator('[data-binder-id="grant-8"]');await student.waitFor();await page.evaluate(()=>document.fonts.ready);await settle();
   assert.equal(await student.locator('.coordinator-student-avatar').textContent(),'A9');
   await student.scrollIntoViewIfNeeded();await settle();const originalY=await page.evaluate(()=>scrollY);
   readGate=gate();await student.click();await page.locator('.shared-binder-placeholder').waitFor();assert.equal(await page.getByRole('combobox',{name:t('Current divider','Sección actual')}).isDisabled(),true);readGate.release();readGate=undefined;
   await page.locator('.shared-notebook-overview').waitFor();await settle();
   assert.equal(await page.locator('.shared-binder-identity strong').textContent(),'Alexandra Rivera 9');
   const divider=page.getByRole('combobox',{name:t('Current divider','Sección actual')});
   await divider.selectOption('transfer');await page.locator('.shared-paper-row .ink-add').first().waitFor();await settle();
   assert.equal(await page.locator('.shared-divider-heading').evaluate(el=>el===document.activeElement),true,'Divider shortcut did not focus the page');
   const positions=await page.evaluate(()=>({toolbar:document.querySelector('.shared-binder-toolbar').getBoundingClientRect().bottom,heading:document.querySelector('.shared-divider-heading').getBoundingClientRect().top}));
   assert.ok(positions.heading>=positions.toolbar,`Sticky toolbar hides divider heading: ${JSON.stringify(positions)}`);
   await noOverflow();await page.screenshot({path:`output/playwright/coordinator-experience/${width}-${language}-paper.png`});
   const second=page.locator('.shared-paper-row').nth(1);await second.locator('.ink-add').click();const editor=page.getByRole('textbox',{name:t('Your guidance','Tu orientación'),exact:true});await editor.waitFor();await settle();
   await editor.press('Escape');await editor.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement===document.querySelectorAll('.shared-paper-row .ink-add')[1]);
   await second.locator('.ink-add').click();await editor.fill('We can compare these transfer requirements together. '+('Bring your course list. ').repeat(35));await settle();
   // A cancelled divider change must preserve both placement and writing.
   page.once('dialog',dialog=>dialog.dismiss());await divider.selectOption('options');assert.equal(await divider.inputValue(),'transfer');assert.equal(await editor.count(),1);
   await editor.press('Control+Enter');await page.locator('.ink-editor-error').waitFor();const draft=await editor.inputValue();assert.ok(draft.length>500);
   await page.getByRole('button',{name:t('Try sending again','Intentar enviar de nuevo'),exact:true}).click();await page.locator('[data-comment-id="comment"]').waitFor();await settle();
   assert.equal(writes.length,2);assert.equal(writes[0].requestId,writes[1].requestId,'Retry duplicated the comment identity');assert.equal(writes[1].publicationItemId,'entry-1');
   assert.equal(await second.locator('[data-comment-id="comment"] .guidance-body').textContent(),draft);
   const scroll=await second.locator('.binder-annotation-content').evaluate(el=>({content:el.scrollHeight,height:el.clientHeight}));assert.ok(scroll.content>scroll.height,'Long comments are not bounded and scrollable');
   await divider.selectOption('options');await page.locator('.shared-paper-row').first().waitFor();assert.equal(await page.locator('[data-comment-id="comment"]').count(),0,'Comment leaked to another divider');
   await page.getByRole('button',{name:t('Close binder','Cerrar carpeta'),exact:true}).click();await student.waitFor();await settle();
   assert.equal(await student.evaluate(el=>el===document.activeElement),true,'Closing lost the original card focus');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-originalY)<3,'Closing lost the original list position');
   // Old results stay in place, but cannot be opened while a new search is pending.
   const search=page.getByRole('searchbox');await search.fill('Nobody');listGate=gate();await page.getByRole('button',{name:t('Search','Buscar'),exact:true}).click();await page.locator('.coordinator-binders[aria-busy="true"]').waitFor();assert.equal(await student.isDisabled(),true);listGate.release();listGate=undefined;
   await page.locator('.coordinator-binder-list button').first().waitFor({state:'detached'});await page.getByRole('button',{name:t('Clear search','Borrar búsqueda'),exact:true}).click();await student.waitFor();assert.equal(await search.inputValue(),'');
   await nav('Connections','Conexiones');await page.getByRole('heading',{name:t('Your students will appear here','Tus estudiantes aparecerán aquí')}).waitFor();await noOverflow();
   await nav('Profile & code','Perfil y código');const save=page.getByRole('button',{name:t('Save name','Guardar nombre'),exact:true});assert.equal(await save.isDisabled(),true);const nameInput=page.getByLabel(t('Name students will see','Nombre que verán los estudiantes'),{exact:true});await nameInput.fill('Jordan Updated');await settle();const beforeSave=await page.locator('.coordinator-profile').boundingBox();await save.click();await page.waitForFunction(()=>document.querySelector('.coordinator-profile input')?.value==='Jordan Updated'&&document.querySelector('.coordinator-profile form button')?.disabled);await noOverflow();await settle();const afterSave=await page.locator('.coordinator-profile').boundingBox();assert.ok(Math.abs(beforeSave.y-afterSave.y)<2,'Save confirmation moved the profile');await page.screenshot({path:`output/playwright/coordinator-experience/${width}-${language}-profile.png`,fullPage:true});
   await nav('Your team','Tu equipo');await page.getByText('Taylor Rivera',{exact:true}).waitFor();await noOverflow();
   assert.deepEqual(errors,[]);console.log(`PASS ${width}/${language}/${motion}: student identity, sticky divider, exact return, guarded draft, same-note focus, retry, bounded comments, topic isolation, search recovery, supporting pages.`);
  }catch(error){console.error(errors);await page.screenshot({path:`output/playwright/coordinator-experience/${width}-failure.png`,fullPage:true});throw error;}finally{listGate?.release();readGate?.release();await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
