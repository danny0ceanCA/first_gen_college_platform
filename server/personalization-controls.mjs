// Server configuration only. Never accept flags or cohort membership from a client.
// Re-read on each operation so a disabled capability also fences existing sessions.
export function personalizationControls(env={},subject){
 const mode=env.ORIGEN_PERSONALIZATION_MODE||'off';
 const subjects=(env.ORIGEN_PERSONALIZATION_SUBJECTS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const eligible=typeof subject==='string'&&!!subject&&(mode==='on'||mode==='cohort'&&subjects.includes(subject));
 const feature=name=>eligible&&(env[name]===undefined||env[name]==='true');
 return {
  enabled:eligible,
  retrieval:feature('ORIGEN_PERSONALIZATION_RETRIEVAL'),
  writes:feature('ORIGEN_PERSONALIZATION_LIVE_WRITES'),
  adaptive:feature('ORIGEN_PERSONALIZATION_ADAPTIVE'),
  extraction:eligible&&env.ORIGEN_PERSONALIZATION_EXTRACTION==='true',
 };
}
export function requireLiveCapability(env,subject,action){
 if(action==='close')return;
 const policy=personalizationControls(env,subject);
 const allowed=action.startsWith('question')?policy.adaptive&&(policy.retrieval||policy.writes):['write','present'].includes(action)?policy.writes:action==='inspect'?policy.retrieval:policy.retrieval||policy.writes;
 if(!allowed)throw Object.assign(new Error('live_memory_disabled'),{status:503});
}

export function personalizationPolicy(env,subject){
 const policy=personalizationControls(env,subject);
 return 'v1:'+['enabled','retrieval','writes','adaptive'].map(key=>policy[key]?'1':'0').join('')+(env.ORIGEN_GUIDED_CONVERSATION==='true'?':guided1':'')+(env.ORIGEN_CONVERSATION_CONTINUITY==='true'?':continuity1':'');
}
