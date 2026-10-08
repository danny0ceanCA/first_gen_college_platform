export function appendConversationTurn(turns,turn){return [...turns,turn].slice(-400);}
export function mergeConversationSources(previous,incoming){
 const sources=new Map(previous.map(source=>[source.url,source]));
 for(const source of incoming)sources.set(source.url,source);
 return [...sources.values()].slice(-30);
}
export function selectConversationMemory(items,mode){
 const ordered=[...items].filter(item=>item&&Number.isFinite(Date.parse(item.date))).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||String(b.id||'').localeCompare(String(a.id||'')));
 const unique=ordered.filter((item,index)=>ordered.findIndex(other=>item.id?other.id===item.id:other.date===item.date&&other.summary===item.summary)===index);
 const chosen=new Set(unique.slice(0,2));
 if(mode){
  unique.filter(item=>item.mode===mode&&!chosen.has(item)).slice(0,3).forEach(item=>chosen.add(item));
  const other=unique.find(item=>item.mode!==mode&&!chosen.has(item));if(other&&chosen.size<6)chosen.add(other);
 }
 for(const item of unique){if(chosen.size>=6)break;chosen.add(item);}
 return [...chosen].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||String(a.id||'').localeCompare(String(b.id||'')));
}
export function recentConversationMemory(items,studentId,mode){
 return selectConversationMemory(items.filter(item=>item.studentId===studentId),mode);
}
