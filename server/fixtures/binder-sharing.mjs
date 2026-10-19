import {BINDER_SHARING_POLICY_VERSION} from '../binder-sharing-policy.mjs';
// Synthetic policy facts: no production identity or customer content.
export const sharingNow=Date.parse('2026-10-18T12:00:00Z');
export function eligibleBinderFacts(){
 const digest='a'.repeat(64);
 return {
  actor:{subject:'synthetic-student',accountId:'student-account'},
  student:{id:'student',accountId:'student-account',ownerSubject:'synthetic-student',ownershipVerified:true,parentManaged:false,role:'student',eligibility:'adult',closed:false,permissionRevision:2},
  coordinator:{id:'coordinator',subject:'synthetic-staff',organizationId:'organization',active:true,membershipActive:true,organizationVerified:true,organizationEnabled:true,emailVerified:true,mfaVerified:true,revision:3},
  connection:{id:'connection',accountId:'student-account',studentId:'student',coordinatorId:'coordinator',status:'accepted',revision:2},
  grant:{id:'grant',connectionId:'connection',accountId:'student-account',studentId:'student',coordinatorId:'coordinator',grantorSubject:'synthetic-student',status:'active',expiresAt:'2026-11-01T00:00:00Z',revision:4,permissionRevision:2,coordinatorRevision:3,connectionRevision:2,topics:['options']},
  entry:{id:'note',accountId:'student-account',studentId:'student',status:'saved',topic:'options',version:2,kind:'note',language:'en',content:'Compare campus visit dates.',digest},
  lineage:{id:'lineage',accountId:'student-account',studentId:'student',sourceKind:'note',sourceId:'note',classification:'student_only',complete:true,active:true,sourceVersion:2,revision:2,digest,ancestors:[]},
  preview:{actorSubject:'synthetic-student',grantId:'grant',grantRevision:4,entryId:'note',entryVersion:2,lineageRevision:2,digest,policyVersion:BINDER_SHARING_POLICY_VERSION,confirmed:true,expiresAt:'2026-10-18T12:10:00Z'},
 };
}
export function protectedBinderFixtures(){
 return ['family','parent','mixed','unknown'].flatMap(classification=>['original','edited','translated','copied'].map(operation=>{
  const facts=eligibleBinderFacts();facts.lineage.classification=classification;facts.lineage.complete=false;
  facts.entry.content=`PRIVATE_FAMILY_SENTINEL ${classification} ${operation}`;
  return {classification,operation,facts};
 }));
}
