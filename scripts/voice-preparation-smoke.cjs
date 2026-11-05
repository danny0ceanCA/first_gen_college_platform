// Browser integration with fictional accounts, intercepted APIs and fake media.
// No production data, real microphone access, or paid model calls.
const {createRequire}=require('node:module'),assert=require('node:assert/strict');
const resolve=process.env.ORIGEN_BROWSER_MODULE_ROOT?createRequire(process.env.ORIGEN_BROWSER_MODULE_ROOT+'/package.json'):require;
const {chromium}=resolve('playwright'),{setup,studentId}=require('./student-memory-smoke.cjs');
async function until(check){for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Preparation did not arrive before clicking Talk');}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ORIGEN_BROWSER_EXECUTABLE||undefined});
 try{for(const role of ['student','parent'])for(const language of ['en','es']){
  const requests=[];
  const {page,state}=await setup(browser,{width:language==='en'?1280:390,language,configurePage:async p=>{
   p.on('pageerror',error=>console.error('Browser error:',error.message));
   p.on('requestfailed',request=>console.error('Request failed:',request.url(),request.failure()?.errorText));
   await p.addInitScript(()=>{window.microphoneCalls=0;const get=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async(...args)=>{window.microphoneCalls++;return get(...args);};});
   await p.route('**/api/family',r=>r.fulfill({json:{account:{firstName:'Synthetic',email:'fictional@example.test',role,welcomeHeard:true,usedVoice:true},students:[{id:studentId,name:'Alex Example',stage:'Community college',interest:'Science',color:'peach'}]}}));
   await p.route('**/api/review-requests',r=>r.fulfill({json:{enabled:false,available:false,deliveryEnabled:false,requests:[],nextCursor:null,activity:[]}}));
   await p.route('**/api/profile-voice',r=>{
    const input=r.request().postDataJSON();requests.push(input);
    return r.fulfill({json:input.action==='prepare'?{preparedContextId:input.targetConfirmed?'selected-prepared':'neutral-prepared',expiresInMs:60000}:{sdp:'v=0\r\n',playWelcome:false}});
   });
  }});
  try{
   await until(()=>requests.some(r=>r.action==='prepare'&&(role==='student'||r.targetConfirmed===false)));
   assert.equal(await page.evaluate(()=>window.microphoneCalls),0);assert.ok(requests.every(r=>r.action==='prepare'));
   const preparations=requests.length;
   await page.locator('.shared-voice .voice-origen-button').first().click();
   await page.waitForFunction(()=>window.connections.at(-1)?.connectionState==='connected');
   const call=requests.find(r=>r.sdp);assert.ok(call);assert.equal(call.preparedContextId,role==='student'?'selected-prepared':'neutral-prepared');
   assert.equal(call.language,language);assert.equal(call.voiceProtocol,'live-v1');assert.equal(requests.filter(r=>r.action==='prepare').length,preparations);
   if(role==='parent'){assert.equal(call.studentId,undefined);assert.equal(call.targetConfirmed,false);}else assert.equal(call.studentId,studentId);
   assert.equal(await page.evaluate(()=>window.microphoneCalls),1);assert.deepEqual(state.errors,[]);
   console.log(`PASS ${role}/${language}: prepared before click, no early microphone, handle reused with current scope and protocol.`);
  }finally{await page.close();}
 }}catch(error){for(const context of browser.contexts())for(const page of context.pages())console.error('Browser page:',page.url(),(await page.locator('body').innerText()).slice(0,1800));throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
