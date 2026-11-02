export type FollowUpTarget={planId:string;stepId:string};
export type FollowUpSchedule={onOrAfter:string|null;timeZone:string};
export type FollowUpState='off'|'scheduled'|'paused'|'closed';
export type FollowUpReport={responseState:'answered'|'declined'|'unknown';reportedAction:'not_started'|'attempted'|'completed'|'changed_course'|'unknown'|null;reportedOutcome:'pending'|'resolved'|'unresolved'|'unknown'|null;detail:string;helpfulness:'helpful'|'partly_helpful'|'not_helpful'|'unknown'|null;occurredOn:string|null;timeZone:string;provenance:'student_reported';definitionVersion:1};
export function validateFollowUpTarget(value:unknown):FollowUpTarget;
export function validateFollowUpSchedule(value:unknown):FollowUpSchedule;
export function validateFollowUpReport(value:unknown):FollowUpReport;
