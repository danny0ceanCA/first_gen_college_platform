// Real binder components, synthetic HTTP. PostgreSQL tests separately verify
// ownership, scoped grants, consent, cancellation races and lifecycle cleanup.
const {chromium}=require('playwright');
const {mkdir,writeFile}=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const origin=process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5187';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const output=process.env.ORIGEN_SMOKE_OUTPUT||'/tmp/origen-followup-step2-browser';
(async()=>{
 await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']}),journeys=[];
 try{for(const width of [1280,390,320])for(const language of ['en','es']){
  const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'America/Chicago',reducedMotion:'reduce'}),calls=[],errors=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const t=(en,es)=>language==='es'?es:en,id=randomUUID(),source={kind:'review-response',requestId:randomUUID(),responseVersion:1};
  const target={planId:id,stepId:'accepted'},content=t('Ask the insurance office which proof from work is accepted.','Preguntar a la oficina de seguros qué comprobante del trabajo aceptan.');
  let plan={id,studentId:'alex',title:t('My insurance question','Mi pregunta sobre el seguro'),goal:'',category:'financial',status:'active',version:1,summaryIds:[],steps:[{id:'accepted',title:t('Ask the insurance office','Preguntar a la oficina de seguros'),action:content,notes:t('My private note.','Mi nota privada.'),status:'not-started',dueDate:'2099-02-15',sources:[],responseSource:{availability:'current',source,responseVersion:1,acceptedAt:new Date().toISOString()}}]};
  let state='off',revision=0,schedule=null,enabled=true,sourceCurrent=true,dropConfirmation=false,holdConfirmation=false,releaseConfirmation;
  const previews=new Map(),receipts=new Map();
  const available=()=>sourceCurrent&&plan.status==='active'&&['not-started','in-progress'].includes(plan.steps[0]?.status);
  const overview=()=>({enabled,items:plan.steps.length?[{target,planVersion:plan.version,state,revision,pauseReason:state==='paused'?'action_changed':null,schedule,canEnroll:enabled&&available()}]:[],remaining:['scheduled','paused'].includes(state)?1:0,pending:previews.size});
  const planData=()=>({plans:[plan],creationIds:[],limited:false,supportsActions:true});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:"export function useAuth0(){return {user:{sub:'synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:'synthetic'}))+'.test'}}"});
   if(url.pathname==='/api/recommendation-evaluation')return route.fulfill({json:{enabled:false,organizations:[],permission:null}});
   if(url.pathname==='/api/recommendations')return route.fulfill({json:{enabled:false}});
   if(url.pathname.startsWith('/api/')){
    const body=route.request().postDataJSON();calls.push({path:url.pathname,...body});let data,status=200;
    if(url.pathname==='/api/plans'){
     if(body.action==='update'){plan={...body.plan,id,version:plan.version+1};if(state==='scheduled'){state='paused';revision++;}previews.clear();}
     data=planData();
    }else if(url.pathname==='/api/student-follow-up-report'){
     assert.equal(body.action,'load');data={enabled,canSave:sourceCurrent,planVersion:plan.version,reports:[]};
    }else if(url.pathname==='/api/student-follow-up'){
     assert.equal(body.studentId,'alex');
     if(body.action==='prepare'){
      assert.equal(body.revision,revision);assert.equal(body.planVersion,plan.version);assert.deepEqual(body.target,target);
      const p={id:body.operationId,digest:'a'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),language,selection:{target,planVersion:plan.version,revision,action:{title:plan.steps[0].title,content:plan.steps[0].action,notes:plan.steps[0].notes,dueDate:plan.steps[0].dueDate},schedule:body.schedule,source,oneCheckIn:true,sharedWithCoordinator:false}};
      previews.set(p.id,p);data={preview:p,enabled};
     }else if(body.action==='confirm'){
      if(!receipts.has(body.operationId)){
       const p=previews.get(body.previewId);
       if(!p||p.selection.planVersion!==plan.version||!available()){status=409;data={error:'student_follow_up_changed'};}
       else {assert.equal(body.confirmed,true);assert.equal(body.digest,p.digest);state='scheduled';revision++;schedule=p.selection.schedule;receipts.set(body.operationId,body);previews.delete(p.id);}
      }
      if(holdConfirmation){holdConfirmation=false;await new Promise(resolve=>{releaseConfirmation=resolve;});}
      if(dropConfirmation){dropConfirmation=false;return route.abort('failed');}
     }else if(['pause','stop','stop-all'].includes(body.action)){
      if(!receipts.has(body.operationId)){if(body.action!=='stop-all')assert.equal(body.revision,revision);state=body.action==='pause'?'paused':'off';revision++;previews.clear();receipts.set(body.operationId,body);}
     }else assert.equal(body.action,'overview');
     data=data||overview();
    }else {throw Error(`Unexpected API: ${url.pathname}`);}
    return route.fulfill({status,json:data});
   }
   if(url.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:'/* offline fixture */'});
   if(url.origin!==origin)return route.abort();return route.continue();
  });
  await page.route('**/follow-up-binder-smoke',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:16px;background:#f5f5ee"><main style="max-width:900px;margin:auto"><div id="root"></div></main><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import ActionPlan from '/src/ActionPlan.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/PersonalBinder.css';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'synthetic');window.stopPrivacy=()=>browserPrivacy.stop('logout');window.forgetConversation=()=>browserPrivacy.forget({id:'synthetic-conversation',studentId:'alex'});
   const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ActionPlan,{studentId:'alex',name:'Alex',role:'student',language:${JSON.stringify(language)},t,seed:null}));</script></body></html>`}));
  const button=(en,es)=>page.getByRole('button',{name:t(en,es),exact:true});
  const review=()=>page.getByRole('region',{name:t('Review this check-in','Revisar este seguimiento'),exact:true});
  const refresh=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));};
  const waitNote=async(en,es)=>page.locator('.follow-up-note').filter({hasText:t(en,es)}).waitFor();
  try{
   await page.goto(origin+'/follow-up-binder-smoke');await button('Check in next time','Retomar la próxima vez').waitFor();
   assert.equal(state,'off');assert.equal(calls.filter(c=>c.action==='prepare'||c.action==='confirm').length,0);
   await button('Check in next time','Retomar la próxima vez').click();await review().waitFor();assert.equal(state,'off');assert.ok((await review().innerText()).includes(content));
   await page.screenshot({path:`${output}/${width}-${language}-review.png`,fullPage:true});
   // No optimistic success, and one request despite repeated clicks while busy.
   holdConfirmation=true;await button('Confirm my check-in','Confirmar mi seguimiento').click();
   await page.waitForFunction(()=>document.querySelector('.follow-up-review button')?.disabled);
   assert.ok(!(await page.locator('.follow-up-note').innerText()).includes(t('I asked Origen','Le pedí a Origen')));
   await page.locator('.follow-up-review button').first().evaluate(el=>el.click());
   assert.equal(calls.filter(c=>c.action==='confirm').length,1);releaseConfirmation();await waitNote('I asked Origen for one check-in the next time','Le pedí a Origen un seguimiento la próxima vez');
   await button('Pause','Pausar').click();await waitNote('My check-in is paused','Mi seguimiento está en pausa');
   await button('Resume next time','Retomar la próxima vez').click();await review().waitFor();assert.equal(state,'paused');await button('Cancel','Cancelar').click();assert.equal(state,'paused');
   await button('Choose a date','Elegir una fecha').click();await page.getByLabel(t('Check in on or after','Retomar a partir del'),{exact:true}).fill('2099-03-08');
   await page.getByLabel(t('Time zone','Zona horaria'),{exact:true}).fill('America/Los_Angeles');await button('Review my choice','Revisar mi elección').click();await review().waitFor();
   assert.ok((await review().innerText()).includes('America/Los_Angeles'));await button('Confirm my check-in','Confirmar mi seguimiento').click();await waitNote('on or after','a partir del');assert.deepEqual(schedule,{onOrAfter:'2099-03-08',timeZone:'America/Los_Angeles'});assert.equal(plan.steps[0].dueDate,'2099-02-15');
   await page.screenshot({path:`${output}/${width}-${language}-saved.png`,fullPage:true});
   // A lost confirmation response retries the same operation, not a fresh opt-in.
   await button('Check in next time','Retomar la próxima vez').click();await review().waitFor();dropConfirmation=true;
   await button('Confirm my check-in','Confirmar mi seguimiento').click();await button('Try again','Intentar de nuevo').waitFor();assert.equal(await page.locator('.follow-up-note').count(),0);
   const lost=calls.filter(c=>c.action==='confirm').at(-1),beforeRetry=revision;await button('Try again','Intentar de nuevo').click();await waitNote('I asked Origen for one check-in the next time','Le pedí a Origen un seguimiento la próxima vez');
   assert.equal(calls.filter(c=>c.action==='confirm').at(-1).operationId,lost.operationId);assert.equal(revision,beforeRetry);
   // Plan edits invalidate displayed consent and never rewrite its deadline.
   await button('Mark done','Marcar como hecho').click();await refresh();await waitNote('My check-in is paused','Mi seguimiento está en pausa');assert.equal(await button('Check in next time','Retomar la próxima vez').count(),0);
   await button('Reopen','Reabrir').click();await refresh();await button('Resume next time','Retomar la próxima vez').waitFor();assert.equal(state,'paused');
   await button('Resume next time','Retomar la próxima vez').click();await review().waitFor();await button('Confirm my check-in','Confirmar mi seguimiento').click();await waitNote('I asked Origen','Le pedí a Origen');
   enabled=false;await refresh();await page.getByText(t('New check-ins are currently unavailable. I can still stop mine.','Los nuevos seguimientos no están disponibles. Aún puedo detener los míos.'),{exact:true}).waitFor();
   await button('Stop all my check-ins','Detener todos mis seguimientos').click();await page.waitForFunction(()=>!document.querySelector('.student-follow-up'));assert.equal(state,'off');assert.equal(plan.steps[0].dueDate,'2099-02-15');
   enabled=true;await refresh();await button('Check in next time','Retomar la próxima vez').waitFor();await button('Check in next time','Retomar la próxima vez').click();await review().waitFor();
   // Going offline removes the review and never displays an unconfirmed save.
   const preparedBeforeOffline=calls.filter(c=>c.action==='confirm').length;
   await page.context().setOffline(true);await page.waitForFunction(()=>!document.querySelector('.follow-up-review'));assert.equal(state,'off');
   await page.context().setOffline(false);await refresh();await button('Check in next time','Retomar la próxima vez').waitFor();
   assert.equal(calls.filter(c=>c.action==='confirm').length,preparedBeforeOffline);
   await button('Check in next time','Retomar la próxima vez').click();await review().waitFor();
   sourceCurrent=false;plan={...plan,version:plan.version+1};previews.clear();await refresh();await page.waitForFunction(()=>!document.querySelector('.follow-up-review'));
   assert.equal(state,'off');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');
   assert.equal(calls.filter(c=>c.path.includes('coordinator')||c.action==='submit').length,0);assert.deepEqual(errors,[]);
   // Forgetting a conversation clears stale UI without permanently disabling
   // the still-authenticated student's ability to manage check-ins.
   await page.evaluate(()=>window.forgetConversation());await button('Try again','Intentar de nuevo').click();
   await page.getByText(content,{exact:true}).waitFor();await page.locator('.student-follow-up').waitFor();
   await page.evaluate(()=>window.stopPrivacy());await page.waitForFunction(()=>!document.querySelector('.student-follow-up')&&!document.querySelector('.saved-actions'));
   journeys.push({width,language,passed:true});
  }catch(error){await page.screenshot({path:`${output}/${width}-${language}-failure.png`,fullPage:true});console.error(JSON.stringify({width,language,errors,actions:calls.map(c=>c.action)}));throw error;}finally{releaseConfirmation?.();await page.close();}
 }}finally{await browser.close();}
 await writeFile(`${output}/results.json`,JSON.stringify({kind:'student-follow-up-controls-browser-verification',schemaVersion:1,syntheticTransport:true,passed:journeys.length===6,journeys},null,2));console.log(JSON.stringify({passed:journeys.length,output}));
})().catch(e=>{console.error(e);process.exitCode=1;});
