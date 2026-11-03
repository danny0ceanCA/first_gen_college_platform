import {createPortal} from 'react-dom';
import {useLayoutEffect,useState} from 'react';
import {useDialogSurface} from './useDialogSurface';
import './LogoutTransition.css';

export type LogoutPhase='idle'|'leaving'|'returning'|'revealing'|'error';
export default function LogoutTransition({phase,canReturn,onRetry,onReturn,onCovered}:{phase:Exclude<LogoutPhase,'idle'>;canReturn:boolean;onRetry:()=>void;onReturn:()=>void;onCovered:()=>void}){
 const spanish=localStorage.getItem('origen.language')==='es';
 const t=(en:string,es:string)=>spanish?es:en;
 const {ref,dialogProps}=useDialogSurface({onDismiss:()=>{},blocked:true,animateDismiss:false});
 const failed=phase==='error';
 const [enter]=useState(phase==='leaving');
 useLayoutEffect(()=>{
  const node=ref.current;if(!node||phase!=='leaving')return;
  let active=true;
  // Observe the actual curtain, not a timer started before React has painted.
  // Reduced motion and retries on an already-opaque curtain resolve immediately.
  const covering=node.getAnimations().filter(animation=>animation instanceof CSSAnimation&&animation.animationName==='logout-cover');
  void Promise.all(covering.map(animation=>animation.finished.catch(()=>{}))).then(()=>{if(active)onCovered();});
  return()=>{active=false;};
 },[phase,onCovered,ref]);
 return createPortal(<dialog ref={ref} {...dialogProps} className="logout-transition" data-phase={phase} data-enter={enter} aria-labelledby="logout-heading" aria-describedby="logout-status" aria-busy={!failed&&phase!=='revealing'}>
  <div className="logout-transition-content">
   <span className="logout-transition-brand" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/></svg>origen.</span>
   <span className="logout-transition-rule" aria-hidden="true"/>
   <h1 id="logout-heading">{failed?t('Let’s finish signing out.','Terminemos de cerrar sesión.'):t('See you soon.','Hasta pronto.')}</h1>
   <p id="logout-status" role={failed?'alert':'status'}>{failed?t('Sign-out couldn’t be completed. Please try again.','No se pudo completar el cierre de sesión. Inténtalo de nuevo.'):phase==='revealing'?t('You’re signed out.','Has cerrado sesión.'):t('Signing you out…','Cerrando sesión…')}</p>
   {failed&&<div className="logout-transition-actions"><button className="button primary" onClick={onRetry}>{t('Try again','Intentar de nuevo')}</button>{canReturn&&<button className="text-button" onClick={onReturn}>{t('Back to my workspace','Volver a mi espacio')}</button>}</div>}
  </div>
 </dialog>,document.body);
}
