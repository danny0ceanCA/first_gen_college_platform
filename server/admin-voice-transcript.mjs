// Administrator test opt-in only. Never capture backend reasoning, tool output,
// audio bytes, or teaching interviews through this persisted test feature.
export function createTestTranscript(enabled){
 let capturing=enabled===true,limited=false,items=[];const seen=new Set();
 return {
  event(e){
   if(!capturing||limited)return;
   let role,text,key;
   if(e.type==='session.input_transcript.delta'){role='user';text=e.delta;}
   if(['session.output_transcript.delta','response.output_audio_transcript.delta'].includes(e.type)){role='assistant';text=e.delta;}
   if(e.type==='conversation.item.input_audio_transcription.completed'){role='user';text=e.transcript;key=e.item_id;}
   if(!role||typeof text!=='string'||!text||key&&seen.has(key))return;
   if(key)seen.add(key);
   const last=items.at(-1),merge=last?.role===role;
   const next={role,text:merge?last.text+text:text,at:merge?last.at:new Date().toISOString()};
   const candidate=merge?[...items.slice(0,-1),next]:[...items,next];
   if(Buffer.byteLength(JSON.stringify(candidate))>60000){limited=true;return;}
   items=candidate;
  },
  clear(){capturing=false;items=[];seen.clear();limited=false;},
  snapshot(){return capturing?{items,limited,source:'provider_transcription'}:null;},
 };
}
