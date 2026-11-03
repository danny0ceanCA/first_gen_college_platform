// Real browser, synthetic account and intercepted APIs. No production or paid AI requests.
const {createRequire}=require('node:module');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright');
const assert=require('node:assert/strict');
const origin=new URL(process.env.ORIGEN_PREVIEW_URL||'http://127.0.0.1:5173').origin;
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use a local development server.');
const subject='synthetic-binder-review',studentId='binder-student',date='2026-10-01T12:00:00.000Z';
const topics=['options','transfer','costs','applications'];
const text={options:['Majors and interests','Explore nursing and public health programs that combine science with community work.','Campus life','Compare commuter support, welcoming student clubs, and academic advising.'],transfer:['Course planning','Meet an advisor to check which biology and writing courses meet transfer requirements.','A path to university','Save the articulation agreement and review it before registering for the next term.'],costs:['Financial aid','Complete the FAFSA and compare grants before considering student loans.','My college budget','Estimate transportation, books, housing, and food alongside tuition.'],applications:['Application dates','Record each application deadline and plan time to request recommendations.','Personal statement','Write about helping family members navigate unfamiliar systems.']};
function summary(language){return Array.from({length:6},(_,index)=>language==='es'?`## Recuerdo ${index+1}\n\nHablamos de enfermería y salud pública, y de encontrar una universidad que apoye tus metas. El siguiente paso es comparar las ayudas y preparar preguntas para el consejero. Quieres estudiar cerca de tu familia y trabajar en una comunidad donde puedas ayudar a otras personas.\n\n- Conversa con tu consejero sobre los cursos y las fechas importantes.\n- Guarda las opciones que te interesen antes de tomar una decisión.`:`## Memory ${index+1}\n\nWe talked about nursing and public health, and finding a college that supports your goals. Next, compare financial aid and prepare questions for your counselor. You would like to study near your family and work in a community where you can support other people.\n\n- Talk with your counselor about courses and important dates.\n- Save the possibilities that interest you before making a decision.`).join('\n\n');}
function notes(){return topics.flatMap(topic=>Array.from({length:18},(_,index)=>({id:`${topic}-${index}`,studentId,topic,kind:['note','explanation','question','decision'][index%4],content:`${text[topic][(index%2)*2]}\n${text[topic][(index%2)*2+1]}\n\n${index%3===0?'Bring this topic to our next conversation. ':''}Entry ${index+1}: ${index===17?'A long reference: '+('collegepath'.repeat(30)): 'Keep this detail together with the questions I want to ask.'}`,language:'en',status:index<8?'suggested':'saved',origin:index<8?'conversation':'user',summaryId:index<8?'conversation-1':null,quote:'We discussed a college path that works with family and financial priorities.',translations:{es:`${topic==='costs'?'Ayuda financiera':'Mi camino a la universidad'}\nComparar las opciones y preparar preguntas para nuestra próxima conversación. Nota ${index+1}. ${index===17?"universidad".repeat(60):""}`},version:1,updatedAt:date,sources:[],conversationAt:index<8?date:null})));}
async function setup(browser,{width=1280,language='en',reducedMotion='reduce',initialState={}}={}){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion});page.setDefaultTimeout(12000);
 const state={notes:notes(),memories:[],feedback:[],summary:summary(language),writes:[],errors:[],requests:[],timings:[],recapCalls:[],activeRecaps:0,maxActiveRecaps:0,...initialState};
 page.on('console',message=>{if(message.text().startsWith('[Origen recap]'))void message.args()[1]?.jsonValue().then(record=>state.timings.push(record)).catch(()=>{});});
 page.on('pageerror',error=>state.errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))state.errors.push(message.text());});page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(language=>localStorage.setItem('origen.language',language),language);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> window.__recapHangToken?new Promise(resolve=>{window.__recapReleaseToken=()=>resolve('e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test');}):'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(url.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:url.pathname,action:body.action});
   if(url.pathname==='/api/coordinator-notifications')return route.fulfill({json:{notifications:[]}});
   if(url.pathname==='/api/student-memory'){if(!['load','revision'].includes(body.action))state.writes.push({path:url.pathname,...body});return route.fulfill({json:{available:true,extractionEnabled:false,organizationManaged:true,memories:state.memories,pendingCount:0}});}
   if(url.pathname==='/api/binder-sharing')return route.fulfill({json:{available:true,enabled:false,connections:[],grants:[]}});
   if(url.pathname==='/api/review-requests')return route.fulfill({json:{available:true,enabled:false,requests:[],activity:[],nextCursor:null}});
   if(url.pathname==='/api/coordinator-feedback'){if(body.action!=='student-list')state.writes.push({path:url.pathname,...body});return route.fulfill({json:{enabled:true,writesEnabled:false,feedback:state.feedback}});}
   if(url.pathname==='/api/eligibility')return route.fulfill({json:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   if(url.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(url.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',email:'alex@example.test',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:studentId,name:'Alex Rivera',stage:'High school',interest:'Nursing and community health',gpa:'3.6',color:'peach',goals:'Explore a college path that lets me care for my community.'}]}});
   if(url.pathname==='/api/conversation-history')return route.fulfill({json:{items:[{id:'conversation-1',studentId,date,mode:'planning',summary:'We discussed majors, college costs, and preparing applications.',sources:[]}]}});
   if(url.pathname==='/api/conversation-summary')return route.fulfill({json:{summary:state.summary,sources:[],date}});
   if(url.pathname==='/api/topic-recap'){
    const es=body.language==='es';
    const sources=state.notes.filter(n=>n.topic===body.topic&&n.studentId===body.studentId).slice(0,2).map(n=>({ref:'note:'+n.id,kind:'note',id:n.id,content:n.content,evidence:{reportedBy:'parent',certainty:'tentative',review:'unreviewed'}}));
    const paragraphs=sources.length?[{text:es?'Según lo que compartió su padre, Aiden está considerando ciencias políticas en UC Davis y todavía no ha elegido un campus. El objetivo de revisar los cursos es entender cómo encajan con esa posibilidad de transferencia.':'From what his parent shared, Aiden is considering political science at UC Davis and has not chosen a campus. Reviewing his courses would help connect that possible transfer path with the choices he makes next.',refs:sources.map(s=>s.ref)},{text:es?'La conversación relacionó esa meta con revisar los requisitos del campus y de la carrera antes de inscribirse. Si cambia de carrera, los requisitos podrían cambiar; aún queda por resolver qué cursos debería revisar con un consejero.':'The conversation connected that goal with reviewing campus and major requirements before registering. Those requirements may change if he changes majors; which courses to discuss with a counselor remains an open question.',refs:sources.map(s=>s.ref)}]:[];
    state.recapCalls.push({...body,at:Date.now()});state.activeRecaps++;state.maxActiveRecaps=Math.max(state.maxActiveRecaps,state.activeRecaps);
    try{
    if(state.recapMalformed)return await route.fulfill({json:{paragraphs:[{text:{unexpected:'object'},refs:['note:bad']}],sources:[null],omitted:0}});
     if(state.recapError)return route.fulfill({status:503,json:{error:'recap_unavailable'}});
    if(state.recapDelay)await new Promise(resolve=>setTimeout(resolve,state.recapDelay));
    return await route.fulfill({json:{paragraphs,sources,omitted:0}});
    }finally{state.activeRecaps--;}
   }
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
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor({state:'visible'}).catch(async error=>{console.error(JSON.stringify({errors:state.errors,body:(await page.locator('body').innerText()).slice(0,2400),requests:state.requests.slice(-12)}));throw error;});if(!process.argv.includes('--recap-only'))await page.locator('.voice-ready').waitFor();
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
 return {page,state};
}
async function openBinder(page){await page.locator('.binder-cover').click();await page.locator('.binder-open').waitFor();}
async function chooseTopic(page,topic,width){if(width<=760)await page.locator(`[data-topic="${topic}"]`).click();else await page.locator(`#notebook-tab-${topic}`).click();await page.locator('#notebook-panel').waitFor();}
async function layout(page){return page.evaluate(()=>{const binder=document.querySelector('.personal-binder').getBoundingClientRect(),bar=document.querySelector('.shared-voice').getBoundingClientRect();const action=document.querySelector('.app-shell footer')?.getBoundingClientRect();return {finalContentGap:action?bar.top-action.bottom:null,scroll:window.scrollY,documentHeight:document.documentElement.scrollHeight,viewport:innerHeight,binder:{top:binder.top,bottom:binder.bottom,height:binder.height},bar:{top:bar.top,bottom:bar.bottom,height:bar.height},gap:bar.top-binder.bottom,horizontalOverflow:document.documentElement.scrollWidth-innerWidth};});}
async function captureBefore(browser){
 for(const width of [1280,390]){const {page,state}=await setup(browser,{width});try{
  await page.screenshot({path:`/tmp/binder-before-${width===1280?'desktop':'mobile'}-closed.png`});
  await openBinder(page);await chooseTopic(page,'options',width);await page.screenshot({path:`/tmp/binder-before-${width===1280?'desktop':'mobile'}.png`,fullPage:true});
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));console.log(JSON.stringify({case:'before-bottom-gap',width,...await layout(page),errors:state.errors}));
 }finally{await page.close();}}
}
async function assertBounds(page,label){
 const bounds=await page.evaluate(()=>{
  const panel=document.querySelector('#notebook-panel'),paper=document.querySelector('.binder-pages');
  const failures=[...document.querySelectorAll('.notebook-note-content,.notebook-editor textarea,.notebook-section-tabs button,.notebook-toolbar button')].filter(element=>element.getClientRects().length).flatMap(element=>{
   const rect=element.getBoundingClientRect();return rect.left<-1||rect.right>innerWidth+1?[{text:element.textContent.slice(0,60),left:rect.left,right:rect.right}]:[];
  });
  return {overflow:document.documentElement.scrollWidth-innerWidth,panel:panel?.getBoundingClientRect().width,paper:paper?.getBoundingClientRect().width,failures};
 });
 assert.ok(bounds.overflow<=1,`${label}: document should fit the viewport: ${JSON.stringify(bounds)}`);
 assert.deepEqual(bounds.failures,[],`${label}: writing and controls should fit the viewport`);
 if(bounds.panel)assert.ok(bounds.panel<=bounds.paper,`${label}: page should fit within the paper`);
}
async function assertBottomGap(page,label){
 await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
 await page.waitForTimeout(100);
 const measured=await layout(page);
 assert.ok(measured.finalContentGap>=0&&measured.finalContentGap<=24,`${label}: bottom content should clear the Origen bar without excessive empty space: ${JSON.stringify(measured)}`);
 return measured;
}
async function topic(page,selected,width){
 if(width<=760&&await page.locator('#notebook-panel').count())await page.locator('.notebook-page-navigation button').click();
 await chooseTopic(page,selected,width);
}
async function readAllNotes(page,language){
 const seen=[];
 const tabs=page.locator('.notebook-section-tabs [role=tab]');
 assert.equal(await tabs.count(),5,'each topic should provide consistent section navigation');
 for(const kind of ['note','explanation','question','decision']){
  await page.locator('#notebook-section-'+kind).click();
  const allNotes=page.getByRole('button',{name:language==='es'?'Leer todas las notas':'Read all notes',exact:true});
  if(await allNotes.count())await allNotes.click();
  while(true){
   const entries=page.locator('.notebook-reading-page .notebook-note');
   const ids=await entries.evaluateAll(elements=>elements.map(element=>element.dataset.noteId));
   assert.ok(ids.length<=4,'each reading page should contain at most four entries');assert.ok(ids.every(Boolean),'notes should have stable IDs');seen.push(...ids);
   const next=page.getByRole('button',{name:language==='es'?'Página siguiente':'Next page',exact:true});
   if(!await next.count()||await next.isDisabled())break;
   await next.click();
  }
 }
 assert.equal(new Set(seen).size,seen.length,'a note must not be duplicated across sections or pages');
 return seen;
}
async function readSummary(page,language,width){
 if(width<=760)await chooseTopic(page,'summary',width);
 // Summary generation starts when its section enters the viewport.
 await page.locator('.home-memory').scrollIntoViewIfNeeded();
 await page.locator('.binder-summary-writing').waitFor();
 const reader=page.locator('.binder-summary-reader');let written='';let pages=0;
 assert.equal(await reader.getByRole('button',{name:language==='es'?'Anterior':'Previous',exact:true}).isDisabled(),true);
 while(true){
  const sheet=page.locator('.binder-summary-writing');written+='\n'+await sheet.innerText();pages++;
  assert.ok(await sheet.evaluate(element=>element.scrollHeight<=element.clientHeight+1),'summary pages should not introduce a nested vertical scrollbar');
  await assertBounds(page,'summary');
  const next=reader.getByRole('button',{name:language==='es'?'Siguiente':'Next',exact:true});
  if(await next.isDisabled())break;await next.click();
  assert.equal(await sheet.evaluate(element=>element===document.activeElement),true,'summary page turns should focus the new text');
 }
 assert.ok(pages>1&&pages<10,'long summaries should have a bounded page navigation');
 for(let index=1;index<=6;index++)assert.ok(written.includes(`${language==='es'?'Recuerdo':'Memory'} ${index}`),'all summary sections should remain readable');
 await reader.getByRole('button',{name:language==='es'?'Anterior':'Previous',exact:true}).click();
 if([390,1280].includes(width))await page.screenshot({path:`/tmp/binder-after-${width}-${language}-summary.png`,fullPage:true});
}
async function verifyExperience(browser,{width,language,reducedMotion}){
 const {page,state}=await setup(browser,{width,language,reducedMotion});const label=`${width}px ${language} ${reducedMotion}`;
 try{
  await assertBounds(page,label+' closed');
  if([390,1280].includes(width))await page.screenshot({path:`/tmp/binder-after-${width}-${language}-closed.png`});
  for(let cycle=0;cycle<2;cycle++){
   await page.locator('.binder-cover').click();
   if(reducedMotion==='no-preference'&&cycle===0){
    await page.locator('.binder-opening').waitFor();assert.equal(await page.locator('.binder-pages').evaluate(element=>element.inert),true,'moving paper must not accept keyboard input');
    await page.waitForTimeout(200);await page.screenshot({path:`/tmp/binder-opening-${width}-200.png`});await page.waitForTimeout(180);await page.screenshot({path:`/tmp/binder-opening-${width}-400.png`});
   }
   await page.locator('.binder-open').waitFor();
   assert.equal(await page.locator('.binder-pages').evaluate(element=>element.inert),false,'open paper should accept keyboard input');
   assert.equal(await page.locator('.binder-topline button').evaluate(element=>element===document.activeElement),true,'opening should focus Close binder');
   await assertBounds(page,label+' open');
   await page.locator('.binder-topline button').click();
   if(reducedMotion==='no-preference'&&cycle===0){await page.waitForTimeout(200);await page.screenshot({path:`/tmp/binder-closing-${width}-200.png`});await page.waitForTimeout(180);await page.screenshot({path:`/tmp/binder-closing-${width}-400.png`});}
   await page.locator('.binder-closed').waitFor();
   const closed=await page.locator('.binder-cover').evaluate(element=>({focused:element===document.activeElement,activeTag:document.activeElement?.tagName,activeClass:document.activeElement?.className,activeText:document.activeElement?.textContent.slice(0,120),phase:element.parentElement.className,disabled:element.disabled,hidden:element.hidden}));
   assert.equal(closed.focused,true,`closing should restore focus to the cover: ${JSON.stringify(closed)}`);
   assert.equal(await page.locator('.binder-pages').isVisible(),false,'closed paper should not remain in layout');
   assert.ok(await page.locator('.personal-binder').evaluate(element=>element.style.height===''||element.style.height==='auto'),'a completed animation must release its fixed height');
  }
  await openBinder(page);await readSummary(page,language,width);await topic(page,'options',width);
  const writing=await page.locator('.notebook-note-content').first().evaluate(async element=>{const faces=await document.fonts.load('21px "Binder Hand"');return {family:getComputedStyle(element).fontFamily,fontLoaded:faces.some(face=>face.status==='loaded')};});
  assert.ok(writing.fontLoaded,'the bundled handwriting font should load without an external font service');assert.match(writing.family,/Binder Hand/,'note text should use the handwriting font');
  const allIds=await readAllNotes(page,language);assert.equal(allIds.length,18,'every saved and suggested note remains reachable');
  await assertBounds(page,label+' last note page');
  const longNote=page.locator('.notebook-note[data-note-id="options-17"]');
  await page.locator('.notebook-section-tabs [role=tab]').nth(1).click();
  while(!await longNote.count()){const next=page.getByRole('button',{name:language==='es'?'Página siguiente':'Next page',exact:true});assert.ok(await next.count()&&await next.isEnabled(),'the complete long note should remain reachable');await next.click();}
  {
   const expand=longNote.getByRole('button',{name:language==='es'?'Leer nota completa':'Read full note',exact:true});
   assert.equal(await expand.count(),1,'long notes should have an accessible reading control');await expand.click();await assertBounds(page,label+' expanded long word');await longNote.getByRole('button',{name:language==='es'?'Ver menos':'Show less',exact:true}).click();
  }
  // Drafts survive moving between dividers, and a saved note remains available after reload.
  await topic(page,'transfer',width);
  await page.getByRole('button',{name:language==='es'?'Agregar una nota':'Add a note',exact:true}).click();
  const draft=`My advisor appointment is Tuesday. ${label}`;
  await page.locator('.notebook-editor textarea').fill(draft);
  await topic(page,'costs',width);await topic(page,'transfer',width);
  assert.equal(await page.locator('.notebook-editor textarea').inputValue(),draft,'switching topics should preserve an unfinished note');
  await page.getByRole('button',{name:language==='es'?'Guardar nota':'Save note',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.notebook-editor'));
  assert.equal(state.writes.filter(write=>write.action==='create').length,1);
  assert.equal(state.notes.filter(note=>note.content===draft).length,1);
  await topic(page,'options',width);await page.locator('.notebook-section-tabs [role=tab]').first().click();
  const first=page.locator('.notebook-reading-page .notebook-note').first();
  await first.getByRole('button',{name:language==='es'?'Editar original':'Edit',exact:true}).click();
  const edited=`Updated after counselor review. ${label}`;await page.locator('.notebook-editor textarea').fill(edited);
  await page.getByRole('button',{name:language==='es'?'Guardar nota':'Save note',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.notebook-editor'));
  assert.equal(state.writes.filter(write=>write.action==='update').length,1);
  assert.ok(state.notes.some(note=>note.content===edited),'the original entry should be updated');
  await assertBounds(page,label+' saved');const bottom=await assertBottomGap(page,label);
  if([390,1280].includes(width))await page.screenshot({path:`/tmp/binder-after-${width}-${language}-bottom.png`});
  await page.screenshot({path:`/tmp/binder-after-${width}-${language}.png`,fullPage:true});
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor();await openBinder(page);await chooseTopic(page,'transfer',width);
  const savedIds=await readAllNotes(page,language);assert.ok(savedIds.includes(state.notes.find(note=>note.content===draft).id),'saved note remains reachable after reloading');
  assert.deepEqual(state.errors,[],`${label}: browser should not report JavaScript errors`);
  console.log(`PASS ${label}: cover cycles and focus, 18 notes across sections/pages, drafts, create/edit/reload, bounded content; bottom clearance ${Math.round(bottom.finalContentGap)}px.`);
 }finally{await page.close();}
}
async function captureDesign(browser,readingOnly=false){
 require('node:fs').mkdirSync('output',{recursive:true});
 async function fullPage(page,path){
  // A tall capture keeps fixed controls at the foot of the image instead of
  // painting the voice bar across the middle of a stitched screenshot.
  const viewport=page.viewportSize(),height=await page.evaluate(()=>document.documentElement.scrollHeight);
  await page.setViewportSize({...viewport,height});
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
  await page.screenshot({path,fullPage:true});await page.setViewportSize(viewport);
 }
 for(const width of [1280,390]){
  const {page,state}=await setup(browser,{width});const size=width===1280?'desktop':'mobile';
  try{
   const entries=[
    ['note','What matters to me\nI want to study nursing or public health, stay close to my family, and find a campus where asking for help feels easy.'],
    ['note','A place to start\nCompare a community college transfer path with a four-year nursing program. I would like to visit both before deciding.'],
    ['explanation','Looking beyond the major\nAcademic advising, tutoring, and support for first-generation students are part of finding a good fit. I can ask about these during a campus visit.'],
    ['question','Questions for a campus visit\nHow do students get help with their first science courses? Are there paid opportunities to learn about community health?'],
    ['decision','My next step\nI decided to make a short list of programs near home and bring it to my counselor before choosing where to apply.']
   ];
   state.notes=entries.map(([kind,content],index)=>({...notes()[index],id:`design-${index}`,kind,content,status:'saved',origin:'user',summaryId:null,quote:'',translations:{},conversationAt:null}));
   state.summary='## A direction that feels like you\n\nYou are interested in nursing and public health, especially work that helps families in your community. Staying close to home and having someone to turn to for guidance matter to you.\n\n## Exploring the possibilities\n\nWe talked about comparing a community college transfer path with a four-year program. Campus visits could help you understand the classes, support, and everyday experience of each option.\n\n## What comes next\n\nYou decided to make a short list of programs near home. Bring that list to your counselor, along with your questions about financial aid and the first science courses.';
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor();await page.locator('.voice-ready').waitFor();
   await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));await document.fonts.load('21px "Binder Hand"');});
   if(!readingOnly)await page.screenshot({path:`output/binder-redesign-${size}-closed.png`});
   await openBinder(page);if(width<=760)await chooseTopic(page,'summary',width);await page.locator('.binder-summary-writing').waitFor();
   await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
   if(!readingOnly)await fullPage(page,`output/binder-redesign-${size}-summary.png`);
   await topic(page,'options',width);await page.locator('.notebook-note-content').first().waitFor();
   await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
   if(!readingOnly)await fullPage(page,`output/binder-redesign-${size}.png`);
   await page.locator(width<=760?'.notebook-page-navigation':'.notebook-topics').evaluate(element=>window.scrollTo({top:window.scrollY+element.getBoundingClientRect().top-24,behavior:'instant'}));
   await page.screenshot({path:`output/binder-redesign-${size}-reading.png`});
   if(!readingOnly){await assertBottomGap(page,`${size} design capture`);await page.screenshot({path:`output/binder-redesign-${size}-bottom.png`});}
  }finally{await page.close();}
 }
}
async function captureMotion(browser){
 for(const width of [390,1280]){
  const {page,state}=await setup(browser,{width,reducedMotion:'no-preference'});
  try{for(let cycle=0;cycle<2;cycle++){
   await page.locator('.binder-cover').click();await page.locator('.binder-opening').waitFor();
   assert.equal(await page.locator('.binder-pages').evaluate(element=>element.inert),true);
   if(cycle===0){await page.waitForTimeout(200);await page.screenshot({path:`/tmp/binder-opening-${width}-200.png`});await page.waitForTimeout(180);await page.screenshot({path:`/tmp/binder-opening-${width}-400.png`});}
   await page.locator('.binder-open').waitFor();assert.equal(await page.locator('.binder-topline button').evaluate(element=>element===document.activeElement),true);
   await page.locator('.binder-topline button').click();
   if(cycle===0){await page.waitForTimeout(200);await page.screenshot({path:`/tmp/binder-closing-${width}-200.png`});await page.waitForTimeout(180);await page.screenshot({path:`/tmp/binder-closing-${width}-400.png`});}
   await page.locator('.binder-closed').waitFor();assert.equal(await page.locator('.binder-cover').evaluate(element=>element===document.activeElement),true);
   assert.equal(await page.locator('.binder-pages').isVisible(),false);assert.ok(await page.locator('.personal-binder').evaluate(element=>element.style.height===''||element.style.height==='auto'));
  }assert.deepEqual(state.errors,[]);console.log(`PASS ${width}px: final opening/closing motion, two cycles, focus and height cleanup.`);}finally{await page.close();}
 }
}
async function verifyRecapPreloading(browser){
 const waitFor=async predicate=>{for(let n=0;n<150;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Background recap condition timed out');};
 await require('node:fs/promises').mkdir('output/playwright/recap-preload',{recursive:true});
 for(const [width,language] of [[1280,'en'],[390,'es']]){
  const sourceNotes=['options','transfer'].flatMap(topic=>[0,1].map(index=>({id:topic+'-'+index,studentId,topic,kind:'explanation',content:'Synthetic context for '+topic+' '+index,language,status:'saved',origin:'manual',translations:{},version:1,updatedAt:date,sources:[]})));
  const {page,state}=await setup(browser,{width,language,reducedMotion:width===1280?'no-preference':'reduce',initialState:{notes:sourceNotes,recapDelay:250}});
  try{
   await waitFor(()=>state.timings.filter(row=>row.event==='topic_recap.finished'&&row.outcome==='completed').length===2);
   assert.equal(await page.locator('.binder-cover').count(),1,'Preload recaps while the binder is still closed');
   assert.deepEqual(state.recapCalls.map(row=>row.topic),['options','transfer']);
   assert.ok(state.recapCalls.every(row=>row.loadMode==='background'));
   assert.equal(state.maxActiveRecaps,1,'Background work must be sequential');
   const finished=state.timings.filter(row=>row.event==='topic_recap.finished');
   assert.ok(finished.every(row=>row.durationMs>=240&&row.totalMs>=row.durationMs&&row.queueMs>=0));
   assert.ok(finished[1].queueMs>finished[0].queueMs,'Queue time includes earlier background work');
   await openBinder(page);await topic(page,'transfer',width);await page.locator('.topic-story-writing').waitFor();
   assert.equal(await page.locator('.topic-story-loading').count(),0,'Prepared topic opens without a second loading placeholder');
   await topic(page,'options',width);await page.locator('.topic-story-writing').waitFor();
   await topic(page,'transfer',width);await page.locator('.topic-story-writing').waitFor();
   await page.waitForTimeout(250);
   assert.equal(state.recapCalls.length,2,'Opening already prepared topics must not request another generation');
   assert.ok(state.timings.some(row=>row.event==='topic_recap.reused'&&row.topic==='transfer'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Recap fits the viewport');
   await page.locator('.topic-story').screenshot({path:`output/playwright/recap-preload/${language}-${width}.png`});

   state.memories=[{id:'new-context',version:1,studentId,category:'goal',content:'A corrected fictional transfer goal.',language,speaker:'student',reportedBy:'student',status:'confirmed',updatedAt:date,organization:{topic:'transfer'}}];
   await page.evaluate(async({subject,studentId})=>{const {notifyMemoryContext}=await import('/src/memoryContext.mjs');notifyMemoryContext(subject,studentId);},{subject,studentId});
   await waitFor(()=>state.recapCalls.length===3&&state.timings.filter(row=>row.event==='topic_recap.finished'&&row.outcome==='completed').length===3);
   assert.equal(state.recapCalls[2].topic,'transfer','Changed context refreshes the affected topic');
   await topic(page,'options',width);await page.locator('.topic-story-writing').waitFor();
   assert.equal(state.recapCalls.filter(row=>row.topic==='options').length,1,'Unchanged topic remains reusable');

   // Persist the last topic, close the binder, and return in a fresh page.
   await topic(page,'transfer',width);await page.locator('.topic-story-writing').waitFor();
   await page.locator('.binder-topline > button').click();await page.locator('.binder-cover').waitFor();
   state.recapCalls=[];state.timings=[];state.recapDelay=1600;state.maxActiveRecaps=0;
   await page.reload();await page.locator('.binder-cover').waitFor();
   await waitFor(()=>state.recapCalls.length===1);
   assert.equal(state.recapCalls[0].topic,'transfer','Last viewed topic is prepared first after returning');
   await openBinder(page);await topic(page,'options',width);await page.locator('.topic-story-loading').waitFor();
   await waitFor(()=>state.recapCalls.length===2);
   assert.equal(state.recapCalls[1].loadMode,'foreground','Opening a queued topic promotes it immediately');
   assert.ok(state.recapCalls[1].at-state.recapCalls[0].at<1600,'Foreground must not wait behind another generation');
   assert.equal(state.maxActiveRecaps,2);
   await page.locator('.topic-story-writing').waitFor();
   if(width===1280){
    state.recapCalls=[];state.timings=[];await page.reload();await page.locator('.personal-binder').waitFor();
    await waitFor(()=>state.recapCalls.length>0);
    await page.evaluate(async()=>{const {browserPrivacy}=await import('/src/browserPrivacy.mjs');browserPrivacy.stop('logout');});
    await waitFor(()=>state.timings.some(row=>row.outcome==='cancelled'));
    const requestsAtLogout=state.recapCalls.length;await page.waitForTimeout(1800);
    assert.equal(state.recapCalls.length,requestsAtLogout,'Logout must stop the background queue');
    assert.equal(state.timings.filter(row=>row.outcome==='completed').length,0,'A late response must not be accepted after logout');
    assert.equal(await page.locator('.topic-story-writing').count(),0,'Logout clears visible recaps');
   }
   assert.deepEqual(state.errors,[]);
   console.log(JSON.stringify({test:'recap-background-loading',width,language,serial:true,cached:true,invalidated:true,priority:true,foregroundPromotion:true}));
  }finally{await page.close();}
 }
}
async function verifyRememberRecap(browser){
 await require('node:fs/promises').mkdir('output/playwright/remember-recap',{recursive:true});
 await require('node:fs/promises').mkdir('output/playwright/memory-overview',{recursive:true});
 for(const width of [1280,390,320])for(const language of ['en','es']){
  const {page,state}=await setup(browser,{width,language});
  try{
   state.notes=Array.from({length:14},(_,index)=>({id:'remember-'+index,studentId,topic:'transfer',kind:'explanation',content:index===0?'His binder shows summaries related to transfer requirements.':language==='es'?'Antes de inscribirte en el curso '+index+', confirma con tu consejero si cumple los requisitos del campus y de la carrera. Si cambias de carrera, los requisitos podrían cambiar.':'Before registering for course '+index+', confirm whether it meets the campus and major requirements. If you change majors, the requirements may change.',language,status:'suggested',origin:'conversation',summaryId:'conversation-1',quote:'A saved conversation summary.',translations:{},version:1,updatedAt:date,sources:[],conversationAt:date}));
   const details=[
    ['goal','The discussion focused on helping Aiden explore transferring from community college to a university.','La conversación se centró en ayudar a Aiden a explorar una transferencia de un colegio comunitario a una universidad.'],
    ['goal','Aiden is interested in political science and may transfer to UC Davis; he has not chosen a campus yet.','Aiden tiene interés en ciencias políticas y quizá se transfiera a UC Davis; todavía no ha elegido un campus.'],
    ['goal','He would like to compare transfer support at several campuses before deciding.','Le gustaría comparar el apoyo para estudiantes de transferencia en varios campus antes de decidir.'],
    ['constraint','He works afternoon shifts at a bookstore and needs to consider that when choosing classes.','Trabaja por las tardes en una librería y necesita tenerlo en cuenta al elegir sus clases.'],
    ['constraint','His parent reported that a long commute may make it difficult to combine classes, work, and family responsibilities. Aiden still wants to review the available class schedules and transportation options before deciding whether living at home would work for him.','Su padre informó que un viaje largo podría dificultar la combinación de clases, trabajo y responsabilidades familiares. Aiden todavía quiere revisar los horarios y las opciones de transporte antes de decidir si vivir en casa sería una buena opción para él.'],
    ['preference','He prefers to discuss one option at a time, with a concrete example.','Prefiere hablar de una opción a la vez, con un ejemplo concreto.'],
    ['question','Could he take biology and chemistry together while keeping time for his bookstore shifts?','¿Podría cursar biología y química a la vez y tener tiempo para trabajar en la librería?'],
    ['question','Which courses should he discuss with a counselor before registering for next term?','¿Qué cursos debería revisar con un consejero antes de inscribirse para el próximo período?'],
   ];
   state.memories=details.map(([category,en,es],index)=>({id:'detail-'+index,version:1,studentId,category,content:language==='es'?es:en,language,speaker:'parent',reportedBy:'parent',status:'proposed',summaryId:'conversation-1',sourceVersion:'v1',quote:'A synthetic parent report.',updatedAt:date,organization:{version:'1',topic:'transfer',category,certainty:'tentative',reportedBy:'parent',evidenceKind:'saved_summary',sourceVersion:'v1'}}));
   state.feedback=[1,7].map(index=>({id:'comment-'+index,topic:'transfer',kind:'guidance',body:'Synthetic coordinator guidance for detail '+index,resourceUrl:'',version:1,authorName:'Test Coordinator',organizationName:'Synthetic Organization',createdAt:date,editedAt:null,withdrawn:false,hidden:false,reviewed:true,connectionEnded:false,publicationItemId:null,replyCount:0,anchor:{id:'detail-'+index,kind:'memory',version:1}}));
   await page.reload();await page.locator('.personal-binder').waitFor();if(!await page.locator('.binder-open').count())await openBinder(page);await topic(page,'transfer',width);
   await page.locator('#notebook-section-explanation').click();
   const recap=page.locator('.topic-story');await recap.locator('.topic-story-writing').waitFor();
   assert.equal(await recap.locator('.topic-story-writing > p').count(),2);
   assert.equal(await page.locator('.student-memory-topic').count(),0,'Personal details must not interrupt key points');
   await page.locator('#notebook-section-details').click();await page.locator('.memory-overview').waitFor();
   assert.equal(await recap.count(),0,'Only the selected section should be on the paper');
   assert.equal(await page.locator('.memory-overview-group').count(),4,'Details should be organized by their saved categories');
   assert.equal(await page.locator('.memory-overview-detail').count(),4,'Keep the overview short');
   assert.equal(await page.locator('.memory-overview-comments').count(),1,'A comment on a highlighted detail remains discoverable');
   assert.equal(await page.locator('.memory-entries').count(),0,'Do not stack the originals below the overview');
   await assertBounds(page,'memory overview');
   await page.locator('.notebook-section-tabs').evaluate(el=>window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top-(innerWidth>760?document.querySelector('.notebook-topics').getBoundingClientRect().height+20:70),behavior:'instant'}));
   await page.screenshot({path:'output/playwright/memory-overview/'+width+'-'+language+'.png'});
   await page.locator('.memory-overview-detail').last().click();
   await page.locator('[data-memory-id="detail-6"]').waitFor();
   assert.equal(await page.locator('[data-memory-id="detail-6"]').evaluate(el=>el===document.activeElement),true,'Opening a highlight must focus the right original, even on a later page');
   assert.equal(await page.locator('[data-memory-id="detail-7"] [data-comment-id="comment-7"]').count(),1,'Comments on details omitted from highlights remain attached to their originals');
   await page.getByRole('button',{name:language==='es'?'Volver a los puntos destacados':'Back to highlights',exact:true}).click();await page.locator('.memory-overview').waitFor();
   await page.getByRole('button',{name:language==='es'?'Leer todos los datos (8)':'Read all details (8)',exact:true}).click();
   assert.equal(await page.locator('.memory-record-tools .memory-attribution').first().isVisible(),false,'Repeated attribution should be tucked away');
   await page.locator('.memory-record-tools > summary').first().click();assert.equal(await page.locator('.memory-record-tools .memory-attribution').first().isVisible(),true);
   const originalDetails=[];
   while(true){originalDetails.push(...await page.locator('[data-memory-id]').evaluateAll(els=>els.map(el=>el.dataset.memoryId)));const next=page.getByRole('navigation',{name:language==='es'?'Páginas de recuerdos':'Memory pages',exact:true}).getByRole('button',{name:language==='es'?'Siguiente':'Next',exact:true});if(await next.isDisabled())break;await next.click();}
   assert.equal(new Set(originalDetails).size,8,'Every original detail remains accessible');
   await page.getByRole('button',{name:language==='es'?'Volver a los puntos destacados':'Back to highlights',exact:true}).click();
   await page.locator('.memory-overview-detail').first().click();await page.locator('.memory-record-tools > summary').first().click();
   assert.equal(await page.locator('[data-memory-id="detail-1"] [data-comment-id="comment-1"]').count(),1);
   await page.getByRole('button',{name:language==='es'?'Editar dato':'Edit detail',exact:true}).first().click();
   await page.locator('.memory-editor textarea').fill('A synthetic correction that must stay in the draft.');
   assert.equal(await page.getByRole('button',{name:language==='es'?'Volver a los puntos destacados':'Back to highlights',exact:true}).isDisabled(),true,'Do not collapse a live correction draft');
   await page.getByRole('button',{name:language==='es'?'Cancelar':'Cancel',exact:true}).click();
   await page.locator('#notebook-section-details').press('ArrowRight');assert.equal(await page.locator('#notebook-section-note').getAttribute('aria-selected'),'true');
   await page.locator('#notebook-section-explanation').click();await recap.waitFor();
   assert.ok(!(await recap.innerText()).includes('His binder shows summaries'));
   await recap.locator('.topic-story-writing').waitFor();
   assert.ok((await recap.locator('.topic-story-writing').innerText()).includes('UC Davis'));
   assert.equal(await page.locator('.notebook-pagination').count(),0);
   await assertBounds(page,'compact recap');
   await page.locator('.notebook-panel-heading').evaluate(el=>window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top-(innerWidth>760?document.querySelector('.notebook-topics').getBoundingClientRect().height+20:70),behavior:'instant'}));
   await page.screenshot({path:'output/playwright/remember-recap/'+width+'-'+language+'.png'});
   await recap.locator('.topic-story-sources > summary').click();
   await recap.getByRole('button',{name:language==='es'?'Abrir nota original':'Open original note',exact:true}).first().click();
   await page.locator('.notebook-note').first().waitFor();
   assert.equal(await recap.count(),0);assert.equal(await page.locator('.notebook-note').count(),4);
   assert.ok((await page.locator('.notebook-entries').innerText()).includes(language==='es'?'requisitos':'requirements'));
   const seen=[];
   while(true){seen.push(...await page.locator('.notebook-note').evaluateAll(els=>els.map(el=>el.dataset.noteId)));const next=page.getByRole('button',{name:language==='es'?'Página siguiente':'Next page',exact:true});if(await next.isDisabled())break;await next.click();}
   assert.equal(new Set(seen).size,14,'Every original remains accessible');
   await page.getByRole('button',{name:language==='es'?'Volver al resumen':'Back to recap',exact:true}).click();await recap.waitFor();
   if(width===1280&&language==='en'){
    // A malformed successful response must not crash the binder or hide originals.
    state.recapMalformed=true;await page.reload();
    await recap.getByRole('button',{name:'Try again',exact:true}).waitFor({timeout:6000});
    await page.getByRole('button',{name:'Read all notes',exact:true}).click();
    assert.equal(await page.locator('.notebook-note').count(),4,'Originals survive a malformed response');
    state.recapMalformed=false;await page.getByRole('button',{name:'Back to recap',exact:true}).click();await recap.getByRole('button',{name:'Try again',exact:true}).click();await recap.locator('.topic-story-writing').waitFor();
    // A token provider that ignores aborts must still end in a retryable state.
    state.recapError=true;await page.reload();await recap.getByRole('button',{name:'Try again',exact:true}).waitFor();state.recapError=false;
    await page.evaluate(()=>{window.__recapHangToken=true;window.__recapSetTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>window.__recapSetTimeout(fn,ms===55000?40:ms,...args);});
    const requestsBefore=state.requests.filter(r=>r.path==='/api/topic-recap').length;
    await recap.getByRole('button',{name:'Try again',exact:true}).click();
    await recap.getByRole('button',{name:'Try again',exact:true}).waitFor();
    assert.equal(state.requests.filter(r=>r.path==='/api/topic-recap').length,requestsBefore,'A stuck token must not send a request');
    await page.evaluate(()=>{window.__recapReleaseToken?.();window.__recapHangToken=false;window.setTimeout=window.__recapSetTimeout;});
    await page.waitForTimeout(100);
    assert.equal(state.requests.filter(r=>r.path==='/api/topic-recap').length,requestsBefore,'A token arriving after timeout must not restart the request');
    await recap.getByRole('button',{name:'Try again',exact:true}).click();await recap.locator('.topic-story-writing').waitFor();
    // Leaving a delayed recap must not bring its text into another divider.
    state.recapDelay=900;await page.reload();await recap.locator('[role="status"]').waitFor();
    await topic(page,'applications',width);await page.waitForTimeout(1100);
    assert.equal(await page.locator('.topic-story-writing').count(),0,'No late transfer narrative in Applications');
    state.recapDelay=0;state.recapError=true;await topic(page,'transfer',width);await page.reload();
    await recap.getByRole('button',{name:'Try again',exact:true}).waitFor();
    await page.getByRole('button',{name:'Read all notes',exact:true}).click();assert.equal(await page.locator('.notebook-note').count(),4,'Originals remain readable during provider failure');
    await page.getByRole('button',{name:'Back to recap',exact:true}).click();await recap.getByRole('button',{name:'Try again',exact:true}).waitFor();
    state.recapError=false;await recap.getByRole('button',{name:'Try again',exact:true}).click();await recap.locator('.topic-story-writing').waitFor();
   }
   assert.deepEqual(state.writes,[]);assert.deepEqual(state.errors,[]);
   console.log('PASS recap '+width+'px '+language+': connected story; source links; grouped details; precise original focus; all 14 notes and 8 details retained; correction draft protected; no writes.');
  }finally{await page.close();}
 }
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||'/usr/bin/chromium'});try{
 if(process.argv.includes('--capture-before'))await captureBefore(browser);
 else if(process.argv.includes('--screenshots-only'))await captureDesign(browser);
 else if(process.argv.includes('--reading-only'))await captureDesign(browser,true);
 else if(process.argv.includes('--motion-only'))await captureMotion(browser);
 else if(process.argv.includes('--recap-only'))await verifyRememberRecap(browser);
 else if(process.argv.includes('--prefetch-only'))await verifyRecapPreloading(browser);
 else {
  const widths=process.env.ORIGEN_BINDER_WIDTHS?process.env.ORIGEN_BINDER_WIDTHS.split(',').map(Number):[320,390,768,1280];
  for(const language of ['en','es']){
   const results=await Promise.allSettled(widths.map(width=>verifyExperience(browser,{width,language,reducedMotion:language==='en'&&(width===390||width===1280)?'no-preference':'reduce'})));
   for(const result of results)if(result.status==='rejected')throw result.reason;
  }
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
