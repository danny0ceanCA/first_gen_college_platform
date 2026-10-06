async page => {
 const research=[],starts=[];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  let json={ok:true};
  if(path==='/api/profile-voice'){starts.push(body);json={sdp:'v=0\r\n',playWelcome:false};}
  if(path==='/api/finance-research'){research.push(body);json={text:'La ayuda financiera puede ayudar a pagar la universidad.',sources:[{title:'Federal Student Aid',url:'https://studentaid.gov/',checkedAt:new Date().toISOString()}],checkedAt:new Date().toISOString()};}
  if(path==='/api/conversation-summary')json={summary:'La familia preguntó cómo pagar la universidad.'};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
 });
 await page.addInitScript(()=>{
  window.voiceTest={events:[],peers:0,channels:[]};
  const track={enabled:true,stop(){}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>stream});
  window.RTCPeerConnection=class {
   constructor(){window.voiceTest.peers++;}
   addTrack(){}
   createDataChannel(){const dc={readyState:'connecting',send(raw){const event=JSON.parse(raw);window.voiceTest.events.push(event);if(event.type==='session.update')queueMicrotask(()=>dc.emit({type:'session.updated',session:event.session}));},close(){this.readyState='closed';},emit(event){this.onmessage?.({data:JSON.stringify(event)});}};this.dc=dc;window.voiceTest.channels.push(dc);return dc;}
   async createOffer(){return {type:'offer',sdp:'v=0\r\n'};}
   async setLocalDescription(){}
   async setRemoteDescription(){queueMicrotask(()=>{this.dc.readyState='open';this.dc.emit({type:'session.created',session:{instructions:'Speak English. Profile context.'}});this.dc.onopen?.();});}
   close(){}
  };
 });
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('origen.onboarding.preview.v1',JSON.stringify({version:1,at:Date.now(),value:{name:'Robin',role:'parent',step:'voice',draft:{id:'save-test-leo',name:'Leo',stage:'',interest:'',gpa:'',color:'lilac'}}})));
 await page.reload();
 await page.getByRole('button',{name:'Start live conversation',exact:true}).click();
 await page.waitForFunction(()=>window.voiceTest.events.some(e=>e.type==='response.create'));
 const save=page.getByRole('button',{name:'Save profile',exact:true});
 if(!await save.isEnabled())throw new Error('Live save disabled');
 await save.click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('camino.students.v1')||'[]').some(s=>s.id==='save-test-leo'));
 if(!page.url().endsWith('#welcome'))throw new Error('Live save left onboarding');
 await page.getByRole('button',{name:'End conversation',exact:true}).waitFor();
 await page.evaluate(()=>window.voiceTest.channels[0].emit({type:'response.done',response:{status:'completed',output:[{type:'function_call',name:'save_onboarding_profile',call_id:'save-spoken',arguments:JSON.stringify({requested_by_user:true})},{type:'function_call',name:'propose_profile',call_id:'draft',arguments:JSON.stringify({changes:[{field:'name',value:'Leo Updated'},{field:'school',value:'Central High School'},{field:'goals',value:'Explore engineering'},{field:'activities',value:'Works evenings'},{field:'needs',value:'Evening classes'},{field:'institutions',value:'Local community college'},{field:'notes',value:'Parent is exploring pathways together with Leo.'}]})},{type:'function_call',name:'propose_account',call_id:'account',arguments:JSON.stringify({firstName:'Robin Updated',role:'parent'})}]}}));
 await page.waitForFunction(()=>window.voiceTest.events.some(e=>e.item?.call_id==='save-spoken'));
 const result=await page.evaluate(()=>({saved:JSON.parse(window.voiceTest.events.find(e=>e.item?.call_id==='save-spoken').item.output).status,student:JSON.parse(localStorage.getItem('camino.students.v1')).find(s=>s.id==='save-test-leo'),account:JSON.parse(localStorage.getItem('origen.account-preview.v1')),peers:window.voiceTest.peers}));
 if(result.saved!=='saved'||result.student.name!=='Leo Updated'||result.account.firstName!=='Robin Updated'||result.peers!==1)throw new Error(JSON.stringify(result));
 await page.waitForFunction(()=>{const s=document.querySelector('.welcome-story');return s.scrollTop>=s.scrollHeight-s.clientHeight-2;});
 const text=await page.locator('body').innerText();
 for(const removed of ['A LITTLE ABOUT YOU','Just talk. Your profile takes shape','AI-generated voice','End the conversation when'])if(text.includes(removed))throw new Error('Removed copy still appears: '+removed);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'output/playwright/onboarding-live-save-mobile.png'});
 const mobile=await save.boundingBox();if(!mobile||mobile.y+mobile.height>844)throw new Error('Save button off mobile screen');
 await page.setViewportSize({width:890,height:652});
 await page.screenshot({path:'output/playwright/onboarding-live-save-desktop.png'});
 return {status:result.saved,latestStudent:result.student.name,latestAccount:result.account.firstName,audioConnections:result.peers,autoScroll:true,mobileSaveVisible:true};
}