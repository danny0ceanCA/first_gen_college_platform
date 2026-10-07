// API request/reply errors do not imply that the WebRTC session has closed.
// Actual transport loss is handled by voiceConnectionRecovery/onclose.
export function voiceErrorEndsSession(code){
 return ['session_expired','session_closed','invalid_api_key','authentication_error'].includes(code);
}
export function voiceReplyCanRetry(code){
 return ['server_error','internal_server_error','timeout'].includes(code);
}
