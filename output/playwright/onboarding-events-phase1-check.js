async page => {
 page.on('dialog',dialog=>dialog.accept());
 const batches=[],saves=[],hostCompletions=[];let rejectSave=true,trackingUnavailable=false;
 const family={account:{firstName:'',email:'',welcomeHeard:false,usedVoice:false},students:[]};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const body=route.request().postDataJSON();let status=200,json={ok:true};
  if(path==='/api/onboarding-events'){batches.push(body);if(trackingUnavailable)status=503;}
  if(path==='/api/family'){
   if(body.action==='complete-onboarding'){
    saves.push(body);if(rejectSave){status=503;json={error:'database_unavailable'};}
    else{family.account=body.account;family.students=body.student?[body.student]:[];json=family;}
   }else json=family;
  }
  if(path==='/api/phase1-test-host'){hostCompletions.push(body);}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
 });
 await page.addInitScript(()=>{
  const subject='auth0|onboarding-phase1';
  const token='test.'+btoa(JSON.stringify({sub:subject}))+'.test';
  window.ReactNativeWebView={postMessage:raw=>{
   const message=JSON.parse(raw);let value;
   if(message.type==='ready')value={subject,firstName:'',language:'en'};
   if(message.type==='token')value=token;
   if(message.type==='complete'){void fetch('/api/phase1-test-host',{method:'POST',body:JSON.stringify(message.payload)});value=true;}
   if(message.type!=='closed')queueMicrotask(()=>window.origenNativeReply?.({id:message.id,value}));
  }};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new DOMException('synthetic denial','NotAllowedError');}}});
  localStorage.setItem(`origen.onboarding.${subject}.v1`,JSON.stringify({version:1,at:Date.now(),value:{name:'Morgan',role:'student',step:'voice',draft:{id:'phase1-student',name:'Morgan',stage:'Community college',school:'Private test school',interest:'',gpa:'',color:'lilac'}}}));
 });
 await page.goto('http://127.0.0.1:5178/#native-welcome');await page.reload();
 await page.getByRole('button',{name:'Start live conversation',exact:true}).waitFor();
 await page.getByRole('button',{name:'Start live conversation',exact:true}).click();
 await page.getByText('Microphone access was not allowed.',{exact:false}).waitFor({state:'attached'});
 await page.getByRole('button',{name:'Edit details',exact:true}).click();
 const save=page.getByRole('button',{name:'Save profile',exact:true});await save.click();
 await page.getByText('Could not save. Your details are still here.',{exact:false}).waitFor();
 await page.waitForTimeout(700);
 const before=batches.flatMap(body=>body.events);
 for(const name of ['onboarding_opened','fields_updated','voice_button_pressed','voice_start_requested','microphone_denied','voice_connection_failed','voice_ended','save_requested','save_failed'])if(!before.some(event=>event.name===name))throw new Error('Missing '+name);
 if(before.some(event=>event.name==='voice_connected'))throw new Error('Denied microphone was marked connected');
 rejectSave=false;trackingUnavailable=true;await save.click();
 await page.waitForFunction(()=>document.body.innerText.includes('Profile saved.')||!document.body.innerText.includes('Could not save. Your details are still here.'));
 await page.waitForTimeout(700);
 if(hostCompletions.length!==1)throw new Error('Tracking failure interrupted saving');
 for(const name of ['native_handoff_requested','native_handoff_acknowledged'])if(!batches.flatMap(body=>body.events).some(event=>event.name===name))throw new Error('Native handoff not captured: '+name);
 if(saves.length!==2||!saves.every(body=>body.onboardingAttemptId===batches[0].attemptId))throw new Error('Save attempt attribution failed');
 if(new Set(batches.map(body=>body.attemptId)).size!==1)throw new Error('Attempt changed between voice and manual');
 if(/Morgan|Private test school/.test(JSON.stringify(batches)))throw new Error('Private answers in events');
 // Mount the real web app under a synthetic Auth0 context to verify home rendering.
 family.account={firstName:'',email:'',welcomeHeard:false,usedVoice:false};family.students=[];trackingUnavailable=false;
 const appSource=await (await page.request.get('http://127.0.0.1:5178/src/App.tsx')).text();
 const authModule=appSource.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/phase1-test-harness',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';
 import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
 import {Auth0Context} from '${authModule}';
 import App from '/src/App.tsx';
 import {setAPITokenProvider} from '/src/api.ts';
 const token='test.'+btoa(JSON.stringify({sub:'auth0|onboarding-phase1'}))+'.test';
 const getToken=async()=>token;setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:'auth0|onboarding-phase1'},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(App)));
 </script></body></html>`}));
 await page.goto('http://127.0.0.1:5178/phase1-test-harness');
 await page.getByRole('button',{name:'Edit details',exact:true}).click();
 await page.getByRole('button',{name:'Save profile',exact:true}).click();
 await page.locator('.app-shell').waitFor();await page.waitForTimeout(700);
 if(!batches.flatMap(body=>body.events).some(event=>event.name==='home_reached'))throw new Error('Web home arrival not captured');
 return {webHomeArrivalCaptured:true,microphoneDenialCaptured:true,failedSaveCaptured:true,retrySavedDespiteTrackingFailure:true,oneAttemptAcrossMethods:true,profileAnswersExcluded:true,eventNames:[...new Set(batches.flatMap(body=>body.events.map(event=>event.name)))]};
}
