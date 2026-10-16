import {useEffect,useState} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';

export function ErrorReference({reference,language='en'}:{reference?:string;language?:'en'|'es'}){
 const [lease]=useState(()=>browserPrivacy.capture()),[ended,setEnded]=useState(false),[state,setState]=useState<'ready'|'copied'|'failed'>('ready');
 useEffect(()=>{const unsubscribe=browserPrivacy.subscribe(event=>{if(event.type==='end'){setEnded(true);setState('ready');}});return()=>{unsubscribe();lease.release();};},[lease]);
 useEffect(()=>setState('ready'),[reference]);
 if(!reference||ended||!lease.valid())return null;
 const es=language==='es';
 return <span className="error-reference"><button type="button" className="text-button" onClick={()=>{
  if(!lease.valid())return;
  if(!navigator.clipboard?.writeText){setState('failed');return;}
  void navigator.clipboard.writeText(reference).then(()=>{if(lease.valid())setState('copied');},()=>{if(lease.valid())setState('failed');});
 }}>{es?'Copiar referencia del error':'Copy error reference'}</button><span role="status">{state==='copied'?(es?' Referencia copiada.':' Reference copied.'):state==='failed'?(es?` Referencia: ${reference}`:` Reference: ${reference}`):''}</span></span>;
}
