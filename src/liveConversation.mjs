// Page-lifetime ownership prevents a history reload from summarizing a call
// that is still collecting details. A real page reload releases these leases.
const active=new Set();
export function holdConversation(id){active.add(id);}
export function releaseConversation(id){active.delete(id);}
export function conversationIsActive(id){return active.has(id);}

// A tool response can arrive after the visible specialty has changed. Route
// the tool actually requested, not the current screen/guide label.
export function researchModeForTool(name,current){
 if(name==='lookup_financial_aid')return current==='loans'?'loans':'finance';
 if(name==='lookup_college_applications')return 'admissions';
 if(name==='lookup_education_planning')return 'planning';
 return null;
}
