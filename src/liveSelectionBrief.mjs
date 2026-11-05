// One complete voice snapshot, never fragments of a dossier. Whole fields and
// qualified records only: truncation could remove a correction or attribution.
// UTF-8 bytes conservatively bound the Live append's 500-token limit.
export function liveSelectionBrief(context,mode){
 const scope=context?.scope||{},brief=context?.openingBrief;
 mode=['caller_first','leave_floor','conditional_recap'].includes(mode)?mode:'leave_floor';
 const snapshot={kind:'confirmed-student-brief',studentId:scope.studentId??null,mode,partial:true,profile:{}};
 const fits=value=>new TextEncoder().encode(JSON.stringify(value)).length<=480;
 if(!fits(snapshot))return null;
 if(!scope.confirmed||!brief||brief.studentId!==scope.studentId)return snapshot;
 if(scope.studentId===null)return snapshot;
 for(const key of ['name','goals','school','interest','stage','institutions','entryTerm']){
  const value=brief.profile?.[key];if(typeof value!=='string'||!value.trim())continue;
  const next={...snapshot,profile:{...snapshot.profile,[key]:value}};
  if(fits(next))snapshot.profile=next.profile;
 }
 for(const record of brief.records||[]){
  const next={...snapshot,record};
  if(fits(next)){snapshot.record=record;break;}
 }
 return snapshot;
}
