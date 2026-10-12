// Recaps stay distinct from personal notes, even when they contain the same words.
// Keep the latest exact repeat; never infer that similar advice is a user's decision.
export function distinctConversationPoints(notes){
 const seen=new Set();
 return notes.filter(note=>note.status==='suggested'&&note.origin==='conversation'&&note.summaryId)
  .sort((a,b)=>Date.parse(b.conversationAt||b.updatedAt)-Date.parse(a.conversationAt||a.updatedAt)||a.id.localeCompare(b.id))
  .filter(note=>{
   const key=JSON.stringify([note.topic,note.kind,note.language,note.content.trim().replace(/\s+/g,' ').toLocaleLowerCase()]);
   if(seen.has(key))return false;seen.add(key);return true;
  });
}
