import {useLayoutEffect,useRef} from 'react';
import {animate,stagger} from 'animejs';
import {onboardingInk} from './onboardingInk.mjs';

/** A confirmed field, not a streaming transcript. Updates never remount the voice session. */
export default function WelcomeWriting({text}:{text:string}){
 const root=useRef<HTMLDivElement>(null);
 const previous=useRef('');
 const change=onboardingInk(previous.current,text),oldText=previous.current;
 useLayoutEffect(()=>{
  previous.current=text;
  const node=root.current;if(!node)return;
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const words=node.querySelectorAll('[data-new-ink=true]');
  const line=node.querySelector('.welcome-ink-line');
  const ghost=node.querySelector('.welcome-ink-previous');
  if(media.matches)return;
  const writing=animate(words,{opacity:[0,1],translateY:['.12em','0em'],duration:460,delay:stagger(Math.min(28,140/Math.max(1,words.length)),{start:ghost?90:0}),ease:'outCubic'});
  const stroke=animate(line!,{scaleX:[.8,1],opacity:[.2,.55],duration:640,ease:'outCubic'});
  const glow=animate(node,{backgroundColor:['rgba(244,238,228,.12)','rgba(244,238,228,0)'],duration:1100,ease:'outCubic'});
  const correction=ghost?animate(ghost,{opacity:[.35,0],translateY:[0,'-.12em'],duration:160,ease:'outCubic'}):null;
  const stop=()=>{if(media.matches){writing.complete();stroke.complete();glow.complete();correction?.complete();}};
  media.addEventListener('change',stop);
  return()=>{writing.revert();stroke.revert();glow.revert();correction?.revert();media.removeEventListener('change',stop);};
 },[text]);
 return <div ref={root} className="welcome-ink" data-ink-change={change.correction?'correction':'addition'}><p><span className="welcome-accessible-writing">{text}</span><span aria-hidden="true">{change.tokens.map((word,i)=>/^\s+$/.test(word)?word:<span className="welcome-ink-word" data-new-ink={i>=change.start&&i<change.end} key={i}>{word}</span>)}</span></p>{change.correction&&oldText&&<span className="welcome-ink-previous" aria-hidden="true">{oldText}</span>}<span className="welcome-ink-line" aria-hidden="true"/></div>;
}
