import {useEffect,useState,useRef} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {browserPrivacy} from './browserPrivacy.mjs';
import {activeCheckpoints,recoveryChoice,recoveryRequest} from './conversationRecovery';
import {useConversationHistory} from './ConversationHistory';
type Copy={id:string;studentId:string|null;mode:string;status:string;sequence:number;expiresAt:string};
type Review=Copy&{body:any;contextRevision:number;needsReview:boolean};
export default function ConversationRecovery({studentId,t}:{studentId:string|null;t:(en:string,es:string)=>string}){
 const {isAuthenticated,user}=useAuth0();const history=useConversationHistory();const completed=useRef(new Set<string>());
 const [enabled,setEnabled]=useState(false),[items,setItems]=useState<Copy[]>([]),[review,setReview]=useState<Review>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
 async function refresh(){const data=await recoveryRequest({action:'status'});recoveryChoice.available=data.enabled;recoveryChoice.epoch=data.epoch||0;setEnabled(data.enabled);setItems(data.items||[]);for(const item of data.items||[])if(item.status==='complete'&&!completed.current.has(item.id)){completed.current.add(item.id);history.reload();}return data;}
 useEffect(()=>{
  if(!isAuthenticated)return;
  let active=true,timer:ReturnType<typeof setTimeout>;recoveryChoice.stopping=false;
  const load=async()=>{if(!active||!browserPrivacy.valid())return;try{const data=await refresh();if(active&&(data.enabled||data.items?.length))timer=setTimeout(()=>void load(),5000);}catch{/* No hidden retry loop when the feature is unavailable. */}};void load();
  const off=browserPrivacy.subscribe(event=>{setItems([]);setReview(undefined);});
  return()=>{active=false;clearTimeout(timer);off();};
 },[isAuthenticated,user?.sub]);
 useEffect(()=>{setReview(undefined);setConfirmed(false);setError('');},[studentId]);
 async function act(work:()=>Promise<void>){setBusy(true);setError('');try{await work();await refresh();}catch{setError(t('Could not confirm that change. Retry while this copy is still available.','No pudimos confirmar el cambio. Reintenta mientras esta copia esté disponible.'));}finally{setBusy(false);}}
 if(!isAuthenticated||!enabled&&!items.length)return null;
 const copies=items.filter(item=>item.studentId===studentId&&!activeCheckpoints.has(item.id)&&(item.status!=='complete'||!history.items.some(saved=>saved.id===item.id)));
 if(!copies.length)return null;
 return <aside className="conversation-recovery" aria-label={t('Conversation recovery','Recuperación de conversaciones')}>
  {copies.map(item=><div key={item.id}>
   <p>{item.status==='complete'?t('Recovered conversation summary saved.','Resumen recuperado guardado.'):['pending','running'].includes(item.status)?t('Your recovered conversation is being saved.','Se está guardando tu conversación recuperada.'):t('An unfinished conversation is available until ','Hay una conversación sin terminar disponible hasta ')}{!['complete','pending','running'].includes(item.status)&&new Date(item.expiresAt).toLocaleString()}</p>
   {!['complete','pending','running'].includes(item.status)&&<button type="button" className="button outline" disabled={busy} onClick={()=>void act(async()=>{const value=await recoveryRequest({action:'read',id:item.id});setReview(value);setConfirmed(false);})}>{t('Review conversation','Revisar conversación')}</button>}
   {item.status!=='complete'&&<button type="button" className="text-button" disabled={busy} onClick={()=>void act(async()=>{await recoveryRequest({action:'discard',id:item.id});if(review?.id===item.id)setReview(undefined);})}>{t('Discard recovery copy','Descartar copia de recuperación')}</button>}
  </div>)}
  {review?.body&&review.studentId===studentId&&<div role="region" aria-label={t('Review recovered discussion','Revisar conversación recuperada')}>
   <p>{review.needsReview?t('Your binder changed. Remove outdated or unwanted details below before saving. This review will create a new summary and may organize new binder suggestions.','Tu carpeta cambió. Elimina los detalles antiguos o no deseados antes de guardar. Esta revisión creará un resumen y puede organizar nuevas sugerencias en tu carpeta.'):t('Review what was captured. You can remove any part before saving its summary.','Revisa lo que se capturó. Puedes quitar cualquier parte antes de guardar su resumen.')}</p>
   <div className="recovery-transcript">{review.body.turns.map((turn:{role:string;text:string},i:number)=><div key={i}><strong>{turn.role==='user'?t('You','Tú'):'Origen'}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{turn.text}</p><button type="button" className="text-button" disabled={busy} onClick={()=>{setConfirmed(false);setReview({...review,body:{...review.body,turns:review.body.turns.filter((_:unknown,j:number)=>i!==j)}});}}>{t('Remove this part','Quitar esta parte')}</button></div>)}</div>
   <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{t('I checked these details against my current binder. Save the remaining discussion.','Revisé estos detalles con mi carpeta actual. Guardar el resto de la conversación.')}</label>
   <button type="button" className="button primary" disabled={busy||!enabled||!confirmed||!review.body.turns.some((turn:{role:string})=>turn.role==='user')} onClick={()=>void act(async()=>{
    const result=await recoveryRequest({action:'review',id:review.id,sequence:review.sequence+1,epoch:recoveryChoice.epoch,contextRevision:review.contextRevision,reviewed:true,body:review.body});
    await recoveryRequest({action:'finalize',id:result.id,sequence:result.sequence});setReview(undefined);
   })}>{t('Save reviewed summary','Guardar resumen revisado')}</button>
   <button type="button" className="text-button" disabled={busy} onClick={()=>setReview(undefined)}>{t('Close review','Cerrar revisión')}</button>
  </div>}
  {error&&<p role="alert">{error}</p>}
 </aside>;
}
