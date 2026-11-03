// Real local UI, synthetic API and identity. PostgreSQL is verified separately.
const {createRequire}=require('node:module'),{mkdir}=require('node:fs/promises');
const assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5179').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'output/playwright/student-first-phase8';
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});let count=0;
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en,now=new Date().toISOString();
  const entry={id:'11111111-1111-4111-8111-111111111111',topic:'costs',kind:'question',language,content:t('From a student conversation summary; not a verbatim quote. Open question: I need help comparing college costs.','De un resumen de conversación con el estudiante; no es una cita literal. Pregunta pendiente: Necesito ayuda para comparar los costos de estudiar.')};
  const binder={id:'22222222-2222-4222-8222-222222222222',studentName:'Alex',publicationId:'33333333-3333-4333-8333-333333333333',version:2,publishedAt:now,expiresAt:new Date(Date.now()+86400000).toISOString(),topics:['costs'],isNew:true,helpRequested:true,entries:[entry]};
  let guidance=[],plans=[],planWrites=0,replies=[];const requests=[];
  const suggestion=t('Compare the aid estimates together.','Comparar juntos las estimaciones de ayuda.'),chosen=t('Compare one estimate with Jordan on Tuesday.','Comparar una estimación con Jordan el martes.'),reply=t('Could we review this together?','¿Podemos revisar esto juntos?');
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`export function useAuth0(){return {user:{sub:'synthetic'},getAccessTokenSilently:async()=> 'test.'+btoa(JSON.stringify({sub:'synthetic'}))+'.test',isAuthenticated:true,isLoading:false}}`});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   const body=route.request().postDataJSON();requests.push({path:url.pathname,body});let data;
   if(url.pathname==='/api/coordinator-notifications')data=body.action==='list'?{notifications:[{id:'help',kind:'help',createdAt:now,read:false}]}:{destination:'binder',grantId:binder.id};
   if(url.pathname==='/api/coordinator-binders')data=body.action==='list'?{counts:{all:1,new:1,help:1},binders:[binder],nextCursor:null}:binder;
   if(url.pathname==='/api/coordinator-feedback'){
    if(body.action.endsWith('-list'))data={feedback:guidance,writesEnabled:true};
    if(body.action==='staff-create'){
     assert.equal(body.kind,'suggested-step');assert.equal(body.body,suggestion);
     guidance=[{id:'44444444-4444-4444-8444-444444444444',topic:'costs',kind:body.kind,body:body.body,resourceUrl:'',version:1,authorName:'Jordan',organizationName:'Community Pilot',createdAt:now,editedAt:null,withdrawn:false,hidden:false,reviewed:false,connectionEnded:false,replyAvailable:true,publicationItemId:null,replyCount:0}];data={status:'saved'};
    }
    if(body.action==='student-reply'){assert.equal(body.body,reply);guidance[0].replyCount++;replies.push({id:'reply',body:reply,feedbackVersion:1,createdAt:now});data={status:'saved'};}
    if(body.action.endsWith('-thread'))data={revisions:[{version:1,body:suggestion,kind:'suggested-step',resourceUrl:'',createdAt:now}],replies};
   }
   if(url.pathname==='/api/plans'){
    if(body.action==='create'){assert.equal(body.fromFeedback.id,guidance[0].id);assert.equal(body.plan.steps[0].action,chosen);planWrites++;plans=[{...body.plan,id:'55555555-5555-4555-8555-555555555555',version:1}];}
    data={plans,creationIds:[],limited:false,supportsActions:true};
   }
   assert.ok(data,JSON.stringify(body));await route.fulfill({json:data});
  });
  await page.route('**/phase8-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:12px;font-family:system-ui"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';const {useState}=React;import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import Binders from '/src/CoordinatorBinders.tsx';import Notices from '/src/CoordinatorNotifications.tsx';import {GuidancePanel,useGuidanceRequest} from '/src/CoordinatorGuidance.tsx';import Plan from '/src/ActionPlan.tsx';
   import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');
   const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   const request=path=>async body=>{const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json()};
   function App(){const feedback=useGuidanceRequest();const [mode,setMode]=useState('staff'),[seed,setSeed]=useState(null),[opened,setOpened]=useState();return React.createElement(React.Fragment,null,
    React.createElement('button',{onClick:()=>{setMode(mode==='staff'?'student':'staff');setOpened(undefined)}},mode==='staff'?'Student view':'Coordinator view'),
    mode==='staff'?React.createElement(React.Fragment,null,React.createElement(Notices,{organizationId:'org',t,onOpen:v=>setOpened({grantId:v.grantId,sequence:Date.now()})}),React.createElement(Binders,{organizationId:'org',t,es:${language==='es'},request:request('coordinator-binders'),feedbackRequest:feedback,openRequest:opened})):
    React.createElement(React.Fragment,null,React.createElement(GuidancePanel,{studentId:'alex',t,request:feedback,onAction:setSeed}),React.createElement(Plan,{studentId:'alex',scopeStudentId:'alex',name:'Alex',role:'student',language:${JSON.stringify(language)},t,seed})))}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  </script></body></html>`}));
  try{
   await page.goto(origin+'/phase8-review');await page.locator('.coordinator-updates-heading').click();
   await page.getByText(t('A student asked for help with their shared selection.','Un estudiante pidió ayuda con su selección compartida.'),{exact:true}).waitFor();
   await page.getByRole('button',{name:t('Open update','Abrir novedad'),exact:true}).click();
   await page.getByRole('button',{name:t('Mark reviewed','Marcar como revisado'),exact:true}).waitFor();
   await page.locator('.coordinator-publication-topics button').filter({hasText:t('Paying for college','Pagar la universidad')}).click();
   await page.getByText(entry.content,{exact:true}).waitFor();
   await page.getByRole('button',{name:t('Write in the page margin','Escribir en el margen'),exact:true}).click();
   if(process.env.ORIGEN_SMOKE_ACCESSIBILITY==='true')assert.ok(await page.getByLabel(t('Your guidance','Tu orientación'),{exact:true}).evaluate(el=>el===document.activeElement));
   await page.getByText(t('Add a link or suggest a step','Agregar un enlace o sugerir un paso'),{exact:true}).click();
   const kind=page.getByRole('combobox',{name:/^(Type|Tipo)/});await kind.selectOption('suggested-step');
   if(process.env.ORIGEN_SMOKE_ACCESSIBILITY==='true'){await kind.focus();await page.keyboard.press('Tab');assert.ok(await page.getByLabel(t('Resource link (optional, https://)','Enlace de recurso (opcional, https://)'),{exact:true}).evaluate(el=>el===document.activeElement));}
   await page.getByLabel(t('Your guidance','Tu orientación'),{exact:true}).fill(suggestion);
   await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();await page.locator('.guidance-body').waitFor();assert.equal(planWrites,0);
   await page.getByRole('button',{name:'Student view',exact:true}).click();await page.locator('.guidance-body').waitFor();
   await page.getByRole('button',{name:t('Add to my next steps','Agregar a mis próximos pasos'),exact:true}).click();
   await page.getByLabel(t('Action title','Título de la acción'),{exact:true}).fill(t('Compare with Jordan','Comparar con Jordan'));
   await page.getByRole('textbox',{name:/^(What I want to do|Lo que quiero hacer)/}).fill(chosen);
   const save=page.getByRole('button',{name:t('Accept and save actions','Aceptar y guardar acciones'),exact:true});assert.equal(await save.isDisabled(),true);assert.equal(planWrites,0);
   const acceptance=page.getByLabel(t('I reviewed these actions and want them in my plan.','Revisé estas acciones y quiero agregarlas a mi plan.'),{exact:true});
   if(process.env.ORIGEN_SMOKE_ACCESSIBILITY==='true'){await acceptance.focus();await page.keyboard.press('Space');assert.equal(await acceptance.isChecked(),true);await save.focus();await page.keyboard.press('Enter');}else{await acceptance.check();await save.click();}
   await page.locator('.action-editor').waitFor({state:'detached'});assert.equal(planWrites,1);assert.equal(replies.length,0);
   await page.getByRole('button',{name:t('Reply','Responder'),exact:true}).click();await page.locator('.coordinator-guidance textarea').fill(reply);
   await page.getByRole('button',{name:t('Send reply to coordinator','Enviar respuesta al coordinador'),exact:true}).click();await page.locator('.coordinator-guidance textarea').waitFor({state:'detached'});assert.equal(replies.length,1);
   await page.getByRole('button',{name:'Coordinator view',exact:true}).click();await page.locator('.coordinator-binder-list button').first().click();
   await page.getByText(/1 (suggested steps|pasos sugeridos)/).waitFor();assert.ok(!(await page.locator('body').textContent()).includes(chosen));
   if(width===320)await page.screenshot({path:`${output}/${width}-${language}-coordinator.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
   assert.equal(requests.filter(r=>r.path==='/api/plans'&&r.body.action==='create').length,1);
   count++;console.log(`PASS ${width}/${language}: generic help notice, current publication, attributed suggestion, student correction and acceptance, private plan, explicit reply.`);
  }catch(e){console.error('Browser errors:',errors);await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true}).catch(()=>{});throw e;}finally{await page.close();}
 }}finally{await browser.close();}console.log(`Passed ${count} synthetic coordinator follow-through journeys.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
