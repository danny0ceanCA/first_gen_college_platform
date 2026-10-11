// Browser-only plans are proposals until explicitly reviewed and saved online.
export function legacyPlanBatches(value,studentId){
 const rows=value&&typeof value==='object'&&!Array.isArray(value)?value[studentId]:null;
 if(!Array.isArray(rows))return [];
 const steps=rows.filter(row=>row&&typeof row==='object'&&typeof row.title==='string').map((row,index)=>{
  let url;try{const parsed=new URL(row.source);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)url=parsed.href;}catch{}
  const date=typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&Number.isFinite(Date.parse(row.date))&&new Date(row.date).toISOString().slice(0,10)===row.date?row.date:null;
  return {id:`legacy-${index}`,title:row.title,action:typeof row.action==='string'?row.action:'',notes:[row.why,row.notes,row.deadline&&`Previous deadline text: ${row.deadline}`,row.source&&!url&&`Previous source text: ${row.source}`].filter(v=>typeof v==='string'&&v.trim()).join('\n\n'),status:['not-started','in-progress','complete'].includes(row.status)?row.status:'not-started',dueDate:date,sources:url?[{title:'Source from previous plan',url}]:[]};
 });
 const batches=[];for(let i=0;i<steps.length;i+=30)batches.push(steps.slice(i,i+30));return batches;
}
export async function legacyCreationId(subject,studentId,steps){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([subject,studentId,steps])));
 const h=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
