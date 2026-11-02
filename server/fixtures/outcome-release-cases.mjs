// Hand-authored engineering reference labels. These are synthetic structured
// facts, not model predictions or institutional verification of real events.
import {outcomeDefinition} from '../../src/outcomeEvidence.mjs';
const scope={institution:'Example University',term:'2026–2027',cycle:'Coverage review'};
const evidence=(extra={})=>({reference:{kind:'student_report',id:'synthetic-report',version:1},definitionId:'document_submitted',definitionVersion:1,scope,availability:'current',origin:'student_reported',basis:'student_account',responseState:'answered',claim:{status:'occurred',decision:null},eventOn:'2026-10-01',timeZone:'America/Chicago',recordedAt:'2026-11-01',statement:'Invented statement for contract review.',...extra});
const input=(records,extra={})=>({subject:{kind:'private_episode',id:'synthetic-episode',version:1},definitionId:'document_submitted',definitionVersion:1,scope,window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'},evidence:records,...extra});
const yes=evidence(),no=evidence({reference:{kind:'student_report',id:'synthetic-other-report',version:1},claim:{status:'not_occurred',decision:null}});
const coor=(extra={})=>evidence({reference:{kind:'coordinator_observation',id:'synthetic-observation',version:1},origin:'coordinator_observation',basis:'declared_record_review',position:'supports',observedOn:'2026-11-01',sourceReference:{kind:'submission_receipt',on:'2026-10-01'},adviceRelationship:'same_author',dependsOnStudentStatement:'unknown',...extra});
const cases=[
 ['submission-is-student-report',input([yes]),'student_reported',1,['student_account_unconfirmed']],
 ['no-answer-is-no-evidence',input([]),'insufficient',0,['no_evidence']],
 ['explicit-outcome-decline',input([evidence({responseState:'declined',claim:{status:null,decision:null},eventOn:null})]),'insufficient',0,['student_declined']],
 ['explicit-unknown',input([evidence({responseState:'unknown',claim:{status:null,decision:null},eventOn:null})]),'insufficient',0,['student_unknown']],
 ['pending-stays-pending',input([evidence({claim:{status:'pending',decision:null}})]),'student_reported',1,['result_pending']],
 ['goal-changed-is-not-failure',input([evidence({claim:{status:'goal_changed',decision:null}})]),'student_reported',1,['goal_changed']],
 ['unknown-claim',input([evidence({claim:{status:'unknown',decision:null}})]),'insufficient',0,['claim_unknown']],
 ['same-day-conflict',input([yes,no]),'disputed',0,['same_scope_date_conflict']],
 ['later-event-is-not-retroactive-falsehood',input([yes,{...no,eventOn:'2026-10-02'}]),'multiple_events',2,['different_event_dates']],
 ['unknown-date-conflict',input([yes,{...no,eventOn:null}]),'ambiguous',0,['timing_relationship_unknown']],
 ['different-time-zones',input([yes,{...no,timeZone:'UTC'}]),'ambiguous',0,['timing_relationship_unknown']],
 ['different-term-is-not-corroboration',input([yes,{...no,scope:{...scope,term:'2027–2028'}}]),'student_reported',1,['different_or_missing_scope']],
 ['retry-does-not-add-source',input([yes,yes]),'student_reported',1,['student_account_unconfirmed']],
 ['inconsistent-duplicate',input([yes,{...yes,claim:{status:'not_occurred',decision:null}}]),'insufficient',0,['inconsistent_source']],
 ['undated-event-after-window',input([evidence({eventOn:null})],{window:{start:'2026-01-01',end:'2026-10-31',timeZone:'America/Chicago'}}),'stale',0,['undated_event_outside_window']],
 ['dated-event-keeps-historical-attribution',input([yes],{window:{start:'2026-01-01',end:'2026-10-31',timeZone:'America/Chicago'}}),'student_reported',1,[]],
 ['expired-permission',input([yes],{validUntil:'2026-11-01T00:00:00Z'}),'stale',0,['source_expired']],
 ['source-unavailable',input([yes],{availability:'historical'}),'unavailable',0,['source_unavailable']],
 ['future-date',input([evidence({eventOn:'2026-11-03'})]),'insufficient',0,['event_outside_window']],
 ['changed-definition',input([yes],{definitionContract:{...outcomeDefinition('document_submitted',1),criterion:'A changed criterion'}}),'unavailable',0,['definition_contract_changed']],
 ['incomplete-lookup',input([yes],{limited:true}),'insufficient',0,['evidence_limit']],
 ['author-reviews-own-advice',input([coor()]),'coordinator_reported',1,['advice_author_is_reviewer','record_check_not_authenticated']],
 ['repeat-student-account-is-dependent',input([coor({basis:'student_account',sourceReference:null,dependsOnStudentStatement:'yes'})]),'student_reported',1,['dependent_student_account']],
 ['student-disagrees-with-observation',input([coor({dispute:{observationVersion:1}})]),'disputed',0,['unresolved_disagreement']],
 ['receipt-does-not-prove-waiver-approval',input([coor({definitionId:'waiver_approved'})],{definitionId:'waiver_approved'}),'insufficient',0,['record_type_does_not_establish_claim']],
 ['denial-is-received-decision',input([evidence({definitionId:'decision_received',claim:{status:'occurred',decision:'denied'}})],{definitionId:'decision_received'}),'student_reported',1,['decision_is_denial']]
];
export const outcomeReleaseCases=cases.map(([id,input,state,claims,reasons])=>({id,input,expected:{state,claims,reasons}}));
export const outcomeReleaseCaseCutoff='2026-11-02T12:00:00.000Z';
