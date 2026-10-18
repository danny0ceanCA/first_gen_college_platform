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
async function setup(browser,{width=1280,language='en',reducedMotion='reduce'}={}){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion});page.setDefaultTimeout(12000);
 const state={notes:notes(),summary:summary(language),writes:[],errors:[],requests:[]};
 page.on('pageerror',error=>state.errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(language=>localStorage.setItem('origen.language',language),language);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/@auth0_auth0-react.js'))return route.fulfill({contentType:'application/javascript',body:`import React from '/node_modules/.vite/deps/react.js';export const Auth0Context=React.createContext({});const auth={isLoading:false,isAuthenticated:true,user:{sub:${JSON.stringify(subject)}},getAccessTokenSilently:async()=> 'e30.'+btoa(JSON.stringify({sub:${JSON.stringify(subject)}}))+'.test',logout:async()=>{},loginWithRedirect:async()=>{}};export function Auth0Provider({children}){return React.createElement(Auth0Context.Provider,{value:auth},children)}export function useAuth0(){return React.useContext(Auth0Context)}`});
  if(url.pathname.startsWith('/api/')){
   const body=route.request().postDataJSON()||{};state.requests.push({path:url.pathname,action:body.action});
   if(url.pathname==='/api/eligibility')return route.fulfill({json:{subject,allowed:true,status:'adult',ageBand:'18plus'}});
   if(url.pathname==='/api/admin')return route.fulfill({status:403,json:{error:'admin_required'}});
   if(url.pathname==='/api/institutions')return route.fulfill({json:{memberships:[],hasPersonalAccount:false}});
   if(url.pathname==='/api/family')return route.fulfill({json:{account:{firstName:'Alex',email:'alex@example.test',role:'student',welcomeHeard:true,usedVoice:true},students:[{id:studentId,name:'Alex Rivera',stage:'High school',interest:'Nursing and community health',gpa:'3.6',color:'peach',goals:'Explore a college path that lets me care for my community.'}]}});
   if(url.pathname==='/api/conversation-history')return route.fulfill({json:{items:[{id:'conversation-1',studentId,date,mode:'planning',summary:'We discussed majors, college costs, and preparing applications.',sources:[]}]}});
   if(url.pathname==='/api/conversation-summary')return route.fulfill({json:{summary:state.summary,sources:[],date}});
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
 await page.goto(origin+'/#app',{waitUntil:'domcontentloaded'});await page.locator('.binder-cover').waitFor({state:'visible'});await page.locator('.voice-ready').waitFor();
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{}))));
 return {page,state};
}
async function openBinder(page){await page.locator('.binder-cover').click();await page.locator('.binder-open').waitFor();}
async function chooseTopic(page,topic,width){if(width<=760)await page.locator(`[data-topic="${topic}"]`).click();else await page.locator(`#notebook-tab-${topic}`).click();await page.locator('#notebook-panel').waitFor();}
async function layout(page){return page.evaluate(()=>{const binder=document.querySelector('.personal-binder').getBoundingClientRect(),bar=document.querySelector('.shared-voice').getBoundingClientRect();const action=document.querySelector('.permission-withdraw')?.getBoundingClientRect();return {finalContentGap:action?bar.top-action.bottom:null,scroll:window.scrollY,documentHeight:document.documentElement.scrollHeight,viewport:innerHeight,binder:{top:binder.top,bottom:binder.bottom,height:binder.height},bar:{top:bar.top,bottom:bar.bottom,height:bar.height},gap:bar.top-binder.bottom,horizontalOverflow:document.documentElement.scrollWidth-innerWidth};});}
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
 assert.ok(measured.finalContentGap>=8&&measured.finalContentGap<=24,`${label}: bottom content should clear the Origen bar without excessive empty space: ${JSON.stringify(measured)}`);
 return measured;
}
async function topic(page,selected,width){
 if(width<=760&&await page.locator('#notebook-panel').count())await page.locator('.notebook-page-navigation button').click();
 await chooseTopic(page,selected,width);
}
async function readAllNotes(page,language){
 const seen=[];
 const tabs=page.locator('.notebook-section-tabs [role=tab]');
 assert.equal(await tabs.count(),4,'each topic should provide four clear sections');
 for(let section=0;section<4;section++){
  await tabs.nth(section).click();
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
  const first=page.locator('.notebook-reading-page .notebook-note').first();await first.locator('.notebook-note-menu>summary').click();
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
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||'/usr/bin/chromium'});try{
 if(process.argv.includes('--capture-before'))await captureBefore(browser);
 else if(process.argv.includes('--screenshots-only'))await captureDesign(browser);
 else if(process.argv.includes('--reading-only'))await captureDesign(browser,true);
 else if(process.argv.includes('--motion-only'))await captureMotion(browser);
 else {
  const widths=process.env.ORIGEN_BINDER_WIDTHS?process.env.ORIGEN_BINDER_WIDTHS.split(',').map(Number):[320,390,768,1280];
  for(const language of ['en','es']){
   const results=await Promise.allSettled(widths.map(width=>verifyExperience(browser,{width,language,reducedMotion:language==='en'&&(width===390||width===1280)?'no-preference':'reduce'})));
   for(const result of results)if(result.status==='rejected')throw result.reason;
  }
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
