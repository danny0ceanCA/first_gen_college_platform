import './VoicePresence.css';

/** Call presence only; speech and microphone activity never change the motion. */
export default function VoicePresence({active}:{active:boolean}){
 return <span className="voice-presence" data-active={active} aria-hidden="true">
  <span className="voice-presence-halo"/>
  <svg className="voice-presence-ring" viewBox="0 0 64 64" focusable="false"><circle className="presence-track" cx="32" cy="32" r="27"/><circle className="presence-orbit" cx="32" cy="32" r="21"/></svg>
 </span>;
}
