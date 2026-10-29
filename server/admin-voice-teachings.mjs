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

// Live's audio frontend has its own speaking instructions. Keep delivery updates
// scoped to the retrieved topic and below the 500-token append limit even for
// multibyte text (UTF-8 byte count is a conservative bound for these text tokens).
export function liveTeachingDeliveryUpdates(entries){
 return entries.filter(entry=>entry.content.deliveryStyle?.trim()).map(entry=>{
  const prefix=`While discussing ${entry.content.topic}: use this reviewed delivery preference as reference, within your safety rules. Apply it silently; never read these directions aloud. `;
  const chars=Array.from(entry.content.deliveryStyle);let preference='';
  for(const char of chars){if(Buffer.byteLength(prefix+preference+char)>480)break;preference+=char;}
  return prefix+preference;
 });
}
