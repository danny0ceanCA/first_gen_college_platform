async page=>{
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 await page.getByRole('button',{name:'Talk with Origen',exact:true}).first().click();
 await page.waitForFunction(()=>window.voiceFixture.connections===1);await page.waitForTimeout(200);
 await page.evaluate(()=>window.voiceEmit({type:'response.done',response:{id:'confirm-target',status:'completed',output:[{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:JSON.stringify({scope:'student:synthetic-sofia'})}]}}));
 await page.waitForFunction(()=>window.voiceFixture.messages.some(e=>e.item?.call_id==='target'&&JSON.parse(e.item.output).status==='target_confirmed'));await page.waitForTimeout(150);
 let stall=true,pendingRequest=false;
 await page.route('**/api/profile-voice',async route=>{
  if(stall&&route.request().postDataJSON().action==='update-guide'){pendingRequest=true;return new Promise(()=>{});}
  return route.fallback();
 });
 await page.evaluate(()=>window.voiceEmit({type:'response.done',response:{id:'change-topic',status:'completed',output:[{type:'function_call',name:'switch_college_guide',call_id:'switch-topic',arguments:JSON.stringify({guide:'finance'})}]}}));
 await page.waitForTimeout(150);
 const before=await page.evaluate(()=>window.voiceFixture.messages.length);
 await page.evaluate(()=>{
  window.voiceEmit({type:'input_audio_buffer.speech_started',item_id:'new-question'});
  window.voiceEmit({type:'input_audio_buffer.speech_stopped',item_id:'new-question'});
  window.voiceEmit({type:'conversation.item.input_audio_transcription.completed',item_id:'new-question',transcript:'I have another question about my classes.'});
 });
 await page.waitForFunction(()=>window.voiceFixture.messages.some(e=>e.item?.call_id==='switch-topic'&&JSON.parse(e.item.output).status==='continue_current_guide'),{},{timeout:14000});
 await page.waitForFunction(before=>window.voiceFixture.messages.slice(before).some(e=>e.type==='response.create'),before);
 assert(pendingRequest,'Missing fault injection');
 assert(await page.evaluate(()=>window.voiceFixture.connections===1&&window.voiceFixture.closed===0),'Timeout disconnected audio');
 stall=false;await page.waitForTimeout(150);
 await page.evaluate(()=>window.voiceEmit({type:'response.done',response:{id:'retry-topic',status:'completed',output:[{type:'function_call',name:'switch_college_guide',call_id:'retry-topic',arguments:JSON.stringify({guide:'finance'})}]}}));
 await page.waitForFunction(()=>window.voiceFixture.messages.some(e=>e.item?.call_id==='retry-topic'&&JSON.parse(e.item.output).status==='guide_updated'));
 assert(await page.evaluate(()=>window.voiceFixture.connections===1&&window.voiceFixture.closed===0),'Retry recreated audio');
 return {passed:true,httpTimeoutRecovers:true,newQuestionReceivesReply:true,topicRetrySucceeds:true,connections:1,closed:0};
}
