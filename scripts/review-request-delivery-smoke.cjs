// Actual coordinator workspace and student request components, scoped HTTP
// handlers and isolated PostgreSQL. Only identities are synthetic.
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto'),{mkdir,writeFile}=require('node:fs/promises');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const folder=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-review-step5-browser';
(async()=>{
 const {coordinatorPilotFixture}=await import('../server/fixtures/coordinator-pilot.mjs');await mkdir(folder,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});let journeys=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true,language});let page;
  try{
   const t=(en,es)=>language==='es'?es:en,account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
   await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
   const question=t('Could I qualify for an insurance waiver?','¿Podría solicitar una exención del seguro?');
   const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
   const draft=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language,kind:'question',originalQuestion:'PRIVATE_ORIGINAL_SENTINEL',proposedClarification:question,entries:[{id:f.notes[1],version:1}]})).request;
   const preview=(await student({action:'preview',id:draft.id,version:1,wording:'clarification'})).preview;
   await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true});await f.sweep();
   page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());let failResponse=true;
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"const auth={user:{get sub(){return window.actor}},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>window.actor,logout:async()=>{},loginWithRedirect:async()=>{}};export function useAuth0(){return auth}"});
    if(url.pathname.startsWith('/api/')){
     const actor=route.request().headers().authorization?.replace('Bearer ','');assert.ok(['staff','other'].includes(actor),url.pathname);
     const input=route.request().postDataJSON(),result=await f.request(actor,url.pathname,input);
     if(process.env.ORIGEN_SMOKE_DEBUG==='1')console.log(url.pathname,input.action,result.status,result.body.error||result.body.destination||'');
     if(url.pathname==='/api/coordinator-review-requests'&&input.action==='respond'&&result.status===200&&failResponse){failResponse=false;return route.abort('failed');}
     return route.fulfill({status:result.status,json:result.body});
    }
    if(url.origin===origin)return route.continue();return route.fulfill({status:200,body:''});
   });
   await page.route('**/review-delivery-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module">
    import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import '/src/styles.css';import '/src/brand.css';
    import Workspace from '/src/CoordinatorWorkspace.tsx';import Notices from '/src/CoordinatorNotifications.tsx';import {StudentReviewRequestsProvider,StudentReviewRequests,StudentReviewRequestEntry} from '/src/StudentReviewRequests.tsx';
    import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
    window.actor='staff';localStorage.setItem('origen.language','${language}');browserPrivacy.start('staff',{fresh:true});setAPITokenProvider(async()=>window.actor);
    const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
    function App(){const [mode,setMode]=React.useState('staff'),[opened,setOpened]=React.useState();window.switchReviewActor=actor=>{window.actor=actor;browserPrivacy.start(actor,{fresh:true});setOpened(undefined);setMode(actor);};
     return mode==='staff'?React.createElement(Workspace):React.createElement('main',{style:{padding:'16px',maxWidth:'800px',margin:'auto'}},React.createElement(StudentReviewRequestsProvider,{studentId:'alex',language:${JSON.stringify(language)},t},React.createElement(Notices,{studentId:'alex',t,onOpen:v=>setOpened({id:v.grantId,sequence:Date.now()})}),React.createElement(StudentReviewRequests,{openRequest:opened})));
    }ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
   </script></body></html>`}));
   await page.goto(origin+'/review-delivery-smoke',{waitUntil:'domcontentloaded'});
   await page.locator('.coordinator-review-requests').waitFor();await page.locator('.coordinator-updates-heading').click();await page.getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();
   const detail=page.locator('.coordinator-review-detail');await detail.waitFor();assert.ok((await detail.innerText()).includes(question));assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_ORIGINAL_SENTINEL'));
   await detail.getByRole('button',{name:t('Mark reviewed','Marcar como revisada'),exact:true}).click();await page.getByRole('status').filter({hasText:/Marked reviewed|Marcada como revisada/}).waitFor();
   let guidance=t('Your existing coverage may qualify. Compare the campus requirements before applying.','Tu cobertura actual podría cumplir los requisitos. Compara las condiciones del campus antes de solicitar la exención.');
   const action=t('Ask the health insurance office about the waiver deadline.','Pregunta en la oficina del seguro médico por la fecha límite para solicitar la exención.');
   await detail.getByRole('textbox',{name:t('Guidance','Orientación'),exact:true}).fill(guidance);
   await detail.getByLabel(t('Suggested next action (optional)','Próxima acción sugerida (opcional)'),{exact:true}).fill(action);
   await detail.getByLabel(t('Resource link (optional)','Enlace de referencia (opcional)'),{exact:true}).fill('https://example.edu/waiver');
   await detail.getByLabel(t('Suggested follow-up date (optional)','Fecha sugerida para seguimiento (opcional)'),{exact:true}).fill('2027-02-01');
   await detail.getByRole('button',{name:t('Share response with student','Compartir respuesta con estudiante'),exact:true}).click();
   await page.getByRole('button',{name:t('Check saved response','Comprobar respuesta guardada'),exact:true}).click();await detail.getByRole('button',{name:t('Withdraw response','Retirar respuesta'),exact:true}).waitFor();
   assert.equal(await detail.getByRole('textbox',{name:t('Guidance','Orientación'),exact:true}).inputValue(),guidance);
   assert.ok(await detail.getByRole('button',{name:t('Save revised response','Guardar respuesta revisada'),exact:true}).isDisabled());
   assert.equal((await student({action:'get',id:draft.id})).request.coordinatorReview.response.version,1);
   assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-response'",[draft.id])).rows[0].n,1);
   if(width===1280&&language==='en'){
    // A second session saves exactly the draft being typed here. Later refreshes
    // must keep the conflict recovery control even though the forms now match.
    guidance+=' Use the current campus checklist.';
    await detail.getByRole('textbox',{name:'Guidance',exact:true}).fill(guidance);
    const receipt=(await student({action:'get',id:draft.id})).request;
    await f.call('staff','/api/coordinator-review-requests',{action:'respond',organizationId:f.org,id:draft.id,publicationId:receipt.publication.id,version:1,operationId:randomUUID(),guidance,suggestedAction:action,resourceUrl:'https://example.edu/waiver',followUpOn:'2027-02-01'});
    const refresh=async()=>{const read=page.waitForResponse(r=>r.url().endsWith('/api/coordinator-review-requests')&&r.request().postDataJSON()?.action==='read');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await read;};
    await refresh();await page.getByRole('button',{name:'Check saved response',exact:true}).waitFor();await refresh();
    await page.getByRole('button',{name:'Check saved response',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Showing the latest saved record'}).waitFor();assert.equal(await detail.getByRole('textbox',{name:'Guidance',exact:true}).inputValue(),guidance);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${folder}/${width}-${language}-coordinator.png`,fullPage:true});
   await f.sweep();await page.evaluate(()=>window.switchReviewActor('other'));await page.locator('.coordinator-updates-heading').click();await page.locator('.coordinator-updates li').filter({hasText:/responded to your review request|respondió a tu solicitud/}).getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();
   const sheet=page.locator('.review-request-sheet');await sheet.waitFor();assert.ok((await sheet.innerText()).includes(guidance));assert.ok((await sheet.innerText()).includes(action));assert.match(await sheet.innerText(),/stays private|es privado/);assert.equal(await sheet.getByRole('link').getAttribute('href'),'https://example.edu/waiver');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${folder}/${width}-${language}-student.png`,fullPage:true});
   await sheet.getByRole('button',{name:t('Withdraw request','Retirar solicitud'),exact:true}).click();await sheet.getByText(t('I withdrew this request.','Retiré esta solicitud.'),{exact:true}).first().waitFor();
   assert.ok((await sheet.innerText()).includes(guidance),'Student keeps their privately received response after ending coordinator access.');
   await page.evaluate(()=>window.switchReviewActor('staff'));await page.locator('.coordinator-review-requests').waitFor();await page.getByRole('button',{name:/View requests|Ver solicitudes/}).click();await page.getByText(t('No approved requests are available yet.','Todavía no hay solicitudes aprobadas disponibles.'),{exact:true}).waitFor();
   assert.ok(!(await page.locator('body').innerText()).includes(question));assert.deepEqual(errors,[]);journeys++;console.log(`PASS ${width}px ${language}: delivered request, exact selection, review, lost response recovery, student receipt and withdrawal.`);
  }catch(error){if(page){await page.screenshot({path:`${folder}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${folder}/failure.txt`,await page.locator('body').innerText().catch(()=>''));}throw error;}finally{await page?.unrouteAll({behavior:'wait'});await page?.close();await f.close();}
 }}finally{await browser.close();}
 console.log(`${journeys} coordinator delivery browser journeys passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
