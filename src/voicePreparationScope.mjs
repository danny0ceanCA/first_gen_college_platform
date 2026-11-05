const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;

// Only selectors that affect server-owned context reads. Transport/session
// controls stay on the current request; they must never come from a cache.
export function voicePreparationScope(input){
 const focus=input.workspaceFocus?{...input.workspaceFocus}:undefined;
 if(focus)delete focus.serial; // UI occurrence, not an evidence version.
 return {mode:input.mode,language:input.language,role:input.role,studentId:input.studentId,
  routeConversations:input.routeConversations===true,
  targetConfirmed:input.routeConversations!==true||input.targetConfirmed===true,
  onboarding:input.onboarding===true,workspaceFocus:focus,
  workspaceRefreshOnly:input.workspaceRefreshOnly===true,continuity:input.continuity};
}
export const voicePreparationSignature=input=>JSON.stringify(canonical(voicePreparationScope(input)));
