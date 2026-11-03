import {binderMemoryEntries,binderMemorySummaryEntries} from './binderMemory.mjs';

const categories=['goal','constraint','preference','question'];
const normalized=text=>text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
const tokens=text=>new Set(normalized(text).match(/[\p{L}\p{N}]+/gu)||[]);
const administrative=/^(the discussion focused|this conversation|we discussed|his binder|her binder|la conversación se centró|esta conversación|hablamos de)/iu;

// A bounded, extractive overview. It selects original details, not a new
// account of the student's plans. Similar wording is never merged or deleted.
export function memoryOverview(memories,{studentId,topic}){
 const scoped=topic?binderMemoryEntries(memories,studentId,topic):binderMemorySummaryEntries(memories,studentId);
 let remaining=4;
 const groups=categories.map(category=>{
  const entries=scoped.filter(m=>m.category===category&&m.content.trim());
  const seen=new Set();
  const candidates=[...entries].sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)).filter(m=>{
   const key=JSON.stringify([normalized(m.content),m.language,m.status,m.speaker,m.reportedBy,m.organization?.certainty]);
   if(seen.has(key))return false;seen.add(key);return true;
  }).map((entry,index)=>({entry,index,words:tokens(entry.content)}));
  const selected=[];
  while(candidates.length&&selected.length<2){
   const score=c=>(c.entry.content.length<=220?1:0)-(administrative.test(c.entry.content)?2:0)-selected.reduce((max,s)=>Math.max(max,[...c.words].filter(w=>s.words.has(w)).length/Math.max(c.words.size,s.words.size,1)),0)*3;
   candidates.sort((a,b)=>score(b)-score(a)||a.index-b.index);
   selected.push(candidates.shift());
  }
  return {category,count:entries.length,entries:selected.map(c=>c.entry)};
 }).filter(group=>group.count);
 // Every populated category gets a place before any receives a second line.
 for(const group of groups){group.highlights=group.entries.slice(0,1);remaining--;}
 for(const group of groups)if(remaining>0&&group.entries.length>1){group.highlights.push(group.entries[1]);remaining--;}
 return groups.map(({entries,...group})=>group);
}

// Clearly marked excerpts always retain the beginning of the original text.
// No sentence fragments are spliced, reworded, or presented as a confirmed fact.
export function memoryExcerpt(content,maxLength=180){
 const text=content.trim().replace(/\s+/gu,' ');
 if(text.length<=maxLength)return {text,truncated:false};
 const prefix=text.slice(0,maxLength),space=prefix.lastIndexOf(' ');
 return {text:prefix.slice(0,space>maxLength*.6?space:maxLength).trimEnd()+'…',truncated:true};
}
