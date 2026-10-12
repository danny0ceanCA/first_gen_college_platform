async page=>{
 await page.getByRole('button',{name:'Talk with Origen',exact:true}).first().click();
 await page.waitForFunction(()=>window.voiceFixture.connections===1);
 await page.waitForTimeout(200);
 await page.evaluate(()=>window.voiceEmit({type:'response.done',response:{id:'confirm-target',status:'completed',output:[{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:JSON.stringify({scope:'student:synthetic-sofia'})}]}}));
 await page.waitForTimeout(300);
 let pendingRequest=false;
 await page.route('**/api/profile-voice',async route=>{
  if(route.request().postDataJSON().action==='update-guide'){pendingRequest=true;await new Promise(()=>{});}
  else await route.fallback();
 });
 await page.evaluate(()=>window.voiceEmit({type:'response.done',response:{id:'change-topic',status:'completed',output:[{type:'function_call',name:'switch_college_guide',call_id:'switch-topic',arguments:JSON.stringify({guide:'finance'})}]}}));
 await page.waitForTimeout(150);
 const before=await page.evaluate(()=>window.voiceFixture.messages.length);
 await page.evaluate(()=>{
  window.voiceEmit({type:'input_audio_buffer.speech_started',item_id:'new-question'});
  window.voiceEmit({type:'input_audio_buffer.speech_stopped',item_id:'new-question'});
  window.voiceEmit({type:'conversation.item.input_audio_transcription.completed',item_id:'new-question',transcript:'I have another question about my classes.'});
 });
 await page.waitForTimeout(12000);
 const events=await page.evaluate(before=>window.voiceFixture.messages.slice(before),before);
 return {bug:'stalled-topic-fetch-blocks-new-voice-replies',pendingRequest,waitedMs:12000,replies:events.filter(e=>e.type==='response.create').length,toolOutputs:events.filter(e=>e.type==='conversation.item.create'&&e.item?.type==='function_call_output').length,voice:await page.evaluate(()=>({connections:window.voiceFixture.connections,closed:window.voiceFixture.closed})),status:await page.locator('.voice-activity').innerText()};
}
