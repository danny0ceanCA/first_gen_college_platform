import {useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
export function recordInstitutionMetric(slug:string,metric:'page_view'|'link_click',linkIndex?:number){
 // No identity/token, URL, referrer, cookies or persistent visitor identifier.
 void fetch(`${(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')}/api/institution-metrics/event`,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,metric,...(linkIndex===undefined?{}:{linkIndex})})}).catch(()=>{});
}
type Report={month:string;pageViews:number|null;linkClicks:number|null};
export default function InstitutionMetrics({id,es}:{id:string;es:boolean}){
 const {getAccessTokenSilently}=useAuth0();const [report,setReport]=useState<Report>(),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const t=(en:string,sp:string)=>es?sp:en;
 async function load(){setBusy(true);setError(false);try{
  const token=await getAccessTokenSilently();const r=await fetch(`${(import.meta.env.VITE_API_URL||'').replace(/\/$/,'')}/api/institution-metrics/report`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({id})});if(!r.ok)throw new Error();setReport(await r.json());
 }catch{setError(true);}finally{setBusy(false);}}
 return <section aria-label={t('Page engagement','Interacción con la página')}><button className="button outline" disabled={busy} onClick={()=>void load()}>{t('View engagement totals','Ver totales de interacción')}</button>{busy&&<p role="status">{t('Loading…','Cargando…')}</p>}{error&&<p role="alert">{t('Could not load totals. Try again.','No se pudieron cargar los totales. Intenta de nuevo.')}</p>}{report&&<><h3>{t('Last completed month','Último mes completo')}: {report.month} (UTC)</h3><p>{t('Page views','Visitas a la página')}: {report.pageViews??t('Below reporting threshold','Por debajo del mínimo de reporte')}</p><p>{t('Link clicks','Clics en enlaces')}: {report.linkClicks??t('Below reporting threshold','Por debajo del mínimo de reporte')}</p><p className="small-text">{t('Counts below 10 are withheld. Counts include repeat activity and may include bots; they do not measure unique people or applications.','Se ocultan los conteos menores de 10. Los conteos incluyen actividad repetida y pueden incluir bots; no representan personas únicas ni solicitudes.')}</p></>}</section>;
}
