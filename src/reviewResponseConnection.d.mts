/** Identity only; never an access grant or evidence of student consent. */
export type ReviewResponseReference={kind:'review-response';requestId:string;responseVersion:number};
export type ReviewResponseIntent={purpose:'conversation-focus'|'private-choice'|'related-request';source:ReviewResponseReference};
export type ReviewResponseHistoryReason='withdrawn'|'source_changed'|'access_changed'|'expired'|'restored';
export type ReviewResponseConnection=
 | {availability:'unavailable';reason:'no_response'|'response_changed'|'response_withdrawn';source:ReviewResponseReference|null;currentVersion:number|null}
 | (({availability:'current';reason:null}|{availability:'historical';reason:ReviewResponseHistoryReason}) & {
   source:ReviewResponseReference;currentVersion:number;
   request:{id:string;status:'submitted'|'withdrawn';originalQuestion:string;approvedQuestion:string;approvedWording:'original'|'clarification';submittedAt:string;withdrawnAt:string|null;coordinatorOpenedAt:string|null;coordinatorReviewedAt:string|null};
   response:{version:number;createdAt:string;updatedAt:string;author:{coordinatorId:string;name:string};organization:{id:string;name:string}};
   notification:{status:'pending'|'delivered'|'failed'|'suppressed'|'not_recorded';deliveredAt:string|null};
   /** No instrumentation yet. Absence of evidence is not evidence of inaction. */
   studentActivity:{opened:'not_recorded';discussed:'not_recorded';actionAccepted:'not_recorded'|'recorded'};
   /** Point-in-time facts, not rollout flags, consent, or permission tokens. */
   scope:{aiEligible:boolean;requestPublicationCurrent:boolean;historicalRequiresExplicitFocus:boolean};
 });
export function validateReviewResponseReference(value:unknown):ReviewResponseReference;
export function validateReviewResponseIntent(value:unknown):ReviewResponseIntent;
