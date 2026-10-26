export const binderTopics=['options','transfer','costs','applications'];
export const binderTopicTool={type:'function',name:'highlight_binder_topics',description:'Quietly guide the screen to the current topic in the confirmed conversation’s binder and glow related dividers. Never edits or saves notes.',parameters:{type:'object',additionalProperties:false,properties:{topics:{type:'array',items:{type:'string',enum:binderTopics},maxItems:4,uniqueItems:true}},required:['topics']}};
export const binderTopicInstructions='LIVE BINDER DIVIDERS: When the actual subject of the conversation becomes clear or changes, quietly call highlight_binder_topics with only the topics currently being discussed: options for interests, majors, careers and choosing colleges; transfer for courses, credits and transfer pathways; costs for tuition, aid, scholarships and loans; applications for applications, essays, requirements and deadlines. Use multiple topics only when the current question connects them. Use an empty list for unrelated conversation. Do not highlight everything merely because a binder tour names the dividers. Do not call on every reply when the topics have not changed. No permission, announcement or spoken acknowledgement is needed. The screen follows the confirmed conversation’s binder and current divider when no draft or typing is in progress; related dividers glow. This does not edit or save notes. Notes are prepared separately after the conversation summary saves.';

function validTopics(topics){return Array.isArray(topics)&&topics.length<=4&&topics.every(topic=>binderTopics.includes(topic))&&new Set(topics).size===topics.length;}

/** Only topic IDs and opaque scope IDs, never speech, names or note content. */
export function createBinderActivity(){
 let snapshot=null;
 const listeners=new Set(),emit=()=>listeners.forEach(listener=>listener());
 return {
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  snapshot:()=>snapshot,
  begin(source,subject,studentId,topics=[]){
   if(!source||!subject||!(studentId===null||typeof studentId==='string')||!validTopics(topics))return false;
   snapshot={source,subject,studentId,topics:[...topics]};emit();return true;
  },
  update(source,topics){
   if(snapshot?.source!==source||!validTopics(topics))return false;
   if(snapshot.topics.join('|')!==topics.join('|')){snapshot={...snapshot,topics:[...topics]};emit();}
   return true;
  },
  end(source){if(snapshot?.source===source){snapshot=null;emit();}},
  clear(){if(snapshot){snapshot=null;emit();}},
 };
}

/** The initial load is a baseline; only later successful note loads mark new IDs. */
export function createBinderNoteUpdates(){
 const scopes=new Map(),listeners=new Set();
 let snapshot={scope:'',ids:[]};
 const publish=(scope,ids)=>{if(snapshot.scope===scope&&snapshot.ids.join('|')===ids.join('|'))return;snapshot={scope,ids};listeners.forEach(listener=>listener());};
 return {
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  snapshot:()=>snapshot,
  observe(scope,notes){
   let state=scopes.get(scope);
   if(!state){state={known:new Set(notes.map(note=>note.id)),unread:new Set()};scopes.set(scope,state);}
   else{
    const present=new Set(notes.map(note=>note.id));
    for(const note of notes){if(!state.known.has(note.id))state.unread.add(note.id);state.known.add(note.id);}
    for(const id of state.unread)if(!present.has(id))state.unread.delete(id);
   }
   publish(scope,[...state.unread]);
  },
  read(scope,id){const state=scopes.get(scope);if(state?.unread.delete(id)&&snapshot.scope===scope)publish(scope,[...state.unread]);},
  clear(){scopes.clear();publish('',[]);},
 };
}
