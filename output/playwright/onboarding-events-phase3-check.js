async page => {
 const origin='http://127.0.0.1:5178',batches=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const family={account:{firstName:'',email:'',welcomeHeard:false,usedVoice:false},students:[]};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();let json={ok:true};
  if(path==='/api/onboarding-events')batches.push(body);
  if(path==='/api/family'){
   if(body.action==='complete-onboarding'){family.account=body.account;family.students=body.student?[body.student]:[];}
   json=family;
  }
  if(path==='/api/profile-voice')json=body.action==='update-guide'?{session:{type:'realtime',instructions:'Continue planning in English.',tools:[]}}:{sdp:'v=0\r\n',playWelcome:true};
  if(path==='/api/conversation-history')json={items:[]};
  if(path==='/api/conversation-overview')json={summary:'',sources:[],date:null};
  if(path==='/api/conversation-summary')json={summary:'Synthetic summary.'};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
 });
 await page.addInitScript(()=>{
  const subject='auth0|onboarding-phase3';
  localStorage.setItem(`origen.onboarding.${subject}.v1`,JSON.stringify({version:1,at:Date.now(),value:{name:'Private Avery',role:'student',step:'voice',draft:{id:'phase3-student',name:'Private Avery',stage:'Community college',school:'Private school',interest:'',gpa:'',color:'lilac'}}}));
  const voice=window.__phase3Voice={sent:[],pcs:[],blocked:true};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>new MediaStream()}});
  HTMLMediaElement.prototype.play=function(){if(voice.blocked){voice.blocked=false;return Promise.reject(new DOMException('Synthetic autoplay denial','NotAllowedError'));}Object.defineProperty(this,'paused',{configurable:true,value:false});this.dispatchEvent(new Event('playing'));return Promise.resolve();};
  window.RTCPeerConnection=class {
   constructor(){this.connectionState='new';voice.pcs.push(this);}
   addTrack(){}createOffer(){return Promise.resolve({type:'offer',sdp:'v=0\r\n'});}setLocalDescription(){return Promise.resolve();}
   createDataChannel(){const dc=this.dc={readyState:'connecting',send:raw=>{const event=JSON.parse(raw);voice.sent.push(event);if(event.type==='session.update')queueMicrotask(()=>voice.emit({type:'session.updated',session:event.session}));},close:()=>{dc.readyState='closed';}};voice.emit=event=>Promise.resolve(dc.onmessage?.({data:JSON.stringify(event)}));return dc;}
   setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.ontrack?.({streams:[new MediaStream()]});this.dc.readyState='open';this.dc.onopen?.();queueMicrotask(()=>voice.emit({type:'session.created',session:{instructions:'Onboarding in English.'}}));return Promise.resolve();}
   close(){this.closed=true;this.connectionState='closed';}
  };
 });
 const source=await(await page.request.get(origin+'/src/App.tsx')).text(),authModule=source.match(/\/node_modules\/\.vite\/deps\/@auth0_auth0-react\.js\?v=[a-z0-9]+/)[0];
 await page.route('**/phase3-test-harness',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="test-root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import {Auth0Context} from '${authModule}';import App from '/src/App.tsx';import {setAPITokenProvider} from '/src/api.ts';import '/src/styles.css';import '/src/brand.css';
 const subject='auth0|onboarding-phase3',token='test.'+btoa(JSON.stringify({sub:subject}))+'.test',getToken=async()=>token;setAPITokenProvider(getToken);
 const auth={isAuthenticated:true,isLoading:false,user:{sub:subject},getAccessTokenSilently:getToken,logout:async()=>{}};
 ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(Auth0Context.Provider,{value:auth},React.createElement(App)));
 </script></body></html>`}));
 await page.goto(origin+'/phase3-test-harness');await page.getByRole('button',{name:'Start live conversation',exact:true}).click();
 await page.getByText('Tap Play to hear Origen',{exact:false}).waitFor();
 await page.evaluate(async()=>{const v=window.__phase3Voice;await v.emit({type:'response.created',response:{id:'opening'}});await v.emit({type:'output_audio_buffer.started',response_id:'opening'});});
 await page.waitForTimeout(400);
 if(batches.flatMap(b=>b.events).some(e=>e.name==='first_agent_audio'))throw new Error('Blocked playback counted as first audio');
 await page.locator('audio').evaluate(audio=>audio.play());
 await page.evaluate(async()=>{const v=window.__phase3Voice;window.__phase3Audio=document.querySelector('audio');await v.emit({type:'input_audio_buffer.speech_started',item_id:'speech1'});await v.emit({type:'input_audio_buffer.speech_stopped',item_id:'speech1'});await v.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'speech1',transcript:'Please save my profile. Private spoken words.'});await v.emit({type:'response.done',response:{id:'opening',status:'cancelled',output:[]}});await v.emit({type:'output_audio_buffer.cleared',response_id:'opening'});});
 await page.getByRole('button',{name:'Mute microphone',exact:true}).click();await page.getByRole('button',{name:'Unmute microphone',exact:true}).click();
 const save=async()=>page.evaluate(async()=>{const v=window.__phase3Voice;await v.emit({type:'response.created',response:{id:'save-tool'}});await v.emit({type:'response.done',response:{id:'save-tool',status:'completed',output:[{type:'function_call',name:'save_onboarding_profile',call_id:'save',arguments:'{"requested_by_user":true}'}]}});});
 await save();
 await page.evaluate(async()=>{const v=window.__phase3Voice;await v.emit({type:'response.created',response:{id:'confirmation'}});await v.emit({type:'output_audio_buffer.started',response_id:'confirmation'});await v.emit({type:'response.done',response:{id:'confirmation',status:'completed',output:[]}});});
 if(await page.locator('.app-shell').count())throw new Error('Navigated before confirmation audio drain');
 await page.evaluate(()=>window.__phase3Voice.emit({type:'output_audio_buffer.stopped',response_id:'confirmation'}));
 await page.locator('.app-shell').waitFor();
 await page.waitForFunction(()=>window.__phase3Voice.sent.filter(e=>e.type==='response.create').length>=4);
 if(!await page.evaluate(()=>window.__phase3Voice.pcs.length===1&&!window.__phase3Voice.pcs[0].closed&&document.querySelector('audio')===window.__phase3Audio))throw new Error('Home transition replaced the voice transport or audio element');
 await page.evaluate(async()=>{const v=window.__phase3Voice;await v.emit({type:'response.created',response:{id:'intro'}});await v.emit({type:'output_audio_buffer.started',response_id:'intro'});await v.emit({type:'response.done',response:{id:'intro',status:'completed',output:[]}});await v.emit({type:'output_audio_buffer.stopped',response_id:'intro'});});
 await page.waitForTimeout(700);
 const first=batches.flatMap(b=>b.events),required=['audio_playback_blocked','audio_playback_resumed','first_agent_audio','first_user_speech','user_speech_started','user_speech_stopped','user_speech_transcription','speech_during_agent_audio','agent_audio_cleared','agent_response_finished','microphone_muted','microphone_unmuted','save_confirmation_waiting','save_confirmation_started','save_confirmation_audio_started','save_confirmation_finished','home_guide_update_started','home_guide_update_finished','home_transition_started','home_transition_open_requested','home_reached','home_transition_finished','home_introduction_requested','home_introduction_started','home_introduction_finished'];
 for(const name of required)if(!first.some(e=>e.name===name))throw new Error('Missing '+name);
 const played=first.find(e=>e.name==='save_confirmation_finished');if(played.metadata.playbackReady!==true)throw new Error('Playback readiness missing');
 if(!first.find(e=>e.name==='home_transition_finished').metadata.durationMs)throw new Error('Transition duration missing');
 if(new Set(batches.map(b=>b.attemptId)).size!==1)throw new Error('Handoff split the onboarding attempt');
 if(/Private Avery|Private school|Private spoken words|"response_id"|"transcript"/.test(JSON.stringify(batches)))throw new Error('Content leaked to onboarding events');
 await page.screenshot({path:'output/playwright/onboarding-phase3-home.png'});
 // A saved profile followed by explicit hangup is a skipped confirmation, not played audio.
 const before=batches.length;family.account={firstName:'',email:'',welcomeHeard:false,usedVoice:false};family.students=[];
 await page.goto(origin+'/phase3-test-harness');await page.getByRole('button',{name:'Start live conversation',exact:true}).click();await page.getByRole('button',{name:'End conversation',exact:true}).waitFor();
 await save();await page.evaluate(async()=>{const v=window.__phase3Voice;await v.emit({type:'response.created',response:{id:'waiting'}});await v.emit({type:'response.done',response:{id:'waiting',status:'cancelled',output:[]}});});
 await page.getByRole('button',{name:'End conversation',exact:true}).click();await page.locator('.app-shell').waitFor();await page.waitForTimeout(700);
 const second=batches.slice(before).flatMap(b=>b.events);if(!second.some(e=>e.name==='save_confirmation_skipped'&&e.metadata.reason==='user_end'))throw new Error('Hangup not distinguished from played confirmation');
 if(second.some(e=>e.name==='save_confirmation_finished'))throw new Error('Hangup falsely recorded drained confirmation');
 if(errors.length)throw new Error('Browser runtime errors: '+errors.join('; '));
 return {passed:true,checks:required.length,homeRetainedSameVoice:true,hangupNotClaimedAsPlayed:true,privateContentExcluded:true};
}
