import {useEffect,useRef,type ReactNode} from 'react';
import type {BinderTopic} from './binderSignals.mjs';

export default function BinderNoteHighlight({id,topic,fresh,suggested,onRead,children,memory=false}:{id:string;topic:BinderTopic;fresh:boolean;suggested:boolean;onRead:()=>void;children:ReactNode;memory?:boolean}){
 const element=useRef<HTMLElement>(null),read=useRef(onRead);read.current=onRead;
 useEffect(()=>{
  if(!fresh||!element.current)return;
  let visible=false,timer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{clearTimeout(timer);timer=undefined;};
  const update=()=>{stop();if(visible&&!document.hidden)timer=setTimeout(()=>read.current(),7000);};
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting===true&&entries[0].intersectionRatio>=.25;update();},{threshold:.25});
  observer.observe(element.current);document.addEventListener('visibilitychange',update);
  return()=>{stop();observer.disconnect();document.removeEventListener('visibilitychange',update);};
 },[id,fresh]);
 return <article ref={element} data-note-id={memory?undefined:id} data-memory-id={memory?id:undefined} className={`notebook-note divider-${topic}${memory?' memory-entry':''}${suggested?' notebook-suggestion':''}${fresh?' notebook-note-new':''}`}>{children}</article>;
}
