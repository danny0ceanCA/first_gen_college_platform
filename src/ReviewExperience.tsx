import {useEffect,useRef} from 'react';
import {ArrowLeft,ArrowRight,CheckCircle2} from 'lucide-react';
import './ReviewExperience.css';

export function focusReviewDetail(root:HTMLElement|null){
 requestAnimationFrame(()=>{
  const detail=root?.querySelector<HTMLElement>('.org-review-detail');
  const heading=detail?.querySelector<HTMLElement>('h2');
  if(!heading||!detail)return;
  heading.tabIndex=-1;heading.focus({preventScroll:true});
  if(window.matchMedia('(max-width:700px)').matches)detail.scrollIntoView({block:'start',behavior:'instant'});
 });
}

export function ReviewBack({es=false,onClick}:{es?:boolean;onClick:()=>void}){
 return <button className="button outline review-back-to-queue" onClick={onClick}><ArrowLeft size={16}/>{es?'Volver a la lista':'Back to queue'}</button>;
}

export function ReviewOutcome({message,es=false,busy=false,hasNext,onNext,continueLabel,onContinue}:{message:string;es?:boolean;busy?:boolean;hasNext:boolean;onNext:()=>void;continueLabel?:string;onContinue?:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[message]);
 return <article className="review-outcome"><CheckCircle2 size={30} aria-hidden="true"/><h2 ref={heading} tabIndex={-1}>{message}</h2><p role="status">{es?'La decisión está guardada.':'The decision is saved.'}</p><div className="institution-actions">{onContinue&&<button className="button primary" disabled={busy} onClick={onContinue}>{continueLabel}<ArrowRight size={16}/></button>}{hasNext&&<button className={`button ${onContinue?'outline':'primary'}`} disabled={busy} onClick={onNext}>{es?'Siguiente solicitud':'Next application'}<ArrowRight size={16}/></button>}</div>{!hasNext&&!onContinue&&<p>{es?'No quedan solicitudes en esta página. Puedes cambiar los filtros o revisar los registros aprobados.':'No applications remain on this page. You can change filters or view approved records.'}</p>}</article>;
}

// The final step is only complete when its own server state confirms it.
// An approved application does not by itself prove current workspace access.
export function RegistrationProgress({es=false,step,complete=false,kind='coordinator'}:{es?:boolean;step:number;complete?:boolean;kind?:'coordinator'|'organization'}){
 const labels=es?['Datos recibidos','Verificación','Revisión',kind==='organization'?'Página publicada':'Acceso al espacio']:['Details received','Verification','Review',kind==='organization'?'Page published':'Workspace access'];
 return <ol className="registration-progress" aria-label={es?'Progreso del registro':'Registration progress'}>{labels.map((label,index)=><li key={label} data-state={complete||index<step?'complete':index===step?'current':'upcoming'} aria-current={!complete&&index===step?'step':undefined}><span aria-hidden="true">{complete||index<step?<CheckCircle2 size={16}/>:index+1}</span><strong>{label}</strong><small>{complete||index<step?(es?'Completado':'Complete'):index===step?(es?'Paso actual':'Current step'):(es?'Pendiente':'Upcoming')}</small></li>)}</ol>;
}
