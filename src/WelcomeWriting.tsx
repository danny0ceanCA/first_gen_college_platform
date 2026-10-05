import {useEffect,useRef} from 'react';
import {animate,stagger} from 'animejs';

/** A confirmed field, not a streaming transcript. Updates never remount the voice session. */
export default function WelcomeWriting({text}:{text:string}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const node=root.current;if(!node)return;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const letters=node.querySelectorAll('.welcome-ink-letter');
  const line=node.querySelector('.welcome-ink-line');
  if(media.matches)return;
  const writing=animate(letters,{opacity:[0,1],translateY:['.16em','0em'],filter:['blur(2px)','blur(0px)'],duration:560,delay:stagger(Math.min(24,1500/Math.max(1,letters.length))),ease:'outCubic'});
  const stroke=animate(line!,{scaleX:[0,1],opacity:[0,.55],duration:1300,ease:'inOutSine'});
  const stop=()=>{if(media.matches){writing.complete();stroke.complete();}};
  media.addEventListener('change',stop);
  return()=>{writing.revert();stroke.revert();media.removeEventListener('change',stop);};
 },[text]);
 return <div ref={root} className="welcome-ink"><p><span className="welcome-accessible-writing">{text}</span><span aria-hidden="true">{text.split(/(\s+)/).map((word,i)=>/^\s+$/.test(word)?word:<span className="welcome-ink-word" key={i}>{Array.from(word).map((letter,j)=><span className="welcome-ink-letter" key={j}>{letter}</span>)}</span>)}</span></p><span className="welcome-ink-line" aria-hidden="true"/></div>;
}
