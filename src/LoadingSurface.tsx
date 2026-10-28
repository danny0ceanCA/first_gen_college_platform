import {Component,Suspense,useEffect,useState,type ReactNode} from 'react';
import {useArrivalPending} from './arrivalReadiness';
import './LoadingSurface.css';

type Layout='workspace'|'cards'|'list'|'form';
export function LoadingSurface({layout='cards'}:{layout?:Layout}){
 useArrivalPending(true);
 const [slow,setSlow]=useState(false);
 const es=localStorage.getItem('origen.language')==='es';
 useEffect(()=>{const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[]);
 return <section className={`loading-surface loading-${layout}`} aria-busy={!slow}>
  <span className="loading-announcement" role="status">{es?'Cargando contenido…':'Loading content…'}</span>
  <div className="loading-outline" aria-hidden="true"><i className="loading-title"/><i className="loading-subtitle"/><div className="loading-blocks">{[0,1,2].map(i=><div key={i}><i/><i/><i/></div>)}</div></div>
  {slow&&<LoadRetry/>}
 </section>;
}
function LoadRetry(){
 const es=localStorage.getItem('origen.language')==='es';
 return <div className="loading-retry" role="alert"><p>{es?'No se pudo abrir este contenido. Revisa tu conexión y vuelve a cargar la página.':'This content could not open. Check your connection and reload the page.'}</p><button className="button outline" onClick={()=>window.location.reload()}>{es?'Volver a cargar':'Reload page'}</button></div>;
}
class ModuleBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<LoadRetry/>:this.props.children;}
}
// Only the requested panel suspends; its surrounding navigation stays available.
export default function WorkspaceModule({children,layout='cards'}:{children:ReactNode;layout?:Layout}){
 return <ModuleBoundary><Suspense fallback={<LoadingSurface layout={layout}/>}>{children}</Suspense></ModuleBoundary>;
}
