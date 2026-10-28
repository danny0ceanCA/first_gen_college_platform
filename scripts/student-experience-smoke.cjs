// Local UI only. Every API and external request is intercepted; no live AI or account writes.
const {createRequire}=require('node:module'),assert=require('node:assert/strict'),{mkdir}=require('node:fs/promises');
const {chromium}=createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json')('playwright');
const origin='http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/phase4-student',{recursive:true});
 // Use Vite's current dependency URL so the harness and app share one guard registry after HMR.
 const settingsSource=await (await fetch(origin+'/src/AccountSettings.tsx')).text();
 const voiceSource=await (await fetch(origin+'/src/ProfileVoice.tsx')).text();
 const historyModule=voiceSource.match(/from "([^\"]*ConversationHistory[^\"]*)"/)?.[1]||'/src/ConversationHistory.tsx';
 const navigationModule=settingsSource.match(/from "([^\"]*workspaceNavigation[^\"]*)"/)?.[1]||'/src/workspaceNavigation.ts';
 try{for(const [width,language,motion] of [[1280,'en','no-preference'],[390,'es','no-preference'],[320,'en','reduce']]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:motion}),errors=[],requests=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  const t=(en,es)=>language==='es'?es:en;
  let account={firstName:'Alex',email:'alex@example.test',role:'student',welcomeHeard:true,usedVoice:true};
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`export function useAuth0(){return {user:{sub:'synthetic-phase4'},isAuthenticated:true,isLoading:false,getAccessTokenSilently:async()=>'e30.'+btoa(JSON.stringify({sub:'synthetic-phase4'}))+'.test',logout:async()=>{}}}`});
   if(u.pathname.startsWith('/api/')){
    const input=route.request().postDataJSON()||{};requests.push({path:u.pathname,...input});
    if(u.pathname==='/api/chat'){
     await new Promise(resolve=>setTimeout(resolve,250));
     return route.fulfill({json:{text:'Synthetic research result',parts:[{text:'Compare campus internships and ask about the weekly time commitment.'}],mode:'live',checkedAt:new Date().toISOString(),sources:[{title:'Synthetic campus listing',url:'https://example.test/opportunity',checkedAt:new Date().toISOString()}]}});
    }
    if(u.pathname==='/api/family'){
     if(input.action==='save-account')account=input.account;
     return route.fulfill({json:{account,students:[{id:'alex',name:'Alex',stage:'Community college',interest:'Science',gpa:'',color:'peach'}]}});
    }
    if(u.pathname==='/api/conversation-history'&&input.action==='save'){
     if(input.item.id==='discarded-summary')return route.fulfill({status:410,json:{error:'conversation_deleted'}});
     return route.fulfill({json:{items:[input.item]}});
    }
    return route.fulfill({json:{ok:true,items:[],available:false,enabled:false,notifications:[],plans:[]}});
   }
   return u.origin===origin?route.continue():route.fulfill({body:''});
  });
  await page.route('**/student-experience',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
   import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import Welcome from '/src/Welcome.tsx';import Search from '/src/OpportunitySearch.tsx';import Settings from '/src/AccountSettings.tsx';
   import {FamilyProvider} from '/src/FamilyStore.tsx';import {ConversationHistoryProvider,useConversationHistory} from '${historyModule}';import {SharedVoiceContext} from '/src/SharedVoiceContext.ts';
   import {useBinderFollow} from '/src/useBinderFollow.ts';import VoiceFollow from '/src/VoiceFollowControl.tsx';import {binderActivity} from '/src/binderActivity.ts';
   import {browserPrivacy} from '/src/browserPrivacy.mjs';import {setAPITokenProvider} from '/src/api.ts';
   import {useDialogSurface} from '/src/useDialogSurface.ts';import {confirmWorkspaceNavigation} from '${navigationModule}';
   import '/src/styles.css';import '/src/brand.css';import '/src/SharedVoice.css';
   browserPrivacy.start('synthetic-phase4',{fresh:true});setAPITokenProvider(async()=>'synthetic');const h=React.createElement,t=(en,es)=>${JSON.stringify(language)}==='es'?es:en;
   window.savedProfiles=[];window.followed=[];window.activity=binderActivity;window.privacy=browserPrivacy;
   const voice={ready:false,active:false,configure:()=>{},syncOnboarding:()=>{},claim:()=>true,launch:()=>{},start:()=>{},open:()=>{}};
   function Follow(){useBinderFollow({subject:'synthetic-phase4',studentIds:['alex'],role:'student',ready:true,blocked:false,apply:r=>window.followed.push(r)});return h('div',null,h(VoiceFollow,{t}),h('p',null,'Voice navigation controls'));}
   function SettingsDialog({close}){const {ref,dismiss,dialogProps}=useDialogSurface({onDismiss:close,beforeDismiss:confirmWorkspaceNavigation});return h('dialog',{ref,...dialogProps,'data-mobile-sheet':true},h('button',{onClick:dismiss},'Close settings'),h(Settings,{t}));}
   function App(){const history=useConversationHistory();window.saveSummary=(studentId,id)=>history.add({id,studentId,date:new Date().toISOString(),mode:'planning',summary:'Synthetic conversation summary',sources:[]});const [view,setView]=React.useState('setup'),[lang,setLang]=React.useState(${JSON.stringify(language)}),[student,setStudent]=React.useState('alex'),[dialog,setDialog]=React.useState(false),[finished,setFinished]=React.useState(false);return h(React.Fragment,null,
    h('nav',{'aria-label':'Test screens',style:{display:'flex',flexWrap:'wrap',gap:12,padding:12}},...['setup','research','follow','settings','away'].map(v=>h('button',{key:v,onClick:()=>setView(v)},v))),
    view==='setup'?(finished?h('h1',null,'Profile saved'):h(SharedVoiceContext.Provider,{value:voice},h(Welcome,{language:lang,setLanguage:setLang,initialName:'Alex',initialRole:'student',cloud:true,onComplete:()=>setFinished(true),complete:async(name,role,profile)=>{window.savedProfiles.push({name,role,profile});if(window.savedProfiles.length===1)return false;setFinished(true);return true;}}))):
    view==='research'?h('main',null,h('button',{onClick:()=>setStudent(student==='alex'?'sam':'alex')},'Switch student'),h(Search,{student:{id:student,name:student,stage:'Community college'},role:'student',language:lang,seed:null,t,back:()=>setView('away')})):
    view==='follow'?h(Follow):view==='settings'?h('button',{onClick:()=>setDialog(true)},'Open settings'):h('h1',null,'Other page'),dialog&&h(SettingsDialog,{close:()=>setDialog(false)}));}
   ReactDOM.createRoot(document.getElementById('root')).render(h(React.StrictMode,null,h(FamilyProvider,{previewStudents:[]},h(ConversationHistoryProvider,null,h(App)))));
  </script></html>`}));
  try{
   await page.goto(origin+'/student-experience');
   await page.getByRole('button',{name:t('Edit details','Editar datos'),exact:true}).click();
   await page.getByRole('textbox',{name:t('Your name','Tu nombre'),exact:true}).fill('Alex Rivera');
   await page.getByRole('combobox',{name:t('Education stage','Etapa educativa'),exact:true}).selectOption('Community college');
   await page.locator('.welcome-optional-details summary').click();
   await page.getByRole('textbox',{name:t('Goals','Metas'),exact:true}).fill('Transfer into environmental science and compare campus support.');
   await page.getByRole('button',{name:t('Review profile','Revisar perfil'),exact:true}).click();
   await page.locator('.welcome-profile-review').waitFor();assert.equal(await page.evaluate(()=>window.savedProfiles.length),0);
   assert.equal(await page.locator('.welcome-review-details').innerText().then(s=>s.includes('environmental science')),true);
   await page.reload();await page.locator('.welcome-profile-review').waitFor();assert.ok((await page.locator('.welcome-review-details').innerText()).includes('environmental science'),'Review draft should survive reload');
   await page.screenshot({path:`output/playwright/phase4-student/${width}-profile-review.png`});
   await page.getByRole('button',{name:t('Save profile','Guardar perfil')}).click();
   await page.getByRole('alert').filter({hasText:t('Could not save.','No se pudo guardar.')}).waitFor();
   await page.getByRole('button',{name:t('Edit details','Editar datos'),exact:true}).click();
   await page.getByRole('textbox',{name:t('Your name','Tu nombre'),exact:true}).fill('Alex Rivera Updated');
   await page.getByRole('button',{name:t('Review profile','Revisar perfil'),exact:true}).click();
   await page.getByRole('button',{name:t('Save profile','Guardar perfil')}).click();
   await page.getByRole('heading',{name:'Profile saved'}).waitFor();
   assert.equal(await page.evaluate(()=>window.savedProfiles[1].profile.name),'Alex Rivera Updated');
   await page.getByRole('button',{name:'research',exact:true}).click();
   await page.getByRole('textbox',{name:t('Interests and context to use for this search','Intereses y contexto para esta búsqueda')}).fill('Environmental science internships');
   await page.getByRole('textbox',{name:t('City or ZIP code','Ciudad o código postal')}).fill('Sacramento');
   await page.getByRole('button',{name:t('Find current opportunities','Buscar oportunidades actuales')}).click();
   await page.locator('.opportunity-results').waitFor();
   await page.getByRole('button',{name:'away',exact:true}).click();await page.getByRole('button',{name:'research',exact:true}).click();
   await page.locator('.opportunity-results').waitFor();assert.equal(requests.filter(r=>r.path==='/api/chat').length,1);
   await page.getByRole('button',{name:'Switch student'}).click();assert.equal(await page.locator('.opportunity-results').count(),0);
   assert.equal(await page.getByRole('textbox',{name:t('City or ZIP code','Ciudad o código postal')}).inputValue(),'');
   await page.getByRole('button',{name:'Switch student'}).click();await page.locator('.opportunity-results').waitFor();
   await page.getByRole('button',{name:'follow',exact:true}).click();
   await page.evaluate(()=>window.activity.begin('call-1','synthetic-phase4','alex',['transfer']));
   await page.waitForFunction(()=>window.followed.length===1);
   await page.getByRole('button',{name:t('Pause topic following','Pausar seguimiento de temas')}).click();
   await page.evaluate(()=>window.activity.update('call-1',['costs']));await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>window.followed.length),1);
   await page.evaluate(()=>window.activity.update('call-1',['applications']));
   await page.getByRole('button',{name:t('Resume topic following','Seguir los temas de nuevo')}).click();
   await page.waitForFunction(()=>window.followed.length===2);assert.equal(await page.evaluate(()=>window.followed[1].topic),'applications');
   await page.getByRole('button',{name:t('Pause topic following','Pausar seguimiento de temas')}).click();
   await page.evaluate(()=>{window.activity.end('call-1');window.activity.begin('call-2','synthetic-phase4','alex',['options']);});
   await page.waitForFunction(()=>window.followed.length===3);
   assert.equal(await page.evaluate(()=>window.saveSummary('not-yet-saved','pending-summary')),'pending','Onboarding queue must not report a saved summary');
   assert.equal(await page.evaluate(()=>window.saveSummary('alex','confirmed-summary')),'saved');
   assert.equal(await page.evaluate(()=>window.saveSummary('alex','discarded-summary')),'discarded','Deleted summaries must not report saved');
   await page.getByRole('button',{name:'settings',exact:true}).click();await page.getByRole('button',{name:'Open settings'}).click();
   await page.getByRole('textbox',{name:t('First name','Nombre'),exact:true}).fill(' Alex Updated ');
   const discardPrompt=page.waitForEvent('dialog');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Close settings'}).click();await discardPrompt;assert.equal(await page.locator('dialog[open]').count(),1);
   await page.getByRole('button',{name:t('Save information','Guardar información')}).click();
   await page.getByRole('status').filter({hasText:t('Saved to your account.','Guardado en tu cuenta.')}).waitFor();
   await page.getByRole('button',{name:'Close settings'}).click();await page.locator('dialog').waitFor({state:'detached'});
   await page.getByRole('button',{name:'research',exact:true}).click();await page.locator('.opportunity-results').waitFor();
   await page.evaluate(()=>window.privacy.stop('logout'));await page.locator('.opportunity-results').waitFor({state:'detached'});
   assert.equal(await page.getByRole('textbox',{name:t('City or ZIP code','Ciudad o código postal')}).inputValue(),'');
   assert.ok(!requests.some(r=>r.path.includes('realtime')),'No voice call may start');assert.deepEqual(errors,[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
   console.log(`PASS ${width}/${language}: profile review/failure/edit/retry, research return/scope/privacy, voice pause/latest topic/new call, settings draft guard.`);
  }catch(error){console.error({errors,body:(await page.locator('body').innerText()).slice(0,2500)});throw error;}finally{await page.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
