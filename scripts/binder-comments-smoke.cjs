// Local, intercepted APIs only. Tests the actual composer and student notebook.
const {createRequire}=require('node:module'),{mkdir}=require('node:fs/promises'),assert=require('node:assert/strict');
const resolve=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'),{chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/binder-comments',{recursive:true});
 // Match the live Vite dependency URL to avoid a second context after hot updates.
 const notebookSource=await (await fetch(origin+'/src/TopicNotebook.tsx')).text();
 const historyModule=notebookSource.match(/from "([^\"]*ConversationHistory[^\"]*)"/)?.[1]||'/src/ConversationHistory.tsx';
 try{for(const [width,language,motion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:motion}),errors=[],writes=[];page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  const t=(en,es)=>language==='es'?es:en,body=t('Bring your course list and we can compare transfer options together.','Trae tu lista de cursos y podemos comparar juntos las opciones de transferencia.');
  const memoryCase=width===320;const now='2026-10-27T12:00:00.000Z';let feedback=[],fail=true,replies=[];
  const notes=Array.from({length:6},(_,i)=>({id:'note-'+i,studentId:'alex',topic:'transfer',kind:'note',content:`We discussed transfer planning and my community college courses. Note ${i+1}.`,language:'en',status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:now,sources:[]}));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'synthetic'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>'e30.'+btoa(JSON.stringify({sub:'synthetic'}))+'.test'};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.fulfill({body:''});
   const input=route.request().postDataJSON()||{};let data={available:true,items:[],memories:[],pendingCount:0,plans:[],notifications:[]};
   if(url.pathname==='/api/coordinator-feedback'){
    if(input.action.endsWith('-list'))data={feedback,writesEnabled:true};
    if(input.action==='staff-create'){
     writes.push(input);if(fail){fail=false;return route.fulfill({status:503,json:{error:'feedback_unavailable'}});}
     feedback=[{id:'comment-1',topic:'transfer',kind:input.kind,body:input.body,resourceUrl:'',version:1,authorName:'Jordan',organizationName:'Community Center',createdAt:now,editedAt:null,withdrawn:false,hidden:false,reviewed:false,connectionEnded:false,replyAvailable:true,publicationItemId:'shared-1',replyCount:0,anchor:{id:memoryCase?'memory-3':'note-5',kind:memoryCase?'memory':'note',version:1}}];data={id:'comment-1'};
    }
    if(input.action==='student-review'){feedback[0].reviewed=true;data={ok:true};}
    if(input.action==='student-reply'){replies.push(input);data={ok:true};}
    if(input.action.endsWith('-thread'))data={revisions:[],replies:[]};
   }
   if(url.pathname==='/api/family')data={account:{firstName:'Alex',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:'alex',name:'Alex',stage:'Community college'}]};
   if(url.pathname==='/api/student-memory')data={available:true,pendingCount:0,memories:memoryCase?Array.from({length:4},(_,i)=>({id:'memory-'+i,version:1,studentId:'alex',category:'question',content:'Which courses will transfer? '+i,language:'en',speaker:'student',reportedBy:'student',status:'confirmed',summaryId:null,updatedAt:now,organization:{topic:'transfer'}})):[]};
   if(url.pathname==='/api/topic-notes')data={notes,generatedSummaryIds:[],pendingCount:0};
   if(url.pathname==='/api/binder-sharing')data={enabled:false,connections:[],grants:[]};
   return route.fulfill({json:data});
  });
  await page.route('**/comment-preview',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {GuidancePanel,useGuidanceRequest} from '/src/CoordinatorGuidance.tsx';import Notebook from '/src/TopicNotebook.tsx';
   import {FamilyProvider} from '/src/FamilyStore.tsx';import {ConversationHistoryProvider} from '${historyModule}';
   import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';
   browserPrivacy.start('synthetic',{fresh:true});setAPITokenProvider(async()=>'test');
   const t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   function App(){const [student,setStudent]=React.useState(false),[dirty,setDirty]=React.useState(false),request=useGuidanceRequest();return React.createElement('main',{'data-dirty':dirty,style:{maxWidth:'1100px',margin:'auto',padding:'20px'}},React.createElement('button',{onClick:()=>setStudent(!student)},student?'Coordinator view':'Student view'),student?React.createElement(FamilyProvider,{previewStudents:[]},React.createElement(ConversationHistoryProvider,null,React.createElement(Notebook,{studentId:'alex',name:'Alex',role:'student',language:${JSON.stringify(language)},t,navigate:()=>{},renderSummary:()=>React.createElement('p',null,'My conversations')}))):React.createElement('section',{className:'notebook-panel',style:{containerType:'inline-size',containerName:'shared-paper'}},React.createElement(GuidancePanel,{organizationId:'org',grantId:'grant',publicationId:'publication',topic:'transfer',paper:true,entries:[{id:'shared-1',topic:'transfer',content:${JSON.stringify(notes[5].content)}}],request,t,onDraftChange:setDirty})));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  </script></html>`}));
  try{
   await page.goto(origin+'/comment-preview');await page.getByRole('button',{name:t('Add comment','Agregar comentario'),exact:true}).click();
   const editor=page.getByLabel(t('Your guidance','Tu orientación'),{exact:true});
   await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
   // A settled composer must not collapse/re-expand when the first character
   // makes the draft dirty. Observe every frame, not just the final position.
   await page.evaluate(()=>{
    window.commentFrames=[];window.recordCommentFrames=true;
    const sample=()=>{const field=document.querySelector('.ink-editor textarea'),margin=document.querySelector('.shared-page-margin'),slot=field.closest('.binder-annotation-slot');
     window.commentFrames.push({field:field.getBoundingClientRect().top,margin:margin.getBoundingClientRect().top+scrollY,height:slot.getBoundingClientRect().height,scroll:scrollY,focus:document.activeElement===field});
     if(window.recordCommentFrames)requestAnimationFrame(sample);
    };sample();
   });
   await editor.pressSequentially(body[0]);
   await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>{window.recordCommentFrames=false;resolve();},400)));
   const frames=await page.evaluate(()=>window.commentFrames);
   for(const metric of ['field','margin','height','scroll'])assert.ok(Math.max(...frames.map(f=>f[metric]))-Math.min(...frames.map(f=>f[metric]))<2,`First character shifted ${metric}: ${JSON.stringify(frames)}`);
   assert.ok(frames.every(f=>f.focus),'Typing lost editor focus');
   assert.equal(await page.locator('main').getAttribute('data-dirty'),'true','The check must include the workspace dirty-state update');
   await editor.fill(body);
   await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
   await page.screenshot({path:`output/playwright/binder-comments/${width}-${language}-composer.png`,fullPage:true});
   await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await editor.inputValue(),body);
   // A brief window interruption hides private paper, then restores this scoped draft.
   await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await editor.waitFor({state:'detached'});
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await editor.waitFor();assert.equal(await editor.inputValue(),body);
   await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();await page.locator('.ink-just-sent').waitFor();
   assert.equal(writes.length,2);assert.equal(writes[0].requestId,writes[1].requestId);assert.equal(await page.locator('.guidance-card').count(),1);
   if(motion==='reduce')assert.equal(await page.locator('.ink-just-sent').evaluate(el=>getComputedStyle(el).animationName),'none');
   await page.getByRole('button',{name:'Student view',exact:true}).click();await page.locator('.student-comment-arrival').click();
   const placed=page.locator((memoryCase?'[data-memory-id="memory-3"]':'[data-note-id="note-5"]')+' [data-comment-id="comment-1"]');await placed.waitFor({state:'visible'});
   assert.equal(await placed.locator('.guidance-body').textContent(),body);assert.equal(await page.locator('[data-comment-id="comment-1"]').count(),1);
   await page.locator('.binder-open').waitFor();await page.screenshot({path:`output/playwright/binder-comments/${width}-${language}-student.png`,fullPage:true});
   await placed.getByRole('button',{name:t('Reply','Responder'),exact:true}).click();await placed.locator('textarea').fill(t('Thank you, I will bring it.','Gracias, la traeré.'));
   await placed.getByRole('button',{name:t('Send reply to coordinator','Enviar respuesta al coordinador'),exact:true}).click();await placed.locator('textarea').waitFor({state:'detached'});assert.equal(replies.length,1);
   await placed.getByRole('button',{name:t('Mark read','Marcar como leído'),exact:true}).click();await page.locator('.student-comment-arrival').waitFor({state:'detached'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
   console.log(`PASS ${width}/${language}/${motion}: steady first-character layout and focus, draft-state rerender, failed-send recovery, idempotent retry, ink animation, student placement, reply, read state.`);
  }catch(error){console.error(errors);await page.screenshot({path:`output/playwright/binder-comments/${width}-failure.png`,fullPage:true});throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
