import {useRef} from 'react';
import english from './privacyNotice.en.json';
import spanish from './privacyNotice.es.json';
import './PrivacyNotice.css';

type Block=['p'|'h'|'sub'|'meta',string]|['table',string[][]]|['links',[string,string][]];
type Section=[string,Block[]];
const contact='daniel@origenedu.ai';

export default function PrivacyNotice({t}:{t:(en:string,es:string)=>string}){
 const es=t('en','es')==='es';
 const sections=(es?spanish:english) as Section[];
 const headings=useRef<(HTMLHeadingElement|null)[]>([]);
 // Keep #privacy as the public route; section navigation must not change it.
 const jump=(index:number)=>{const heading=headings.current[index];heading?.focus({preventScroll:true});heading?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
 return <article id="privacy" className="privacy-notice" aria-label={t('Origen Edu privacy notice','Aviso de privacidad de Origen Edu')}>
  <aside className="privacy-contact"><strong>{t('Privacy questions or deletion requests','Preguntas de privacidad o solicitudes de eliminación')}</strong><a href={`mailto:${contact}`}>{contact}</a></aside>
  <nav className="privacy-contents" aria-label={t('Privacy notice contents','Contenido del aviso de privacidad')}><h2>{t('In this notice','En este aviso')}</h2><ol>{sections.slice(1).map(([title],i)=><li key={i}><button type="button" onClick={()=>jump(i+1)}>{title.replace(/^\d+\.\s*/,'')}</button></li>)}</ol></nav>
  {sections.map(([title,blocks],index)=><section key={index} className="privacy-section" aria-labelledby={`privacy-section-${index}`}>
   <h2 id={`privacy-section-${index}`} tabIndex={-1} ref={element=>{headings.current[index]=element;}}>{title}</h2>
   {blocks.map(([kind,value],i)=>{
    if(kind==='h')return <h3 key={i}>{value as string}</h3>;
    if(kind==='table')return <div className="privacy-table-wrap" key={i}><table><caption className="privacy-sr-only">{title}: {t('information and processing details','información y detalles del tratamiento')}</caption><thead><tr>{(value as string[][])[0].map((cell,j)=><th key={j} scope="col">{cell}</th>)}</tr></thead><tbody>{(value as string[][]).slice(1).map((row,j)=><tr key={j}>{row.map((cell,k)=>k===0?<th scope="row" key={k}>{cell}</th>:<td key={k}>{cell}</td>)}</tr>)}</tbody></table></div>;
    if(kind==='links')return <ul className="privacy-provider-links" key={i}>{(value as [string,string][]).map(([label,url])=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{label}<span className="privacy-sr-only"> {t('(opens a new tab)','(abre una pestaña nueva)')}</span></a></li>)}</ul>;
    return <p key={i} className={kind==='meta'?'privacy-updated':kind==='sub'?'privacy-lede':undefined}>{value as string}</p>;
   })}
  </section>)}
 </article>;
}
