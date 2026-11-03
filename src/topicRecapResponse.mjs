// Validate the response before React sees it. A bad or incompatible response
// must leave the original binder usable rather than crash its render tree.
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function isTopicRecapResponse(value){
 if(!record(value)||!Array.isArray(value.paragraphs)||value.paragraphs.length>3||!Array.isArray(value.sources)||value.sources.length>60||!Number.isSafeInteger(value.omitted)||value.omitted<0)return false;
 const refs=new Set();
 for(const source of value.sources){
  if(!record(source)||!['note','memory'].includes(source.kind)||!text(source.id,128)||source.ref!==`${source.kind}:${source.id}`||refs.has(source.ref)||!text(source.content,5000)||!record(source.evidence)||!['student','parent','family','coordinator','unknown'].includes(source.evidence.reportedBy))return false;
  refs.add(source.ref);
 }
 const used=new Set();
 for(const paragraph of value.paragraphs){
  if(!record(paragraph)||!text(paragraph.text,1800)||!Array.isArray(paragraph.refs)||!paragraph.refs.length||paragraph.refs.length>20||paragraph.refs.some(ref=>!refs.has(ref)))return false;
  for(const ref of paragraph.refs)used.add(ref);
 }
 return used.size===refs.size&&value.paragraphs.map(p=>p.text).join(' ').split(/\s+/u).length<=260;
}
