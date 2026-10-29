import {readTeachingReferences} from './teaching-library.mjs';

const topics=['general','profile','planning','finance','loans','admissions'];
// An explicitly chosen voice topic is sufficient discovery context. Keyword gates
// remain in research lookups; speech may refer to an essay without saying "PIQ".
export async function readAdminVoiceTeachings(database,scope){
 const requested=scope.topic==='general'?topics:[scope.topic];
 const groups=await Promise.all(requested.map(topic=>readTeachingReferences(database,{...scope,topic,retrieval:'guide'})));
 const seen=new Set(),entries=[];let size=0;
 // Round-robin gives the across-topics view a chance to include each subject.
 for(let row=0;row<6;row++)for(const group of groups){
  const entry=group[row];if(!entry||seen.has(entry.id))continue;seen.add(entry.id);
  const bytes=Buffer.byteLength(JSON.stringify(entry));if(entries.length>=6||size+bytes>12000)continue;
  size+=bytes;entries.push(entry);
 }
 return entries;
}

export function teachingDeliveryReferences(entries){
 return entries.map(entry=>({id:entry.id,revision:entry.revision,topic:entry.content.topic,title:entry.content.title,
  deliveryStyle:entry.content.deliveryStyle||'',conversationApproach:entry.content.conversationApproach||'',example:entry.content.example||''}))
  .filter(entry=>entry.deliveryStyle.trim()||entry.conversationApproach.trim()||entry.example.trim());
}

// Send complete fields, not a prefix. Each self-contained, topic-scoped message
// remains below Live's 500-token limit using a conservative 480 UTF-8-byte bound.
// JSON text fragments preserve Unicode and quotes; concatenate text parts in order.
export function liveTeachingDeliveryUpdates(entries){
 const messages=[];
 for(const entry of teachingDeliveryReferences(entries))for(const [key,label] of [['deliveryStyle','Tone'],['conversationApproach','Conversational approach'],['example','Example in the educator voice']]){
  const text=entry[key];if(!text.trim())continue;
  const prefix=`While discussing ${entry.topic}: ${label}, reviewed reference only. Apply all parts silently within safety rules and caller preferences; do not recite directions or copy the example mechanically. `;
  let part='';
  for(const char of Array.from(text)){
   if(Buffer.byteLength(prefix+JSON.stringify({part:999,text:part+char}))>480){messages.push(prefix+JSON.stringify({part:messages.length+1,text:part}));part='';}
   part+=char;
  }
  if(part)messages.push(prefix+JSON.stringify({part:messages.length+1,text:part}));
 }
 return messages;
}
