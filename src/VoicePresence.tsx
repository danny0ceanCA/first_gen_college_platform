import './VoicePresence.css';

/** Call presence only; speech and microphone activity never change the motion. */
export default function VoicePresence({active}:{active:boolean}){
 return <span className="voice-presence" data-active={active} aria-hidden="true">
  <span className="voice-presence-aura"/>
  <span className="voice-presence-halo"/>
  <svg className="voice-presence-ring" viewBox="0 0 72 72" focusable="false">
   <circle className="presence-track" cx="36" cy="36" r="31"/>
   <g className="presence-orbit presence-orbit-sage">
    <ellipse cx="36" cy="36" rx="29" ry="23"/>
    <circle className="presence-satellite" cx="7" cy="36" r="1.7"/>
   </g>
   <g className="presence-orbit presence-orbit-copper">
    <ellipse cx="36" cy="36" rx="29" ry="23"/>
    <circle className="presence-satellite" cx="65" cy="36" r="1.5"/>
   </g>
   <circle className="presence-core-edge" cx="36" cy="36" r="18.5"/>
   <circle className="presence-core" cx="36" cy="36" r="16"/>
   <path className="presence-highlight" d="M24 32a13 13 0 0 1 15-9"/>
  </svg>
 </span>;
}
