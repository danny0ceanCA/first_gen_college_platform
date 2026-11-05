// Fit the three-handle preparation cache: neutral opening, the selected student,
// and at most one other named student from the authenticated family response.
// These selectors prepare server-owned context; they never confirm a call target.
export function voicePreparationCandidates(input,students=[]){
 const named=students.filter(student=>typeof student?.id==='string'&&student.id&&typeof student.name==='string'&&student.name.trim());
 if(!named.some(student=>student.id===input.studentId))return [];
 const selected={...input,targetConfirmed:true};
 if(input.role!=='parent')return [selected];
 const alternate=named.find(student=>student.id!==input.studentId);
 return [{...input,studentId:undefined,targetConfirmed:false},selected,...(alternate?[{...selected,studentId:alternate.id}]:[])];
}
