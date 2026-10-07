// Shared by the editor, public React pages and the server-rendered sharing pages.
export const audiences=['first-year','transfer','adult','family'];
export const translatedFields=['name','intro','description','programs','admissions','financialAid','events'];
export function safeInstitutionURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}}
export function localizedInstitution(page,language='en'){
 const translation=language==='es'?page.translations?.es:undefined;const missing=[];
 const text=(key,original)=>{if(language==='es'&&original?.trim()&&!translation?.[key]?.trim()){missing.push(key);return original;}return translation?.[key]?.trim()||original||'';};
 const localized={...page};for(const key of translatedFields)localized[key]=text(key,page[key]);
 localized.links=(page.links||[]).map((link,index)=>({...link,title:language==='es'?(translation?.linkTitles?.[index]?.trim()||link.title):link.title}));
 if(language==='es'&&(page.links||[]).some((link,index)=>link.title&&!translation?.linkTitles?.[index]?.trim()))missing.push('links');
 const record=item=>{const copy={...item};for(const key of ['title','description','eligibility','location'])if(item[key]){if(language==='es'&&!item.translations?.es?.[key]?.trim())missing.push(item.id+':'+key);copy[key]=language==='es'?(item.translations?.es?.[key]?.trim()||item[key]):item[key];}return copy;};
 localized.content={version:1,offerings:(page.content?.offerings||[]).map(record),events:(page.content?.events||[]).map(record)};
 return {page:localized,missing};
}
export function upcomingInstitutionEvents(events=[],now=Date.now()){
 return events.filter(event=>Number.isFinite(Date.parse(event.startsAt))&&Number.isFinite(Date.parse(event.endsAt))&&Date.parse(event.endsAt)>now).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
}
export function institutionEventDate(event,language='en'){
 try{return new Intl.DateTimeFormat(language==='es'?'es-US':'en-US',{dateStyle:'medium',timeStyle:'short',timeZone:event.timeZone}).format(new Date(event.startsAt));}catch{return event.startsAt;}
}
