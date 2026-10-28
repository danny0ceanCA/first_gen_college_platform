// Local paper layout and confirmed-send motion, using synthetic content only.
const {createRequire}=require('node:module'),{mkdir}=require('node:fs/promises'),assert=require('node:assert/strict');
const resolve=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'),{chromium}=resolve('playwright');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1');
const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/comment-layout',{recursive:true});
 try{for(const [width,language,motion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:892},reducedMotion:motion}),errors=[];page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en;
  const source=('We discussed transfer planning, the courses I still need, and how I can balance classes with my work schedule. ').repeat(20);
  const template={topic:'transfer',kind:'guidance',resourceUrl:'',version:1,authorName:'Test Coordinator',organizationName:'Community Center',createdAt:'2026-10-27T12:00:00.000Z',editedAt:null,withdrawn:false,hidden:false,reviewed:false,connectionEnded:false,publicationItemId:'shared-1',replyCount:2};
  let feedback=Array.from({length:5},(_,index)=>({...template,id:'existing-'+index,body:`Comment ${index+1}. `+('Bring your course list and we can review it together. ').repeat(index===2?25:2)})),sendGate;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`const auth={user:{sub:'layout-test'},getAccessTokenSilently:async()=>'synthetic'};export function useAuth0(){return auth}`});
   if(!url.pathname.startsWith('/api/'))return url.origin===origin?route.continue():route.fulfill({body:''});
   assert.equal(url.pathname,'/api/coordinator-feedback');const input=route.request().postDataJSON();let data;
   if(input.action==='staff-list')data={feedback,writesEnabled:true};
   if(input.action==='staff-create'){if(sendGate)await sendGate.promise;feedback.push({...template,id:'new-comment',body:input.body,replyCount:0});data={id:'new-comment'};}
   if(input.action==='staff-edit'){if(sendGate)await sendGate.promise;feedback=feedback.map(f=>f.id===input.feedbackId?{...f,body:input.body,version:f.version+1}:f);data={id:input.feedbackId};}
   if(input.action==='staff-thread')data={revisions:[{version:1,body:'Earlier guidance. '.repeat(80),kind:'guidance',resourceUrl:'',createdAt:template.createdAt}],replies:[{id:'reply-1',body:'I would like to review these courses. '.repeat(30),feedbackVersion:1,createdAt:template.createdAt}]};
   assert.ok(data,`Unexpected action ${input.action}`);return route.fulfill({json:data});
  });
  await page.route('**/comment-layout-review',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import {GuidancePanel,useGuidanceRequest} from '/src/CoordinatorGuidance.tsx';import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';import '/src/CoordinatorBinders.css';import '/src/PersonalBinder.css';
   browserPrivacy.start('layout-test',{fresh:true});setAPITokenProvider(async()=>'synthetic');const t=(en,es)=>'${language}'==='es'?es:en;
   function App(){const [dirty,setDirty]=React.useState(false),request=useGuidanceRequest();return React.createElement('main',{'data-dirty':dirty,style:{maxWidth:'1100px',margin:'auto',padding:'20px'}},React.createElement('h1',null,'Alex Rivera · Transfer planning'),React.createElement('section',{className:'notebook-panel',style:{containerType:'inline-size',containerName:'shared-paper'}},React.createElement(GuidancePanel,{organizationId:'org',grantId:'grant',publicationId:'publication',topic:'transfer',paper:true,entries:[{id:'shared-1',topic:'transfer',content:${JSON.stringify(source)}}],request,t,onDraftChange:setDirty})),React.createElement('footer',null,'End of the shared page'));}
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));
  </script></html>`}));
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  try{
   await page.goto(origin+'/comment-layout-review');await page.locator('[data-comment-id="existing-4"]').waitFor();await settle();
   const entry=page.getByRole('region',{name:t('Shared note 1','Nota compartida 1'),exact:true});
   const comments=page.getByRole('region',{name:t('Coordinator comments on note 1','Comentarios del coordinador sobre la nota 1'),exact:true});
   for(const region of [entry,comments]){
    const size=await region.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
    assert.ok(size.height<=(width>600?460:400)&&size.scroll>size.height,'Long content did not stay capped and scrollable');
    await region.focus();const documentScroll=await page.evaluate(()=>scrollY);await page.keyboard.press('PageDown');
    await page.waitForFunction(el=>el.scrollTop>0,await region.elementHandle());assert.equal(await page.evaluate(()=>scrollY),documentScroll,'Keyboard scrolling escaped into the page');
   }
   assert.equal(await entry.locator('.notebook-note-content').textContent(),source,'Long note text was truncated');
   await comments.getByRole('button',{name:t('Add comment','Agregar comentario'),exact:true}).click();
   const editor=page.getByLabel(t('Your guidance','Tu orientación'),{exact:true});await editor.fill(t('Let’s compare these courses together. You have a thoughtful starting point.','Comparemos juntos estos cursos. Tienes un buen punto de partida.'));await settle();
   assert.ok(await comments.evaluate(el=>el.clientHeight<=460),'The editor expanded the comment area beyond its cap');
   sendGate=gate();await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();
   const documentBefore=await page.evaluate(()=>scrollY),footerBefore=await page.locator('footer').evaluate(el=>el.getBoundingClientRect().top+scrollY);
   assert.equal(await page.locator('.ink-just-sent').count(),0,'Success animation ran before server confirmation');
   sendGate.release();sendGate=undefined;const sent=page.locator('[data-comment-id="new-comment"]');await sent.waitFor();
   const entrance=await sent.evaluate(el=>el.getAnimations().filter(a=>a.animationName==='ink-settle').map(a=>a.effect.getTiming().duration));
   assert.deepEqual(entrance,motion==='reduce'?[]:[760]);await settle();
   assert.equal(await page.evaluate(()=>scrollY),documentBefore,'Sending scrolled the whole page');
   assert.ok(Math.abs(await page.locator('footer').evaluate(el=>el.getBoundingClientRect().top+scrollY)-footerBefore)<2,'Sending moved the bottom of the capped binder');
   const visible=await sent.evaluate(el=>{const pane=el.closest('.binder-annotation-content'),r=el.getBoundingClientRect(),p=pane.getBoundingClientRect();return r.top>=p.top-2&&r.top<p.bottom-40&&document.activeElement===el;});
   assert.ok(visible,'The new comment was not revealed/focused within its own scroll area');
   await page.screenshot({path:`output/playwright/comment-layout/${width}-${language}.png`,fullPage:true});
   await sent.getByRole('button',{name:t('Edit comment','Editar comentario'),exact:true}).click();await editor.fill('Updated synthetic guidance.');
   sendGate=gate();await page.getByRole('button',{name:t('Send to student','Enviar al estudiante'),exact:true}).click();sendGate.release();sendGate=undefined;
   await sent.locator('.guidance-body').filter({hasText:'Updated synthetic guidance.'}).waitFor();
   if(motion!=='reduce')assert.ok(await sent.evaluate(el=>el.getAnimations().some(a=>a.animationName==='ink-settle')),'Editing the same comment did not replay the confirmed drop');
   await settle();await sent.locator('summary').click();await sent.locator('.guidance-history').waitFor();
   assert.ok(await comments.evaluate(el=>el.clientHeight<=460&&el.scrollHeight>el.clientHeight),'Opening history uncapped the comment area');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');assert.deepEqual(errors,[]);
   console.log(`PASS ${width}/${language}/${motion}: long notes and comments capped, keyboard scrolling, composer reachable, confirmed drop/re-edit, new-note visibility, no page jump, long history contained.`);
  }catch(error){console.error(errors);await page.screenshot({path:`output/playwright/comment-layout/${width}-failure.png`,fullPage:true});throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
