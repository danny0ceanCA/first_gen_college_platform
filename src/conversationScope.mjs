export function resolveScope(scope,students){
 if(scope==='family')return null;
 if(typeof scope!=='string'||!scope.startsWith('student:'))return undefined;
 const id=scope.slice(8);return students.some(s=>s.id===id)?id:undefined;
}
// The utterance requesting another student belongs to neither saved segment.
export function beforeScopeRequest(turns){
 let index=turns.length-1;while(index>=0&&turns[index].role!=='user')index--;
 return index>=0?turns.slice(0,index):turns;
}
