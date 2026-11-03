import type {ButtonHTMLAttributes} from 'react';
import './VoiceStartButton.css';

/** The Origen ring is the control; the adjacent label keeps its purpose clear. */
export default function VoiceStartButton({label,pill=false,...props}:Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'> & {label:string;pill?:boolean}) {
 if(pill)return <button {...props} type="button" className="voice-start-control voice-start-pill" aria-label={label}><span className="voice-origen-button" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false"><circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="4"/></svg></span><span className="voice-start-label" aria-hidden="true">{label}</span></button>;
 return <span className="voice-start-control"><button {...props} type="button" className="voice-origen-button" aria-label={label} title={label}><svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="4"/></svg></button><span className="voice-start-label" aria-hidden="true">{label}</span></span>;
}
