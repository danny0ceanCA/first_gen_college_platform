// Run after draft tools so a save includes details proposed in the same response.
export async function voiceProfileSaveTools(output,save,send,isCurrent=()=>true){
 let pending,count=0;
 for(const item of output){
  if(item.type!=='function_call'||item.name!=='save_onboarding_profile')continue;
  count++;let result={status:'save_not_requested',instruction:'Save only when the user asks. Continue the conversation without another confirmation form.'};
  try{
   const args=JSON.parse(item.arguments);
   if(args?.requested_by_user===true){
    if(!save)result={status:'save_unavailable',instruction:'Saving is unavailable here. Do not claim that the profile was saved.'};
    else {
     // Duplicate tool calls in one response share a single acknowledged write.
     pending??=Promise.resolve().then(save);
     result=await pending;
     if(!result||!['saved','missing_details','save_failed','save_in_progress'].includes(result.status))throw new Error();
    }
   }
  }catch{result={status:'save_failed',instruction:'The profile could not be saved. Keep the conversation open and offer to retry. Do not claim a successful save.'};}
  if(!isCurrent())return count;
  send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result)}});
 }
 return count;
}
