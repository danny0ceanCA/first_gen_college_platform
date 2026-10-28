import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {motionDuration,motionEasing} from './motion';
import {ArrowLeft,BarChart3,BookOpen,Building2,CalendarDays,Home,Inbox,LogOut,Menu,Megaphone,Users,X} from 'lucide-react';
import './OrganizationWorkspaceFrame.css';

export const organizationSections=[['overview','Overview','Resumen'],['page','Public page','Página pública'],['programs','Programs and events','Programas y eventos'],['insights','Insights','Estadísticas'],['inquiries','Inquiry inbox','Bandeja de solicitudes'],['campaigns','Campaigns','Campañas'],['settings','Team and settings','Equipo y ajustes']] as const;
const icons=[Home,BookOpen,CalendarDays,BarChart3,Inbox,Megaphone,Users];

export default function OrganizationWorkspaceFrame({children,signedIn,es,tab,onTab,onLanguage,onLogout,canLeave,coordinatorEnabled,outreach}:{children:ReactNode;signedIn:boolean;es:boolean;tab:string;onTab:(tab:string)=>boolean;onLanguage:()=>void;onLogout:()=>void;canLeave:()=>boolean;coordinatorEnabled:boolean;outreach:boolean}){
 const [open,setOpen]=useState(false),toggle=useRef<HTMLButtonElement>(null);
 const content=useRef<HTMLDivElement>(null);
 const t=(en:string,sp:string)=>es?sp:en;
 useEffect(()=>{setOpen(false);},[tab]);
 useLayoutEffect(()=>{
  const duration=motionDuration('section');
  if(!duration||!content.current)return;
  const animation=content.current.animate([{opacity:.4,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration,easing:motionEasing()});
  return()=>animation.cancel();
 },[tab,signedIn]);
 const linkGuard=(e:React.MouseEvent)=>{if(!canLeave())e.preventDefault();};
 if(!signedIn)return <div className="institution-portal"><header className="institution-header"><a href="#" className="institution-logo">○ origen.</a><span>{t('For organizations','Para organizaciones')}</span><button className="text-button" onClick={onLanguage}>{es?'English':'Español'}</button></header><main className="institution-shell">{children}</main></div>;
 return <div className="institution-portal organization-workspace">
  <aside className="organization-sidebar" onKeyDown={e=>{if(e.key==='Escape'&&open){setOpen(false);toggle.current?.focus();}}}>
   <div className="organization-sidebar-brand"><a className="institution-logo" href="#" onClick={linkGuard}>○ origen.</a><button ref={toggle} className="organization-menu-toggle" aria-label={t('Organization menu','Menú de organización')} aria-expanded={open} aria-controls="organization-navigation" onClick={()=>setOpen(!open)}>{open?<X/>:<Menu/>}</button></div>
   <p className="organization-sidebar-caption">{t('ORGANIZATION WORKSPACE','ESPACIO DE ORGANIZACIÓN')}</p>
   <div id="organization-navigation" className="organization-navigation" data-open={open}>
    <nav aria-label={t('Organization sections','Secciones de la organización')}>{organizationSections.map(([key,en,sp],index)=>{if(['inquiries','campaigns'].includes(key)&&!outreach)return null;const Icon=icons[index];return <button key={key} data-navigation-focus={`organization-${key}`} aria-current={tab===key?'page':undefined} onClick={()=>{if(onTab(key)){setOpen(false);requestAnimationFrame(()=>{const heading=content.current?.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}});}}}><Icon size={19}/><span>{t(en,sp)}</span></button>;})}</nav>
    <footer>{coordinatorEnabled&&<a href="#coordinators" onClick={linkGuard}><Users size={18}/>{t('Coordinator workspace','Espacio del coordinador')}</a>}<a href="#" onClick={linkGuard}><ArrowLeft size={18}/>{t('Origen home','Inicio de Origen')}</a><button onClick={onLogout}><LogOut size={18}/>{t('Log out','Cerrar sesión')}</button></footer>
   </div>
  </aside>
  <main className="institution-shell organization-workspace-main"><div className="organization-context"><span><Building2 size={16}/>{t('Origen / Organization workspace','Origen / Espacio de organización')}</span><button className="button outline" onClick={onLanguage}>{es?'English':'Español'}</button></div><div ref={content} className="organization-section-content">{children}</div></main>
 </div>;
}
