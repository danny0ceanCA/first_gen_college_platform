// Manual-note reference policy for trusted repository facts only. Request bodies and model
// outputs cannot supply these facts. Phase 4 enforces the narrower manual-note
// subset transactionally in migration 053; migration 054 adds separately gated coordinator reads.
// Student-first Phase 7's separate derived-excerpt policy is enforced by migration
// 067. It never certifies whole summaries or changes this manual-note serializer.
export const BINDER_SHARING_POLICY_VERSION='coordinator-sharing-v1';
export const sharingTopics=Object.freeze(['options','transfer','costs','applications']);
export const coordinatorFlags=Object.freeze(['ORIGEN_COORDINATOR_ACCOUNTS','ORIGEN_COORDINATOR_LINKING','ORIGEN_BINDER_SHARING','ORIGEN_COORDINATOR_FEEDBACK','ORIGEN_COORDINATOR_VOICE_LINKING','ORIGEN_COORDINATOR_BINDER_VIEWING']);
export const coordinatorTables=Object.freeze([
 'origen_coordinator_applications','origen_coordinator_application_controls',
 'origen_coordinator_feedback_tombstones','origen_coordinator_outbox','origen_coordinator_operations','origen_coordinator_operation_events',
 'origen_coordinator_feedback_requests','origen_coordinator_feedback_reports','origen_coordinator_feedback_steps',
 'origen_coordinator_profiles','origen_coordinator_codes','origen_binder_connections',
 'origen_binder_share_grants','origen_binder_publications','origen_binder_publication_items',
 'origen_coordinator_feedback','origen_coordinator_feedback_revisions','origen_coordinator_replies',
 'origen_binder_share_events','origen_coordinator_notifications','origen_coordinator_organizations',
 'origen_binder_reviews','origen_binder_previews','origen_coordinator_student_pilots','origen_coordinator_link_contexts','origen_coordinator_link_challenges','origen_coordinator_lookup_budgets',
]);
export const lineageTables=Object.freeze(['origen_binder_source_lineage','origen_binder_source_edges']);
export function coordinatorConfigurationIssues(env={}){
 const derivedIssues=[];
 if(env.ORIGEN_COORDINATOR_FOLLOW_THROUGH&&!['true','false'].includes(env.ORIGEN_COORDINATOR_FOLLOW_THROUGH))derivedIssues.push('ORIGEN_COORDINATOR_FOLLOW_THROUGH: use true or false');
 if(env.ORIGEN_COORDINATOR_FOLLOW_THROUGH==='true'&&env.ORIGEN_COORDINATOR_FEEDBACK!=='true')derivedIssues.push('ORIGEN_COORDINATOR_FOLLOW_THROUGH: requires coordinator feedback');
 if(env.ORIGEN_DERIVED_BINDER_SHARING&&!['true','false'].includes(env.ORIGEN_DERIVED_BINDER_SHARING))derivedIssues.push('ORIGEN_DERIVED_BINDER_SHARING: use true or false');
 if(env.ORIGEN_DERIVED_BINDER_SHARING==='true'&&env.ORIGEN_BINDER_SHARING!=='true')derivedIssues.push('ORIGEN_DERIVED_BINDER_SHARING: requires binder sharing');
 const available=['ORIGEN_COORDINATOR_FEEDBACK','ORIGEN_BINDER_SHARING','ORIGEN_COORDINATOR_ACCOUNTS','ORIGEN_COORDINATOR_LINKING','ORIGEN_COORDINATOR_VOICE_LINKING','ORIGEN_COORDINATOR_BINDER_VIEWING'];
 const issues=coordinatorFlags.flatMap(key=>!env[key]||env[key]==='false'||available.includes(key)&&env[key]==='true'?[]:[`${key}: unsupported setting`]);
 if(env.ORIGEN_COORDINATOR_LINKING==='true'&&env.ORIGEN_COORDINATOR_ACCOUNTS!=='true')issues.push('ORIGEN_COORDINATOR_LINKING: requires coordinator accounts');
 if(env.ORIGEN_COORDINATOR_VOICE_LINKING==='true'&&env.ORIGEN_COORDINATOR_LINKING!=='true')issues.push('ORIGEN_COORDINATOR_VOICE_LINKING: requires coordinator linking');
 if(env.ORIGEN_BINDER_SHARING==='true'&&env.ORIGEN_COORDINATOR_LINKING!=='true')issues.push('ORIGEN_BINDER_SHARING: requires coordinator linking');
 if(env.ORIGEN_COORDINATOR_BINDER_VIEWING==='true'&&env.ORIGEN_BINDER_SHARING!=='true')issues.push('ORIGEN_COORDINATOR_BINDER_VIEWING: requires binder sharing');
 if(env.ORIGEN_COORDINATOR_FEEDBACK==='true'&&env.ORIGEN_COORDINATOR_BINDER_VIEWING!=='true')issues.push('ORIGEN_COORDINATOR_FEEDBACK: requires coordinator binder viewing');
 return [...issues,...derivedIssues];
}
const classifications=new Set(['student_only','unknown','family','parent','mixed']);
export function inheritSharingClassification(values){
 if(!Array.isArray(values)||!values.length)return 'unknown';
 const list=values.map(value=>classifications.has(value)?value:'unknown');
 if(list.includes('mixed')||list.includes('family')&&list.includes('parent'))return 'mixed';
 if(list.includes('parent'))return 'parent';
 if(list.includes('family'))return 'family';
 return list.every(value=>value==='student_only')?'student_only':'unknown';
}
const validVersion=value=>Number.isSafeInteger(value)&&value>0;
const future=(value,now)=>Number.isFinite(Date.parse(value))&&Date.parse(value)>now;
const denied=reason=>({allowed:false,reason});

// Pure policy, usable for synthetic fixtures and future server repositories.
// The future repository must load and lock these records in one transaction.
export function evaluateBinderPublication(facts={},now=Date.now()){
 const {actor,student,coordinator,connection,grant,entry,lineage,preview}=facts||{};
 if(!Number.isFinite(now)||!actor?.subject||actor.accountId!==student?.accountId||student?.ownerSubject!==actor.subject||!student?.id||student.ownershipVerified!==true||student.role!=='student'||student.parentManaged!==false)return denied('student_owner_required');
 if(!(student.eligibility==='adult'||student.eligibility==='approved'&&future(student.permissionExpiresAt,now))||student.closed!==false||!validVersion(student.permissionRevision))return denied('permission_required');
 if(!coordinator?.id||!coordinator.subject||!coordinator.organizationId||coordinator.active!==true||coordinator.membershipActive!==true||coordinator.organizationVerified!==true||coordinator.organizationEnabled!==true||coordinator.emailVerified!==true||coordinator.mfaVerified!==true||!validVersion(coordinator.revision))return denied('coordinator_unavailable');
 if(!connection?.id||connection.status!=='accepted'||connection.accountId!==student.accountId||connection.studentId!==student.id||connection.coordinatorId!==coordinator.id||!validVersion(connection.revision))return denied('connection_required');
 if(!grant?.id||grant.connectionId!==connection.id||grant.accountId!==student.accountId||grant.studentId!==student.id||grant.coordinatorId!==coordinator.id||grant.grantorSubject!==actor.subject||grant.status!=='active'||grant.revokedAt||!future(grant.expiresAt,now)||!validVersion(grant.revision)||grant.permissionRevision!==student.permissionRevision||grant.coordinatorRevision!==coordinator.revision||grant.connectionRevision!==connection.revision)return denied('grant_unavailable');
 if(!entry?.id||entry.accountId!==student.accountId||entry.studentId!==student.id||entry.status!=='saved'||!sharingTopics.includes(entry.topic)||!Array.isArray(grant.topics)||!grant.topics.every(t=>sharingTopics.includes(t))||!grant.topics.includes(entry.topic))return denied('entry_scope_denied');
 if(!validVersion(entry.version)||!['note','question','explanation','decision'].includes(entry.kind)||!['en','es'].includes(entry.language)||typeof entry.content!=='string'||!entry.content.trim()||entry.content.length>2000)return denied('invalid_entry');
 if(!lineage?.id||lineage.accountId!==student.accountId||lineage.studentId!==student.id||lineage.sourceKind!=='note'||lineage.sourceId!==entry.id||lineage.classification!=='student_only'||lineage.complete!==true||lineage.active!==true||lineage.sourceVersion!==entry.version||!validVersion(lineage.revision)||!entry.digest||lineage.digest!==entry.digest||!Array.isArray(lineage.ancestors)||lineage.ancestors.some(s=>!s||s.accountId!==student.accountId||s.studentId!==student.id||s.classification!=='student_only'||s.complete!==true||s.active!==true))return denied('private_source');
 if(!preview||preview.actorSubject!==actor.subject||preview.grantId!==grant.id||preview.grantRevision!==grant.revision||preview.entryId!==entry.id||preview.entryVersion!==entry.version||preview.lineageRevision!==lineage.revision||preview.digest!==entry.digest||preview.policyVersion!==BINDER_SHARING_POLICY_VERSION||preview.confirmed!==true||!future(preview.expiresAt,now))return denied('preview_changed');
 return {allowed:true,reason:'eligible'};
}

// Re-evaluate; never accept an {allowed:true} flag from a caller. Deliberately
// exclude provenance, source quotes, account IDs, translations, and summaries.
export function serializeSharedBinderEntry(facts,now){
 const decision=evaluateBinderPublication(facts,now);
 if(!decision.allowed)throw Object.assign(new Error('binder_entry_not_shareable'),{status:403,reason:decision.reason});
 const {entry}=facts;
 return {id:entry.id,topic:entry.topic,kind:entry.kind,language:entry.language,content:entry.content};
}

const paths=new Set(['/api/coordinator-access','/api/coordinator-connections','/api/binder-sharing','/api/coordinator-binders','/api/coordinator-feedback','/api/coordinator-notifications']);
export const isCoordinatorRoute=url=>paths.has(url?.split('?')[0]);
