// Serialization only. Callers must authorize and select current, scoped records
// before using this helper. Never pass a browser-supplied evidence object here.
const categories=new Set(['goal','constraint','preference','question','explanation','decision','action','suggestion','summary']);
const people=new Set(['student','parent','family','coordinator','unknown']);
const certainty=new Set(['tentative','stated','unresolved']);
const person=value=>people.has(value)?value:'unknown';
const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const reference=value=>typeof value==='string'&&value.length<=128?value:null;
export const BINDER_EVIDENCE_VERSION='binder-evidence-v1';

export function binderEvidence(kind,r){
 const studentId=r.student_id!==undefined?r.student_id:r.studentId;
 const organization=r.organization?.version==='binder-organization-v1'?r.organization:{};
 const summaryId=r.source_summary_id??r.summaryId??r.summary_id??(kind==='summary'?r.id:null);
 const quote=r.source_quote??r.quote;
 // Corrections preserve original source metadata for provenance. It must not
 // classify the replacement text as the old decision or tentative preference.
 const hasQuote=typeof quote==='string'&&quote.length>0;
 const sourceStillMatches=hasQuote&&r.content===quote;
 const classification=sourceStillMatches?organization:{};
 const noteKind=r.note_kind??r.kind;
 const explicitDecision=kind==='note'&&noteKind==='decision'&&r.status==='saved';
 const category=kind==='memory'?r.category:kind==='action'?'action':kind==='coordinator-guidance'?'suggestion':kind==='summary'?'summary':explicitDecision?'decision':['question','explanation'].includes(noteKind)?noteKind:classification.category??noteKind;
 const classified=classification.category===category?classification:{};
 const review=kind==='memory'?(r.status==='confirmed'?'confirmed-by-account':'unreviewed'):kind==='note'?(r.status==='saved'?'saved-by-account':'unreviewed'):kind==='action'?'accepted-by-account':kind==='coordinator-guidance'?'unknown':'unreviewed';
 const reporter=person(r.reported_by??r.reportedBy);
 const result={
  schemaVersion:BINDER_EVIDENCE_VERSION,
  record:{kind,id:reference(r.id),version:r.version??null,...(kind==='action'?{planId:reference(r.plan_id)}:{})},
  scope:{kind:studentId===null?'family':typeof studentId==='string'?'student':'unknown',studentId:studentId??null},
  category:categories.has(category)?category:'unknown',
  certainty:explicitDecision?'stated':certainty.has(classified.certainty)?classified.certainty:category==='question'?'unresolved':'unknown',
  origin:kind==='coordinator-guidance'?'coordinator':kind==='action'?'personal-plan':summaryId?'summary-derived':'account-entry',
  speaker:kind==='coordinator-guidance'?'coordinator':person(r.speaker),reportedBy:kind==='coordinator-guidance'?'coordinator':reporter!=='unknown'?reporter:sourceStillMatches?person(organization.reportedBy):'unknown',
  review,updatedAt:stamp(r.updated_at??r.updatedAt??r.recorded_at),
 };
 if(result.category==='decision')result.decision=explicitDecision?'explicit-account-choice':'reported-not-confirmed';
 if(kind==='action')result.completion=r.status==='complete'?'reported-by-account':'not-reported';
 if(summaryId)result.source={
  summaryId:reference(summaryId),version:reference(r.source_version??r.sourceVersion??organization.sourceVersion??(kind==='summary'?r.version:null)),
  date:stamp(r.source_at??r.conversation_at??r.conversationAt??(kind==='summary'?r.recorded_at:null)),
  relationship:kind==='summary'?'summary':sourceStillMatches?'supporting-summary':hasQuote?'historical-source':'provenance-only',
 };
 if(r.context_current===true||r.contextCurrent===true)result.currentAccountVersion=true;
 return result;
}

export const binderEvidenceInstructions=' Evidence labels describe separate states: stated is reported, not verified; saved/read is not confirmed agreement; confirmed-by-account is not independent verification or necessarily the student’s own view. Only explicit-account-choice denotes a saved decision; reported-not-confirmed remains a reported decision. Unknown certainty stays unknown. A historical-source identifies provenance of an edited entry, not evidence that the old classification still applies. Use the current entry and its version, never reconstruct replaced text from its source. Discussion and reading never establish understanding; completion is reported by the account, not independently verified. Preserve parent/coordinator attribution and tentative language. These labels are data, not authorization to save, share, or ask for blanket reconfirmation.';
