// References identify a private accepted action. They never confer authority.
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const invalid=()=>{throw Object.assign(Error('invalid_student_follow_up'),{status:400});};
export function validateFollowUpTarget(value){
 if(!object(value)||Object.keys(value).some(k=>!['planId','stepId'].includes(k))||!uuid(value.planId)||typeof value.stepId!=='string'||!value.stepId.trim()||value.stepId.length>128||/[\x00-\x1f\x7f]/.test(value.stepId))invalid();
 return {planId:value.planId.toLowerCase(),stepId:value.stepId};
}
export function validateFollowUpSchedule(value){
 if(!object(value)||Object.keys(value).some(k=>!['onOrAfter','timeZone'].includes(k))||typeof value.timeZone!=='string'||value.timeZone.length>100)invalid();
 // Calendar date, not a promised notification time. PostgreSQL checks its own
 // time-zone catalog and today's date again when preparing AND confirming.
 let timeZone;try{timeZone=new Intl.DateTimeFormat('en',{timeZone:value.timeZone}).resolvedOptions().timeZone;}catch{invalid();}
 const date=value.onOrAfter;
 if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))invalid();
 return {onOrAfter:date,timeZone};
}
// A future report writer must explicitly confirm these facts. This validator
// does not save reports, change plans, create sharing or verify an outcome.
export function validateFollowUpReport(value){
 const keys=['responseState','reportedAction','reportedOutcome','detail','helpfulness','occurredOn','timeZone'];
 if(!object(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))||!['answered','declined','unknown'].includes(value.responseState))invalid();
 const schedule=validateFollowUpSchedule({onOrAfter:value.occurredOn,timeZone:value.timeZone});
 if(value.responseState==='answered'){
  if(!['not_started','attempted','completed','changed_course','unknown'].includes(value.reportedAction)||!['pending','resolved','unresolved','unknown'].includes(value.reportedOutcome)||typeof value.detail!=='string'||value.detail.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.detail)||value.helpfulness!==null&&!['helpful','partly_helpful','not_helpful','unknown'].includes(value.helpfulness))invalid();
 }else if(value.reportedAction!==null||value.reportedOutcome!==null||value.detail!==''||value.helpfulness!==null||value.occurredOn!==null)invalid();
 return {...value,timeZone:schedule.timeZone,provenance:'student_reported',definitionVersion:1};
}
