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
 await page.reload();
 await page.getByRole('button',{name:'Start live conversation',exact:true}).click();
 await page.waitForFunction(()=>window.voiceTest.events.some(e=>e.type==='response.create'));
 await page.evaluate(()=>{
  const dc=window.voiceTest.channels[0];
  dc.emit({type:'input_audio_buffer.speech_started',item_id:'spanish-input'});
  dc.emit({type:'input_audio_buffer.speech_stopped',item_id:'spanish-input'});
  dc.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'spanish-input',transcript:'¿Cómo puedo pagar la universidad?'});
  dc.emit({type:'response.done',response:{id:'switch-and-lookup',status:'completed',output:[{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:JSON.stringify({question:'How does financial aid work?',institution:'',language:'en'})},{type:'function_call',name:'set_conversation_language',call_id:'language',arguments:JSON.stringify({language:'es'})}]}});
 });
 await page.waitForFunction(()=>window.voiceTest.events.some(e=>e.item?.call_id==='lookup'));
 if(research.length!==1||research[0].language!=='es')throw new Error('Research followed stale English arguments');
 if(await page.evaluate(()=>window.voiceTest.peers)!==1)throw new Error('Language switch restarted audio');
 await page.getByRole('button',{name:'English',exact:true}).waitFor();
 await page.evaluate(()=>window.voiceTest.channels[0].emit({type:'response.done',response:{id:'finished',status:'completed',output:[]}}));
 await page.getByRole('button',{name:'Terminar conversación',exact:true}).click();
 await page.getByRole('button',{name:'Iniciar conversación en vivo',exact:true}).click();
 await page.waitForFunction(()=>window.voiceTest.peers===2);
 if(starts[1]?.language!=='es')throw new Error('Reconnect reverted to English');
 await page.evaluate(()=>window.voiceTest.channels[1].emit({type:'response.done',response:{id:'reconnect-done',status:'completed',output:[]}}));
 await page.getByRole('button',{name:'Terminar conversación',exact:true}).click();
 return {researchLanguage:research[0].language,firstSessionLanguage:starts[0].language,reconnectLanguage:starts[1].language};
}
