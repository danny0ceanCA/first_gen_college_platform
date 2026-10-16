// Browser-safe policy: no Node APIs and no caller-defined event attributes.
export const clientEvents=Object.freeze('operation_response_received session_cleanup session_start profile_save_confirmation_finished connection_failure client_event guide_update_start initial_target_confirmed guide_update_complete guide_update_failed empty_interruption_recovered transcription_timeout reply_recovered lookup_progress voice_usage_save_failed malformed_event welcome_save_failed server_event speech_segment response_cancelled spoken_language_changed spoken_language_update_failed api_error error_recovered request_error_recovered response_failed student_scope_restart lookup_start lookup_cache_hit lookup_success lookup_failure profile_saved_awaiting_confirmation connection_state unknown_client_event'.split(' '));
export const clientCodes=Object.freeze('authentication_required invalid_token quota_exceeded model_unavailable missing_api_key invalid_api_key busy rate_limited unsupported network_error NotAllowedError NotFoundError NotReadableError invalid_voice_response voice_unavailable connection_timeout connection_failed connection_lost disconnected failed response_failed server_error invalid_value conversation_already_has_active_response response_cancel_not_active item_not_found operation_failed private_search_details other'.split(' '));
export const endpoints=Object.freeze('api/eligibility api/guardian-permission api/admin api/privacy api/activity healthz readyz api/account-data api/institution-metrics/event api/institution-metrics/report api/ai api/chat api/family api/onboarding-events api/plans api/topic-notes api/workspace-sheets api/institutions api/institution-campaigns api/institution-inquiries/public api/institution-inquiries/staff api/account-links api/conversation-history api/conversation-summary api/voice-diagnostics api/profile-voice api/finance-research api/admissions-research api/guidance-history api/progress'.split(' ').map(s=>s.replaceAll('/','.')));
const http=['httpStatus','durationMs','code'];
const errors=['code'];
const spec=(fields,level='info')=>Object.freeze({fields:Object.freeze(fields),level});
export const serverEvents=Object.freeze({
 api_request:spec(http),api_aborted:spec(http,'warn'),api_error:spec(errors,'error'),
 database_error:spec(errors,'error'),upstream_error:spec(errors,'error'),
 upstream_response:spec(['httpStatus','operation']),
 admissions_lookup:spec([...http,'sourceCount']),finance_lookup:spec([...http,'sourceCount']),voice_session:spec([...http,'sourceCount']),
 summary_error:spec(errors,'error'),history_error:spec(errors,'error'),guidance_error:spec(errors,'error'),conversation_quality_error:spec(errors,'error'),
 campaign_storage_error:spec(errors,'error'),inquiry_storage_error:spec(errors,'error'),voice_quality_store_failed:spec(errors,'warn'),
 privacy_monitor_gap:spec(errors,'error'),privacy_alert:spec(['code','sourceCount'],'warn'),
 'service.started':spec([]),'service.stopping':spec([]),'service.database.verified':spec([]),
 'service.database.unavailable':spec(errors,'warn'),'service.startup.failed':spec(errors,'error'),
 'service.crashed':spec(errors,'error'),'service.configuration.invalid':spec(errors,'warn'),
 'retention.failed':spec(errors,'error'),'onboarding.tracking.failed':spec(errors,'warn'),
 'telemetry.gap':spec(['reason','sourceCount'],'warn'),diagnostic_rejected:spec(['reason'],'warn'),
 'telemetry.canary':spec([]),
 'telemetry.aggregate':spec(['sourceEvent','code','occurrenceCount'],'warn'),
 'summary.generate.finished':spec(['outcome','code','durationMs']),
 'summary.save.finished':spec(['outcome','code']),
 'history.operation.finished':spec(['outcome','code']),
 'note.operation.finished':spec(['outcome','code']),
 'binder.scope.changed':spec(['outcome']),
 'provider.operation.finished':spec(['operation','outcome','durationMs','requestMs','bodyMs','failureStage','httpStatus','model','code','usageState','inputTokens','outputTokens','totalTokens','samplingProbability']),
 'db.operation.finished':spec(['operation','outcome','durationMs','acquireMs','executeMs','commitMs','rowBucket','code','samplingProbability']),
 'dependency.started':spec(['operation','dependency','samplingProbability']),
 'dependency.span.finished':spec(['operation','dependency','outcome','durationMs','samplingProbability','coverage']),
 'dependency.incomplete':spec(['operation','dependency','outcome'],'warn'),
 'job.started':spec(['job']),
 'job.finished':spec(['job','outcome','durationMs','code','sourceCount','deletedCount','queryCount','lastSuccessAgeMs']),
 'permission.hangup.finished':spec(['outcome','durationMs','code']),
 'permission.supervisor.finished':spec(['outcome','sourceCount','backlog','oldestMs','code']),
 'runtime.health.observed':spec(['rssBytes','heapBytes','eventLoopDelayMs','poolTotal','poolIdle','poolWaiting','queueDepth','queueDropped','exportDropped','exportPending']),
});
export const enumFields=Object.freeze({
 sourceEvent:Object.freeze([...Object.keys(serverEvents),...clientEvents]),
 mode:Object.freeze(['profile','planning','finance','loans','admissions']),language:Object.freeze(['en','es']),
 connectionState:Object.freeze(['new','connecting','connected','disconnected','failed','closed']),status:Object.freeze(['completed','failed','cancelled','incomplete']),
 operation:Object.freeze(['admissions_lookup','finance_lookup','voice_session','conversation_summary','conversation_overview','chat','conversation.item.delete','summary.generate','summary.overview','summary.review','notes.generate','voice.negotiate','finance.lookup','admissions.lookup','chat.respond','history.read','history.save','history.delete','notes.list','notes.save','permission.read','permission.hangup']),
 failureStage:Object.freeze(['request','body']),dependency:Object.freeze(['provider','database']),usageState:Object.freeze(['unknown','reported']),rowBucket:Object.freeze(['zero','one','few','many']),coverage:Object.freeze(['sampled','terminal-only']),
 model:Object.freeze(['other','gpt-4.1-mini','gpt-4o-mini','gpt-realtime','gpt-realtime-2.1','gpt-realtime-2_1','gpt-6-luna','gpt-6.1','gpt-6.1-sol']),
 job:Object.freeze(['permission-data','diagnostic-maps','metrics','invites','private-summaries','privacy-events','inquiries','outreach','guidance','progress','report-snapshots','quality','onboarding','admin-reviews','privacy-alerts','permission-supervisor']),
 parameter:Object.freeze(['item_id']),method:Object.freeze(['GET','POST','OPTIONS','PUT','PATCH','DELETE','HEAD','OTHER']),
 outcome:Object.freeze(['completed','failed','cancelled','unknown','skipped-lock','deferred','existing','changed']),
 reason:Object.freeze(['unknown_event','queue_full','sink_failed','sink_timeout','release_unknown','closed','shutdown_timeout','capacity','mapping_capacity','mapping_expired','mapping_unavailable','mapping_scope_unavailable','export_loss','volume_limit']),
});
export const numericFields=Object.freeze({occurrenceCount:100000000,exportDropped:100000000,exportPending:2000,durationMs:600000,sourceCount:10000,sequence:100000,speechDurationMs:600000,toolCount:1000,httpStatus:599,requestMs:600000,bodyMs:600000,acquireMs:600000,executeMs:600000,commitMs:600000,inputTokens:100000000,outputTokens:100000000,totalTokens:100000000,samplingProbability:1,backlog:1000000,oldestMs:31536000000,rssBytes:1099511627776,heapBytes:1099511627776,eventLoopDelayMs:600000,poolTotal:100,poolIdle:100,poolWaiting:100000,queueDepth:10000,deletedCount:1000000,queryCount:1000000,lastSuccessAgeMs:31536000000,queueDropped:Number.MAX_SAFE_INTEGER});
export const clientFields=Object.freeze(['code','mode','language','connectionState','status','durationMs','sourceCount','sequence','speechDurationMs','toolCount']);
const clientWarnings=new Set('connection_failure guide_update_failed transcription_timeout voice_usage_save_failed malformed_event welcome_save_failed api_error response_failed spoken_language_update_failed lookup_failure'.split(' '));
export const clientSchemas=Object.freeze(Object.fromEntries(clientEvents.map(event=>[event,spec(clientFields,clientWarnings.has(event)?'warn':'info')])));
