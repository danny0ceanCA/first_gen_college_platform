export const onboardingUUID=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const names=new Set(['onboarding_opened','fields_updated','voice_button_pressed','voice_start_requested','microphone_allowed','microphone_denied','microphone_failed','voice_connected','voice_connection_failed','voice_ended','save_requested','validation_failed','save_succeeded','save_failed','home_reached','logout_selected','logout_failed','page_hidden','page_visible','page_leaving','setup_method_changed']);
names.add('tracking_delivery_recovered');names.add('tracking_delivery_gap');
for(const name of ['first_agent_audio','first_user_speech','user_speech_started','user_speech_stopped','user_speech_transcription','speech_during_agent_audio','agent_audio_started','agent_audio_drained','agent_audio_cleared','agent_response_finished','audio_playback_started','audio_playback_blocked','audio_playback_resumed','audio_playback_paused','microphone_muted','microphone_unmuted','save_confirmation_waiting','save_confirmation_started','save_confirmation_audio_started','save_confirmation_finished','save_confirmation_interrupted','save_confirmation_skipped','home_transition_started','home_transition_open_requested','home_transition_finished','home_transition_failed','home_transition_cancelled','home_guide_update_started','home_guide_update_finished','home_guide_update_failed','home_introduction_requested','home_introduction_started','home_introduction_finished','home_introduction_failed','native_handoff_requested','native_handoff_acknowledged','native_handoff_failed'])names.add(name);
const fields=new Set(['account_name','account_role','student_name','stage','school','interest','gpa','activities','goals','institutions','entryTerm','needs','notes']);
const reasons=new Set(['user_end','logout','connection_lost','connection_failed','connection_timeout','time_limit','screen_unmounted','unknown','missing_details','request_failed']);
for(const reason of ['cancelled','failed','incomplete','buffer_cleared','call_ended','home_not_rendered'])reasons.add(reason);
const codes=new Set(['NotAllowedError','SecurityError','NotFoundError','NotReadableError','unsupported','network_error','authentication_required','invalid_token','quota_exceeded','model_unavailable','missing_api_key','invalid_api_key','busy','rate_limited','invalid_voice_response','voice_unavailable','connection_timeout','connection_failed','connection_lost','server_error']);

export function sanitizeOnboardingMetadata(source){
 source=source&&typeof source==='object'?source:{};
 const metadata={};
 if(['en','es'].includes(source.language))metadata.language=source.language;
 if(['voice','manual','name','choice'].includes(source.method))metadata.method=source.method;
 if(typeof source.restored==='boolean')metadata.restored=source.restored;
 if(typeof source.playbackReady==='boolean')metadata.playbackReady=source.playbackReady;
 if(['web','native'].includes(source.surface))metadata.surface=source.surface;
 if(source.captureVersion===3)metadata.captureVersion=3;
 if(source.deliveryVersion===1)metadata.deliveryVersion=1;
 if(['completed','cancelled','failed','incomplete','accepted','empty','timeout','drained'].includes(source.status))metadata.status=source.status;
 if(Number.isInteger(source.durationMs)&&source.durationMs>=0&&source.durationMs<=600000)metadata.durationMs=source.durationMs;
 for(const key of ['retryCount','droppedCount'])if(Number.isInteger(source[key])&&source[key]>0&&source[key]<=2000)metadata[key]=source[key];
 if(['expired','capacity','invalid','request_rejected'].includes(source.gapReason))metadata.gapReason=source.gapReason;
 for(const key of ['speechIndex','responseIndex'])if(Number.isInteger(source[key])&&source[key]>0&&source[key]<=2000)metadata[key]=source[key];
 if(reasons.has(source.reason))metadata.reason=source.reason;
 if(source.code)metadata.code=codes.has(source.code)?source.code:'other';
 if(onboardingUUID(source.voiceSessionId))metadata.voiceSessionId=source.voiceSessionId;
 if(onboardingUUID(source.voiceAttemptId))metadata.voiceAttemptId=source.voiceAttemptId;
 if(source.fields&&typeof source.fields==='object')metadata.fields=Object.fromEntries(Object.entries(source.fields).filter(([field,value])=>fields.has(field)&&typeof value==='boolean'));
 return metadata;
}

export const onboardingEventName=name=>names.has(name);

