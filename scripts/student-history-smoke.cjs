// Real browser, synthetic account and intercepted APIs. No production or paid AI requests.
const {createRequire}=require('node:module');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const assert=require('node:assert/strict');
const {mkdir}=require('node:fs/promises');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use a local development server.');
const subject='synthetic-binder-review',studentId='binder-student',date='2026-10-01T12:00:00.000Z';
const topics=['options','transfer','costs','applications'];
const text={options:['Majors and interests','Explore nursing and public health programs that combine science with community work.','Campus life','Compare commuter support, welcoming student clubs, and academic advising.'],transfer:['Course planning','Meet an advisor to check which biology and writing courses meet transfer requirements.','A path to university','Save the articulation agreement and review it before registering for the next term.'],costs:['Financial aid','Complete the FAFSA and compare grants before considering student loans.','My college budget','Estimate transportation, books, housing, and food alongside tuition.'],applications:['Application dates','Record each application deadline and plan time to request recommendations.','Personal statement','Write about helping family members navigate unfamiliar systems.']};
function summary(language){return Array.from({length:6},(_,index)=>language==='es'?`## Recuerdo ${index+1}\n\nHablamos de enfermería y salud pública, y de encontrar una universidad que apoye tus metas. El siguiente paso es comparar las ayudas y preparar preguntas para el consejero. Quieres estudiar cerca de tu familia y trabajar en una comunidad donde puedas ayudar a otras personas.\n\n- Conversa con tu consejero sobre los cursos y las fechas importantes.\n- Guarda las opciones que te interesen antes de tomar una decisión.`:`## Memory ${index+1}\n\nWe talked about nursing and public health, and finding a college that supports your goals. Next, compare financial aid and prepare questions for your counselor. You would like to study near your family and work in a community where you can support other people.\n\n- Talk with your counselor about courses and important dates.\n- Save the possibilities that interest you before making a decision.`).join('\n\n');}
function notes(){return topics.flatMap(topic=>Array.from({length:18},(_,index)=>({id:`${topic}-${index}`,studentId,topic,kind:['note','explanation','question','decision'][index%4],content:`${text[topic][(index%2)*2]}\n${text[topic][(index%2)*2+1]}\n\n${index%3===0?'Bring this topic to our next conversation. ':''}Entry ${index+1}: ${index===17?'A long reference: '+('collegepath'.repeat(30)): 'Keep this detail together with the questions I want to ask.'}`,language:'en',status:index<8?'suggested':'saved',origin:index<8?'conversation':'user',summaryId:index<8?'conversation-1':null,quote:'We discussed a college path that works with family and financial priorities.',translations:{es:`${topic==='costs'?'Ayuda financiera':'Mi camino a la universidad'}\nComparar las opciones y preparar preguntas para nuestra próxima conversación. Nota ${index+1}. ${index===17?"universidad".repeat(60):""}`},version:1,updatedAt:date,sources:[],conversationAt:index<8?date:null})));}
async function setup(browser,{width=1280,language='en',reducedMotion=process.env.ORIGEN_SMOKE_MOTION||'reduce'}={}){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion});page.setDefaultTimeout(12000);
 const state={notes:notes(),summary:summary(language),writes:[],errors:[],requests:[],modules:[],dialogs:[]};
 page.on('pageerror',error=>state.errors.push(error.stack));page.on('dialog',dialog=>{state.dialogs.push(dialog.message());return dialog.accept();});
 await page.addInitScript(language=>localStorage.setItem('origen.language',language),language);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.pathname.startsWith('/src/'))state.modules.push(url.pathname);
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(url.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:url.pathname,action:body.action});
   if(url.pathname==='/api/eligibility')return route.fulfill({json:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   if(url.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(url.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',email:'alex@example.test',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:studentId,name:'Alex Rivera',stage:'High school',interest:'Nursing and community health',gpa:'3.6',color:'peach',goals:'Explore a college path that lets me care for my community.'}]}});
   if(url.pathname==='/api/conversation-history')return route.fulfill({json:{items:[{id:'conversation-1',studentId,date,mode:'planning',summary:'We discussed majors, college costs, and preparing applications.',sources:[]}]}});
   if(url.pathname==='/api/conversation-summary')return route.fulfill({json:{summary:state.summary,sources:[],date}});
   if(url.pathname==='/api/coordinator-notifications')return route.fulfill({json:{notifications:[]}});
   if(url.pathname==='/api/binder-sharing')return route.fulfill({json:{available:true,enabled:false,connections:[],grants:[]}});
   if(url.pathname==='/api/coordinator-feedback')return route.fulfill({json:{feedback:[],writesEnabled:true}});
   if(url.pathname==='/api/student-memory')return route.fulfill({json:{entries:[]}});
   if(url.pathname==='/api/topic-notes'){
    if(['create','update','delete'].includes(body.action)){
     state.writes.push(structuredClone(body));
     if(body.action==='delete')state.notes=state.notes.filter(note=>note.id!==body.id);
     else if(body.action==='update')state.notes=state.notes.map(note=>note.id===body.id?{...note,...body.note,status:'saved',version:note.version+1}:note);
     else state.notes.push({id:body.id,studentId,...body.note,status:'saved',origin:'user',summaryId:null,quote:'',translations:{},version:1,updatedAt:date,sources:[],conversationAt:null});
    }
    return route.fulfill({json:{notes:state.notes,generatedSummaryIds:['conversation-1'],pendingCount:0}});
   }
   return route.fulfill({json:{ok:true,items:[],summary:'Synthetic summary',plans:[]}});
  }
  if(url.origin===origin||['data:','blob:','about:'].includes(url.protocol))return route.continue();
  return route.fulfill({status:200,contentType:url.hostname.startsWith('fonts.')?'text/css':'application/json',body:url.hostname.startsWith('fonts.')?'':'{}'});
 });
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor({state:'visible'}).catch(async error=>{console.error(state.errors,(await page.locator('body').innerText()).slice(0,1800));throw error;});

 return {page,state};
}
async function openBinder(page){await page.locator('.binder-cover').click();await page.locator('.binder-open').waitFor();}
async function chooseTopic(page,topic,width){if(width<=760)await page.locator(`[data-topic="${topic}"]`).click();else await page.locator(`#notebook-tab-${topic}`).click();await page.locator('#notebook-panel').waitFor();}
async function layout(page){return page.evaluate(()=>{const binder=document.querySelector('.personal-binder').getBoundingClientRect(),bar=document.querySelector('.shared-voice').getBoundingClientRect();const action=document.querySelector('.app-shell footer')?.getBoundingClientRect();return {finalContentGap:action?bar.top-action.bottom:null,scroll:window.scrollY,documentHeight:document.documentElement.scrollHeight,viewport:innerHeight,binder:{top:binder.top,bottom:binder.bottom,height:binder.height},bar:{top:bar.top,bottom:bar.bottom,height:bar.height},gap:bar.top-binder.bottom,horizontalOverflow:document.documentElement.scrollWidth-innerWidth};});}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE});
 await mkdir('output/playwright/phase4-student',{recursive:true});
 try{for(const width of [1280,390]){const {page,state}=await setup(browser,{width});try{
  for(const name of ['AISupport','DiscussionBoard','CollegeFinanceChat','NativeWelcome'])assert.equal(state.modules.includes(`/src/${name}.tsx`),false,`Unused tool ${name} loaded at login`);
  await page.getByRole('region',{name:'Your profile'}).getByRole('button',{name:'Talk with Origen',exact:true}).waitFor();
  await page.screenshot({path:`output/playwright/phase4-student/${width}-student-home.png`,fullPage:true});
  await openBinder(page);await chooseTopic(page,'transfer',width);
  await page.locator('.notebook-options summary').click();
  await page.locator('.notebook-options-content').waitFor({state:'visible'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'PDF menu overflows the viewport');
  await page.screenshot({path:`output/playwright/phase4-student/${width}-binder-options.png`,fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.notebook-options').getAttribute('open'),null);
  const section=page.locator('.notebook-section-tabs [role=tab]').nth(2);await section.click();
  const sectionName=await section.innerText();
  await page.reload();await page.locator('.binder-open').waitFor();await page.locator('#notebook-panel').waitFor();
  assert.match(await page.locator('.notebook-panel-heading').innerText(),/Transfer/i);
  assert.equal(await page.locator('.notebook-section-tabs [aria-selected=true]').innerText(),sectionName,'Refresh lost reading section');
  await page.goBack();await page.waitForTimeout(150);
  assert.notEqual(await page.locator('.notebook-section-tabs [aria-selected=true]').innerText(),sectionName,'Back did not restore previous reading section');
  await page.goForward();assert.equal(await page.locator('.notebook-section-tabs [aria-selected=true]').innerText(),sectionName);
  await page.locator('.binder-topline button').click();await page.locator('.binder-closed').waitFor();
  await page.goBack();await page.locator('.binder-open').waitFor();
  await page.reload();await page.locator('.binder-open').waitFor();
  assert.match(await page.locator('.notebook-panel-heading').innerText(),/Transfer/i);
  assert.deepEqual(state.errors,[]);assert.equal(state.writes.length,0);
  await page.getByRole('button',{name:'Edit profile',exact:true}).click();
  await page.getByRole('textbox',{name:'Student name',exact:true}).fill('Alex Saved');
  const dialogsBefore=state.dialogs.length;
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.locator('.profile-editor').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>history.state.origenNavigation.values['student.page']),'roadmap','Successful profile save was blocked by its own guard');
  assert.equal(state.dialogs.length,dialogsBefore,'Successful save asked to discard the saved profile');
  assert.ok(state.requests.some(request=>request.path==='/api/family'&&request.action==='save-student'),'Profile did not save');
  assert.deepEqual(state.errors,[]);
  const openCommunity=async()=>{if(width<760)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.sidebar-community button').click();};
  await openCommunity();await page.getByRole('button',{name:'Start a discussion',exact:true}).click();
  await page.getByRole('textbox',{name:'Discussion title',exact:true}).fill('An unfinished synthetic question');
  await page.goBack();await page.goForward();
  assert.equal(await page.getByRole('textbox',{name:'Discussion title',exact:true}).inputValue(),'An unfinished synthetic question','Leaving a deferred tool erased its draft');
  assert.ok(state.modules.includes('/src/DiscussionBoard.tsx'),'Visited tool did not load');
  assert.deepEqual(state.errors,[]);
  console.log(`PASS student/${width}: binder open state, topic and reading section survive refresh and Back/Forward; profile save exits without discard prompt; tools load on demand and preserve drafts (mock APIs only).`);
 }catch(error){console.error(state.errors);console.error((await page.locator('body').innerText()).slice(0,2400));throw error;}finally{await page.close();}}}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
