export function appendConversationTurn(turns,turn){return [...turns,turn].slice(-400);}
export function mergeConversationSources(previous,incoming){
 const sources=new Map(previous.map(source=>[source.url,source]));
 for(const source of incoming)sources.set(source.url,source);
 return [...sources.values()].slice(-30);
}
export function recentConversationMemory(items,studentId){
 return items.filter(item=>item.studentId===studentId).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,6).reverse();
}
