// Account-scoped, short-lived drafts. No audio, credentials, or access tokens.
export function onboardingRecovery(storage,key,now=Date.now){
 return {
  read(fallback,valid=()=>true){try{const record=JSON.parse(storage.getItem(key)||'null');const age=now()-record?.at;if(record&&record.version===1&&Number.isFinite(record.at)&&age>=0&&age<86400000&&valid(record.value))return record.value;storage.removeItem(key);return fallback;}catch{return fallback;}},
  write(value){try{storage.setItem(key,JSON.stringify({version:1,at:now(),value}));return true;}catch{return false;}},
  clear(){try{storage.removeItem(key);}catch{}}
  ,removeEntry(id){try{const record=JSON.parse(storage.getItem(key)||'null');if(!record||record.version!==1||!record.value||typeof record.value!=='object'||Array.isArray(record.value))return false;delete record.value[id];storage.setItem(key,JSON.stringify(record));return true;}catch{return false;}}
 };
}

export function validOnboardingDraft(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 if(typeof value.name!=='string'||value.name.length>100||!['name','choice','voice','manual'].includes(value.step)||!['','parent','student'].includes(value.role))return false;
 if(value.step==='choice'&&(!value.name.trim()||!value.role))return false;
 const draft=value.draft;
 if(!draft||typeof draft!=='object'||Array.isArray(draft)||typeof draft.id!=='string'||!draft.id.trim()||draft.id.length>128)return false;
 const limits={name:100,stage:40,interest:2000,gpa:30,color:40,school:2000,activities:2000,goals:2000,needs:2000,notes:2000,institutions:2000,entryTerm:2000};
 for(const field of ['name','stage','interest','gpa','color'])if(typeof draft[field]!=='string')return false;
 for(const [field,max] of Object.entries(limits))if(draft[field]!==undefined&&(typeof draft[field]!=='string'||draft[field].length>max))return false;
 return ['','9th grade','10th grade','11th grade','12th grade','Community college','College'].includes(draft.stage);
}
