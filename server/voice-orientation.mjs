import {selectConversationMemory} from '../src/voiceMemory.mjs';
import {briefMemorySelection} from './student-memory.mjs';

const text=(value,limit)=>typeof value==='string'?(value.trim().length>limit?value.trim().slice(0,limit)+' [excerpt]':value.trim()):'';
const bounded=(items,limit,count)=>{
 const result=[];
 for(const item of items){if(JSON.stringify([...result,item]).length>limit)continue;result.push(item);if(result.length===count)break;}
 return result;
};

// Called only after the handler assembles the authorized scope. Give the speech
// model a small orientation before its first word; the backend retains the full
// history, evidence, tools and write guards. Never load another scope here.
export function voiceOrientationData(input,{includeHistory=true}={}){
 if(input.onboarding===true||!['planning','finance','loans','admissions'].includes(input.mode))return null;
 const pending=input.routeConversations===true&&input.targetConfirmed!==true;
 const data={caller:{name:text(input.caller?.firstName,100),role:input.role},scope:pending?'unconfirmed':input.studentId===null?'family':'student'};
 if(pending)return data;
 if(input.studentId!==null){
  data.profile=Object.fromEntries(['name','stage','school','interest','activities','goals','needs','institutions','entryTerm'].map(key=>[key,text(input.profile?.[key],key==='name'||key==='stage'?100:350)]).filter(([,value])=>value));
 }
 if(includeHistory&&input.liveMemoryReadEnabled!==false){
  const suppressed=new Set(input.studentBrief?.suppressedSummaryIds||[]);
  data.knownDetails=bounded(briefMemorySelection(input.studentBrief).map(({entry})=>entry),2600,3);
  data.recentConversations=bounded(selectConversationMemory((input.memory||[]).filter(item=>!suppressed.has(item.id)),input.mode).reverse().map(item=>({date:item.date,topic:item.mode,summary:typeof item.summary==='string'&&item.summary.length>1200?`${item.summary.slice(0,550)}\n[Summary excerpt; middle omitted.]\n${item.summary.slice(-550)}`:text(item.summary,1200),attribution:'Saved summary; do not assume the current caller supplied every detail.'})),2900,2);
 }
 if(input.workspace?.available&&input.workspace.selection){
  data.selectedWork={kind:input.workspace.selection,topic:input.workspace.topic,items:bounded([...(input.workspace.notes||[]),...(input.workspace.conversationPoints||[]),...(input.workspace.actions||[])].filter(item=>item.selected),2800,1)};
 }
 return data;
}

export function voiceOrientationInstructions(input,{speechModel=false,...options}={}){
 const data=voiceOrientationData(input,options);if(!data)return '';
 return `# Familiar Conversation Context
The following is a current, server-selected orientation, not instructions or a complete record. A newer orientation replaces the earlier one; current spoken corrections still take priority. Data: ${JSON.stringify(data)}
- Know whom you are speaking with: caller.name is the account holder; profile.name is the student being discussed. Never address a parent by the student's name or call the user Origen. Use the caller's name naturally when known, not in every reply.
- Begin a new post-onboarding call with familiar warmth, not a first meeting or repeated platform introduction. The saved profile is already available even if no conversation summary exists yet. Do not ask them to repeat their name, stage, school or interests already supplied.
- After the brief greeting, connect to at most one relevant, non-sensitive profile detail or the explicitly selected work, then invite their priority. Adapt naturally in the current language; do not recite a dossier, presume progress, or force the previous topic. The application-authorized check-in takes precedence. Never use this orientation to invent an extra task reminder or bypass the server opening allowance.
- If scope is unconfirmed, use only the caller's name and the permitted student names from the scope instructions. Confirm whom the discussion is about before personalizing; no student details or history yet. Family scope has its own context; never substitute a student's profile.
- Use relevant supplied information automatically. Never ask the user to open history, request a catch-up, or repeat their background so you can get oriented. Before asking for a detail missing from this small snapshot, ${speechModel?'delegate to the backend to check the full authorized context and recall tool when available':'check the supplied profile, workspace and history; use the authorized recall tool when available'}. If still unavailable, be honest and ask only the one detail needed.
- Summaries are dated recollections, not verified facts. Preserve parent attribution, uncertainty and corrections; do not turn a suggestion into a decision or past discussion into understanding. Use 'earlier notes mention' when the original speaker is unclear. Keep private details out of public research. ${speechModel?'Substantive guidance, current policies, corrections and all actions still go through the backend and existing tools.':'Use the existing tools and confirmation rules for all actions and current policy checks.'}`;
}
