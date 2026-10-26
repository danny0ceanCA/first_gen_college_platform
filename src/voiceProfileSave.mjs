export function explicitProfileSaveRequest(text){
 const value=String(text||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 if(/\b(?:don['’]?t|do not|never|not ready to)\s+(?:\w+\s+){0,3}sav(?:e|ing)\b|\b(?:no (?:quiero (?:que )?|debes |puedes )?|sin )guard\w*\b|\b(?:save|guard\w*)\b[^.!?;]*(?:not yet|todavia no|aun no)/.test(value))return false;
 if(/\b(?:not yet|todavia no|aun no)\b/.test(value))return false;
 if(/\b(?:how|when|where|what happens|como|cuando|donde|que pasa|if|si acaso)\b/.test(value)||/["“”]/.test(value))return false;
 return /\b(?:save (?:my |the |this |our |his |her |their )?(?:profile|student|details|changes)|save it|save now|go ahead and save|guarda(?:r)? (?:mi |el |este |nuestro |su |los )?(?:perfil|estudiante|datos|cambios)|guardalo|guardarlo|guardar ahora)\b/.test(value);
}

export function voiceProfileSaveConsent(){
 let sequence=0,itemId,consent=false;
 return {
  begin(id){if(id!==itemId){itemId=id;sequence++;}consent=false;},
  transcript(id,text){if(itemId&&id!==itemId)return false;if(!itemId){itemId=id;sequence++;}consent=explicitProfileSaveRequest(text);return true;},
  token:()=>String(sequence),
  consume(token){if(token!==String(sequence))return false;const accepted=consent;consent=false;return accepted;},
  clear(){sequence++;consent=false;},
 };
}

// Run after draft tools so a save includes details proposed in the same response.
// Consent is supplied by the current user transcript, not a model assertion.
export async function voiceProfileSaveTools(output,save,send,isCurrent=()=>true,hasConsent=()=>false){
 let pending,count=0;
 for(const item of output){
  if(item.type!=='function_call'||item.name!=='save_onboarding_profile')continue;
  if(!isCurrent())return count;
  count++;let result={status:'save_not_requested',instruction:'No explicit save request was heard in the current turn. Keep the draft unsaved. Ask them to say save my profile or guarda mi perfil when ready; no form is required.'};
  try{
   const args=JSON.parse(item.arguments);
   if(args?.requested_by_user===true&&(pending||hasConsent())){
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
