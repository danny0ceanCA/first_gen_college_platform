// Only use saved, attributed discussions. Onboarding is not a topic milestone.
export function homeTopicActivity(items, studentId) {
 const latest=new Map();
 if(!studentId)return [];
 for(const item of items){
  if(item.studentId!==studentId||!['planning','finance','admissions','loans'].includes(item.mode)||!item.summary?.trim()||!Number.isFinite(Date.parse(item.date)))continue;
  const previous=latest.get(item.mode);
  if(!previous||Date.parse(item.date)>Date.parse(previous.date))latest.set(item.mode,{mode:item.mode,date:item.date});
 }
 return [...latest.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.mode.localeCompare(b.mode));
}
