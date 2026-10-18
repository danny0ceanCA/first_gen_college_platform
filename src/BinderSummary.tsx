import {useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight} from 'lucide-react';
import {binderSummaryPages} from './binderSummary.mjs';

function writtenText(text:string){
 return text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).map((part,index)=>/^(?:\*\*[^*]+\*\*|__[^_]+__)$/.test(part)?<strong key={index}>{part.slice(2,-2)}</strong>:part);
}

export default function BinderSummary({summary,language,t}:{summary:string;language:'en'|'es';t:(en:string,es:string)=>string}){
 const pages=useMemo(()=>binderSummaryPages(summary,language),[summary,language]);
 const [position,setPosition]=useState({summary,index:0});
 const page=position.summary===summary?Math.min(position.index,Math.max(0,pages.length-1)):0;
 const sheet=useRef<HTMLDivElement>(null),turnPending=useRef(false),id=useId();
 useLayoutEffect(()=>{
  if(!turnPending.current||!sheet.current)return;
  turnPending.current=false;
  sheet.current.focus({preventScroll:true});
  const top=sheet.current.getBoundingClientRect().top;
  if(top<24)window.scrollTo({top:Math.max(0,window.scrollY+top-24),behavior:'instant'});
 },[page,summary]);
 function turn(index:number){
  turnPending.current=true;
  setPosition({summary,index});
 }
 return <div className="binder-summary-reader">
  <div className="binder-summary-writing" id={id} ref={sheet} tabIndex={-1} role="region" aria-label={t(`Summary, page ${page+1} of ${Math.max(1,pages.length)}`,`Resumen, página ${page+1} de ${Math.max(1,pages.length)}`)} lang={language}>
   {pages[page]?.map((block,index)=>block.type==='heading'?<h4 key={index}>{writtenText(block.text)}</h4>:<p key={index} className={block.type==='note'?'binder-summary-note':undefined}>{writtenText(block.text)}</p>)}
  </div>
  {pages.length>1&&<nav className="binder-summary-pagination" aria-label={t('Summary pages','Páginas del resumen')}>
   <button type="button" disabled={page===0} aria-controls={id} onClick={()=>turn(page-1)}><ArrowLeft size={16} aria-hidden="true"/><span>{t('Previous','Anterior')}</span></button>
   <span role="status">{t(`Page ${page+1} of ${pages.length}`,`Página ${page+1} de ${pages.length}`)}</span>
   <button type="button" disabled={page===pages.length-1} aria-controls={id} onClick={()=>turn(page+1)}><span>{t('Next','Siguiente')}</span><ArrowRight size={16} aria-hidden="true"/></button>
  </nav>}
 </div>;
}
