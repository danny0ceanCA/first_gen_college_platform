async page=>{
 await page.evaluate(()=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(key==='camino.students.v1')throw new Error('Storage full');return original.call(this,key,value);};
  window.restoreTestStorage=()=>{Storage.prototype.setItem=original;};
  window.voiceTest.channels[0].emit({type:'response.done',response:{status:'completed',output:[{type:'function_call',name:'save_onboarding_profile',call_id:'save-failed',arguments:'{"requested_by_user":true}'}]}});
 });
 await page.waitForFunction(()=>window.voiceTest.events.some(e=>e.item?.call_id==='save-failed'));
 const failed=await page.evaluate(()=>JSON.parse(window.voiceTest.events.find(e=>e.item?.call_id==='save-failed').item.output).status);
 if(failed!=='save_failed')throw new Error('Failure falsely acknowledged');
 await page.getByRole('button',{name:'End conversation',exact:true}).waitFor();
 await page.evaluate(()=>{
  window.restoreTestStorage();
  window.voiceTest.channels[0].emit({type:'response.done',response:{status:'completed',output:[{type:'function_call',name:'set_conversation_language',call_id:'spanish',arguments:'{"language":"es"}'},{type:'function_call',name:'propose_account',call_id:'student-account',arguments:'{"firstName":"Leo Updated","role":"student"}'},{type:'function_call',name:'save_onboarding_profile',call_id:'save-retry',arguments:'{"requested_by_user":true}'}]}});
 });
 await page.waitForFunction(()=>window.voiceTest.events.some(e=>e.item?.call_id==='save-retry'));
 const retry=await page.evaluate(()=>JSON.parse(window.voiceTest.events.find(e=>e.item?.call_id==='save-retry').item.output).status);
 if(retry!=='saved')throw new Error('Retry failed');
 await page.getByRole('button',{name:'Guardar perfil',exact:true}).waitFor();
 await page.getByRole('button',{name:'Terminar conversación',exact:true}).waitFor();
 if(await page.evaluate(()=>window.voiceTest.peers)!==1)throw new Error('Storage failure or language switch interrupted audio');
 return {failure:failed,retry,languagePreservedAfterRoleChange:true,audioConnections:1};
}