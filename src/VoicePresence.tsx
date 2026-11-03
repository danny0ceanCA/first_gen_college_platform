import VoiceWave from './VoiceWave';
import type {VoicePresenceState} from './voicePresenceState.mjs';
import './VoicePresence.css';

/** Decorative only: the adjacent status supplies the accessible state. */
export default function VoicePresence({state}:{state:VoicePresenceState}){
 return <span className="voice-presence" data-state={state} aria-hidden="true">
  <span className="voice-presence-halo"/>
  <svg className="voice-presence-ring" viewBox="0 0 64 64" focusable="false"><circle className="presence-track" cx="32" cy="32" r="23"/><circle className="presence-orbit" cx="32" cy="32" r="23"/><circle className="presence-inner" cx="32" cy="32" r="17"/></svg>
  <span className="voice-presence-wave"><VoiceWave speaking={state==='speaking'}/></span>
 </span>;
}
