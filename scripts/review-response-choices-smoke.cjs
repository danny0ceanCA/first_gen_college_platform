// Real React controls and CSS, synthetic API/voice transport. Server ownership,
// lifecycle and voice consent are covered separately with disposable PostgreSQL.
const {chromium}=require('playwright');
const {mkdir,writeFile}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5183';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-response-step4-browser';
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});const results=[];
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'}),errors=[],calls=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('dialog',dialog=>dialog.accept());
  const t=(en,es)=>language==='es'?es:en,now=new Date().toISOString(),id=randomUUID(),ref={kind:'review-response',requestId:id,responseVersion:1};
  const suggestion=t('Ask which proof of coverage is accepted.','Preguntar qué comprobante de cobertura aceptan.'),accepted=t('Ask the insurance office about the proof from my employer.','Preguntar a la oficina de seguros sobre el comprobante de mi trabajo.');
  let withdrawn=false,choice={state:'available',revision:0,reviewOn:null,shouldOffer:true},plans=[],creationIds=[];
  const record=()=>({id,version:2,studentId:'alex',status:'submitted',originalQuestion:t('Which insurance waiver documents are accepted?','¿Qué documentos aceptan para la exención del seguro?'),proposedClarification:'',kind:'question',language,createdAt:now,submittedAt:now,recipient:{connectionId:randomUUID(),coordinatorName:'Maria Rivera',organizationName:'Community College'},entries:[],publication:{wording:'original',access:'active',notification:'delivered',expiresAt:'2099-01-01T00:00:00Z',responded:true},coordinatorReview:{openedAt:now,reviewedAt:null,response:{version:withdrawn?2:1,status:withdrawn?'withdrawn':'available',guidance:withdrawn?'':t('Your work coverage may qualify if it meets the campus requirements.','La cobertura de tu trabajo podría ser válida si cumple los requisitos de la universidad.'),suggestedAction:withdrawn?'':suggestion,resourceUrl:'',followUpOn:'2027-03-01',updatedAt:now}}});
  const planData=()=>({plans:plans.map(plan=>({...plan,steps:plan.steps.map(step=>({...step,responseSource:{availability:withdrawn?'unavailable':'current',source:withdrawn?null:ref,responseVersion:1,acceptedAt:now}}))})),creationIds,supportsActions:true,limited:false});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"export function useAuth0(){return {user:{sub:'synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:'synthetic'}))+'.test'}}"});
   if(url.pathname.startsWith('/api/')){
    const body=route.request().postDataJSON();calls.push({path:url.pathname,...body});let data,status=200;
    if(url.pathname==='/api/review-requests')data=body.action==='get'?{request:record()}:{enabled:true,available:true,deliveryEnabled:true,requests:[record()],activity:[],nextCursor:null};
    else if(url.pathname==='/api/student-follow-up-report')data={enabled:false,canSave:false,planVersion:1,reports:[]};
   else if(url.pathname==='/api/student-follow-up')data={enabled:false,items:[],remaining:0,pending:0};
    else if(url.pathname==='/api/review-response-choices'){
     if(withdrawn){status=404;data={error:'review_response_unavailable'};}
     else{
      assert.deepEqual(body.source,ref);assert.equal(body.studentId,'alex');
      if(body.action==='defer'||body.action==='revisit'){
       assert.equal(body.revision,choice.revision);assert.ok(body.operationId);
       choice={state:body.action==='defer'?'deferred':'available',revision:choice.revision+1,reviewOn:body.action==='defer'?body.reviewOn:null,shouldOffer:body.action!=='defer'};
      }
      data={enabled:true,available:true,source:ref,availability:'current',choice,acceptedActionCount:plans.length};
     }
    }else if(url.pathname==='/api/review-response-context'){
     if(body.action==='verify')data={status:withdrawn?'changed':'current'};
     else data=withdrawn?{status:'unavailable'}:{status:'retrieved',response:{source:ref,suggestedAction:suggestion,guidance:record().coordinatorReview.response.guidance},guard:{source:ref,revision:'a'.repeat(64),mode:'focus'}};
    }else if(url.pathname==='/api/plans'){
     if(body.action==='create'){
      assert.equal(body.fromResponse.confirmed,true);assert.deepEqual(body.fromResponse.source,ref);assert.equal(body.plan.studentId,'alex');
      assert.equal(body.plan.steps[0].action,accepted);assert.equal(body.plan.steps[0].status,'not-started');assert.deepEqual(body.plan.steps[0].sources,[]);
      if(withdrawn){status=404;data={error:'review_response_unavailable'};}
      else if(!creationIds.includes(body.requestId)){creationIds.push(body.requestId);plans.push({...body.plan,id:randomUUID(),version:1,createdAt:now,updatedAt:now});}
     }
     data=data||planData();
    }else{status=503;data={error:'synthetic_unavailable'};}
    return route.fulfill({status,json:data});
   }
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:'/* Offline fixture uses the existing system-font fallback. */'});
   if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.route('**/response-choice-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:16px;background:#f5f5ee"><div id="root"></div>
  <script type="module">
  import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
  import {StudentReviewRequestsProvider,StudentReviewRequests} from '/src/StudentReviewRequests.tsx';import ActionPlan from '/src/ActionPlan.tsx';import {SharedVoiceContext} from '/src/SharedVoiceContext.ts';
  import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/PersonalBinder.css';
  browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');window.stopPrivacy=()=>browserPrivacy.stop('logout');window.focuses=[];
  const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
  function App(){const [seed,setSeed]=React.useState(null);return React.createElement(SharedVoiceContext.Provider,{value:{ready:true,talkAbout:focus=>window.focuses.push(focus)}},React.createElement('main',{style:{maxWidth:'1000px',margin:'auto'}},
   React.createElement(StudentReviewRequestsProvider,{studentId:'alex',language:${JSON.stringify(language)},t,onAction:value=>{window.lastSeed=value;setSeed(value);}},React.createElement(StudentReviewRequests)),
   React.createElement(ActionPlan,{studentId:'alex',name:'Alex',role:'student',language:${JSON.stringify(language)},t,seed})));}
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`}));
  const button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true});
  const open=async()=>{await page.getByRole('button',{name:new RegExp(t('^My requests','^Mis solicitudes'))}).click();await button('Review later','Revisar después').waitFor();};
  try{
   await page.goto(origin+'/response-choice-smoke');await open();
   assert.equal(plans.length,0);await button('Review later','Revisar después').click();await page.getByLabel(t('Review date (optional)','Fecha para revisar (opcional)')).fill('2099-01-01');
   await button('Keep for later','Dejar para después').click();await page.getByText(t('I chose to review this on 2099-01-01.','Elegí revisar esto el 2099-01-01.')).waitFor();
   assert.equal(choice.shouldOffer,false);assert.equal(plans.length,0);
   await page.screenshot({path:`${output}/${width}-${language}-deferred.png`,fullPage:true});
   await button('Talk about this','Hablemos de esto').click();await page.waitForFunction(()=>window.focuses.length===1);
   assert.deepEqual(await page.evaluate(()=>window.focuses[0]),{kind:'review-response',studentId:'alex',topic:'costs',source:ref});assert.equal(choice.state,'available');assert.equal(plans.length,0);
   await open();await button('Add to my next steps','Agregar a mis próximos pasos').click();
   const wording=page.getByRole('textbox',{name:new RegExp(t('^What I want to do','^Lo que quiero hacer'))});await wording.waitFor();await page.waitForFunction(expected=>document.querySelector('.action-editor textarea')?.value===expected,suggestion);
   assert.equal((await page.evaluate(()=>window.lastSeed)).content,'');assert.equal(plans.length,0);assert.equal(await page.getByRole('combobox',{name:t('Save in','Guardar en'),exact:true}).count(),0);
   const save=button('Accept and save actions','Aceptar y guardar acciones'),accept=page.getByLabel(t('I reviewed these actions and want them in my plan.','Revisé estas acciones y quiero agregarlas a mi plan.'),{exact:true});
   assert.equal(await save.isDisabled(),true);await page.getByLabel(t('Action title','Título de la acción'),{exact:true}).fill(t('Ask about my work coverage','Preguntar sobre mi cobertura del trabajo'));await wording.fill(accepted);await accept.check();
   await page.getByLabel(t('Notes (optional)','Notas (opcional)'),{exact:true}).fill(t('My private choice.','Mi decisión privada.'));assert.equal(await accept.isChecked(),false);assert.equal(await save.isDisabled(),true);
   await accept.check();await save.click();await page.getByText(accepted,{exact:true}).waitFor();assert.equal(plans.length,1);assert.equal(calls.filter(c=>c.path==='/api/plans'&&c.action==='create').length,1);
   await page.screenshot({path:`${output}/${width}-${language}-saved.png`,fullPage:true});
   await open();await button('Add to my next steps','Agregar a mis próximos pasos').click();await wording.waitFor();await page.waitForFunction(expected=>document.querySelector('.action-editor textarea')?.value===expected,suggestion);
   withdrawn=true;await page.waitForFunction(()=>!document.querySelector('.action-editor'),{},{timeout:12000});
   assert.equal(plans.length,1);await page.getByText(accepted,{exact:true}).waitFor();await page.getByText(t('The source response is no longer available. My accepted action is still private.','La respuesta de origen ya no está disponible. Mi acción aceptada sigue siendo privada.')).waitFor();
   assert.equal(await button('Discuss source response','Hablar de la respuesta de origen').count(),0);
   assert.equal(calls.filter(c=>c.path.includes('coordinator-review')||c.action==='submit').length,0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');assert.deepEqual(errors,[]);
   await page.evaluate(()=>window.stopPrivacy());await page.waitForFunction(()=>!document.querySelector('.saved-actions'));assert.equal(await page.getByText(accepted,{exact:true}).count(),0);
   results.push({width,language,passed:true});
  }catch(error){await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true});console.error(JSON.stringify({width,language,errors,apiCalls:calls.map(c=>[c.path,c.action])}));throw error;}finally{await page.close();}
 }}finally{await browser.close();}
 await writeFile(`${output}/results.json`,JSON.stringify({kind:'review-response-choices-browser-verification',schemaVersion:1,syntheticTransport:true,passed:results.length===6,journeys:results},null,2));console.log(JSON.stringify({passed:results.length,output}));
})().catch(error=>{console.error(error);process.exitCode=1;});
