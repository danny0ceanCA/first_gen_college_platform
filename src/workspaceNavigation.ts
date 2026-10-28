import {useCallback,useLayoutEffect,useRef,useSyncExternalStore,type SetStateAction} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';

// History contains navigation only. Never put API responses, drafts or tokens here.
// Screens must load restored identifiers through their usual authorized API reads.
// Wrap user navigation in navigateWorkspace for one Back/Forward step. Direct
// setters replace the current entry (typing, server reconciliation, voice follow).
// Keep related selections inside the transaction so cancelling a dirty guard
// cannot partially change the destination. guard:false is for confirmed leaves
// and successful save/delete callbacks, never an unguarded user navigation path.
type Entry={version:1;chain:string;index:number;owner:string;url:string;values:Record<string,unknown>;x:number;y:number;focus?:string};
type Options={replace?:boolean;scroll?:'top'|'preserve';url?:string;guard?:boolean;from?:{x:number;y:number;focus?:string}};
type Guard={dirty:boolean;locked:boolean;leave?:()=>void};
const key='origenNavigation',listeners=new Set<()=>void>(),guards=new Map<symbol,Guard>();
let current:Entry|undefined,revision=0,started=false,transaction:Record<string,unknown>|undefined;
let rollback:Entry|undefined,restoreStop:(()=>void)|undefined,scrollTimer:number|undefined;
const owner=()=>browserPrivacy.subject||'public';
const record=(value:unknown):value is Entry=>!!value&&typeof value==='object'&&(value as Entry).version===1&&typeof (value as Entry).chain==='string'&&Number.isSafeInteger((value as Entry).index)&&typeof (value as Entry).owner==='string'&&typeof (value as Entry).url==='string'&&!!(value as Entry).values&&typeof (value as Entry).values==='object'&&!Array.isArray((value as Entry).values)&&Number.isFinite((value as Entry).x)&&Number.isFinite((value as Entry).y);
const fresh=(index=0,chain:string=crypto.randomUUID()):Entry=>({version:1,chain,index,owner:owner(),url:location.href,values:{},x:0,y:0});
function write(entry:Entry,push=false){window.history[push?'pushState':'replaceState']({...window.history.state,[key]:entry},'',entry.url);}
function emit(){revision++;listeners.forEach(listener=>listener());}
function focusSelector(){const el=document.activeElement as HTMLElement|null;if(!el||el===document.body)return undefined;const id=el.getAttribute('data-navigation-focus');if(id)return `[data-navigation-focus="${CSS.escape(id)}"]`;const binder=el.getAttribute('data-binder-id');if(binder)return `[data-binder-id="${CSS.escape(binder)}"]`;return el.id?`#${CSS.escape(el.id)}`:undefined;}
function capture(){if(!current||rollback||restoreStop||current.url!==location.href)return;current={...current,x:window.scrollX,y:window.scrollY,focus:focusSelector()};write(current);}
function restore(entry:Entry){
 restoreStop?.();
 let frame=0,stopped=false;const until=performance.now()+5000;
 const stop=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);observer.disconnect();for(const event of ['wheel','touchstart','pointerdown','keydown'])window.removeEventListener(event,stop,true);if(restoreStop===stop)restoreStop=undefined;};
 const attempt=()=>{if(stopped)return;window.scrollTo({left:entry.x||0,top:entry.y||0,behavior:'instant'});let target:HTMLElement|null=null;try{target=entry.focus?document.querySelector<HTMLElement>(entry.focus):null;}catch{}const visible=target&&target.getClientRects().length>0&&!target.closest('[hidden],[inert]');if(visible&&target)target.focus({preventScroll:true});if((Math.abs(window.scrollY-(entry.y||0))<2&&(!entry.focus||visible))||performance.now()>until)stop();};
 const observer=new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(attempt);});
 observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','inert','aria-busy']});
 for(const event of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(event,stop,true);
 restoreStop=stop;frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(attempt);});window.setTimeout(stop,5100);
}
export function confirmWorkspaceNavigation(){
 const active=[...guards.values()];if(active.some(g=>g.locked))return false;
 if(!active.some(g=>g.dirty))return true;
 const es=document.documentElement.lang.startsWith('es');
 if(!window.confirm(es?'¿Salir y descartar los cambios sin guardar? Elige Cancelar para quedarte y guardarlos.':'Leave and discard unsaved changes? Choose Cancel to stay and save them.'))return false;
 active.filter(g=>g.dirty).forEach(g=>g.leave?.());return true;
}
function start(){
 if(started)return;started=true;
 const stored=window.history.state?.[key];current=record(stored)&&stored.url===location.href?stored:fresh();write(current);
 window.history.scrollRestoration='manual';
 if(record(stored)&&stored.owner===owner())restore(stored);
 window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=window.setTimeout(capture,100);},{passive:true});
 window.addEventListener('pagehide',capture);
 window.addEventListener('popstate',event=>{
  if(rollback){current=rollback;rollback=undefined;event.stopImmediatePropagation();write(current);return;}
  const stored=event.state?.[key],next=record(stored)?stored:fresh((current?.index||0)+1,current?.chain);
  if(!confirmWorkspaceNavigation()){
   event.stopImmediatePropagation();restoreStop?.();
   if(current&&record(stored)&&next.chain===current.chain&&next.index!==current.index){rollback=current;window.history.go(current.index-next.index);}
   else if(current){current={...current,chain:crypto.randomUUID(),index:0};write(current,true);}
   return;
  }
  current=next.owner===owner()?{...next,url:location.href}:{...fresh(next.index,next.chain),url:location.href};write(current);emit();restore(current);
 },true);
 window.addEventListener('hashchange',event=>{
  if(rollback){event.stopImmediatePropagation();return;}
  // popstate runs first for history traversal. Hash-only navigation is adopted here.
  if(current?.url===location.href)return;
  current=fresh((current?.index||0)+1,current?.chain);write(current);emit();
 },true);
 document.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const anchor=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');if(!anchor||anchor.target||anchor.hasAttribute('download')||anchor.hasAttribute('data-navigation-ignore'))return;
  const url=new URL(anchor.href,location.href);
  if(url.origin!==location.origin||url.pathname!==location.pathname||url.search!==location.search||!/^#(?:app|personal|admin|institutions|coordinators|coordinator-register)?$/.test(url.hash||'#'))return;
  event.preventDefault();event.stopPropagation();
  if(url.href!==location.href)navigateWorkspace(()=>{}, {url:url.href,scroll:'top'});
 },true);
 window.addEventListener('beforeunload',event=>{if([...guards.values()].some(g=>g.dirty||g.locked)){event.preventDefault();event.returnValue='';}});
 browserPrivacy.subscribe(event=>{if(event.type==='end'){restoreStop?.();transaction=undefined;current=fresh(current?.index,current?.chain);write(current);emit();}});
}
function owned(){start();if(current!.owner!==owner()){current={...fresh(current!.index,current!.chain),url:location.href};write(current);}return current!;}
export function navigateWorkspace(change:()=>void,{replace=false,scroll='preserve',url,guard=true,from}:Options={}){
 owned();if(rollback)return false;
 if(guard&&!confirmWorkspaceNavigation())return false;
 capture();restoreStop?.();if(from){current={...current!,...from};write(current);}const before=current!;
 transaction={...before.values};
 try{change();const nextValues=transaction;const destination=url||before.url;
  if(JSON.stringify(before.values)===JSON.stringify(nextValues)&&destination===before.url)return true;
  current={...before,index:replace?before.index:before.index+1,url:destination,values:destination===before.url?nextValues:{},x:scroll==='top'?0:before.x,y:scroll==='top'?0:before.y,focus:scroll==='top'?undefined:before.focus};
  write(current,!replace);emit();
  if(destination!==before.url)window.dispatchEvent(new HashChangeEvent('hashchange'));
  if(scroll==='top')requestAnimationFrame(()=>{document.querySelector<HTMLElement>('main h1')?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});});
  return true;
 }finally{transaction=undefined;}
}
export function useNavigationState<T>(name:string,initial:T|(()=>T),valid?:(value:unknown)=>value is T):[T,(value:SetStateAction<T>)=>void]{
 const defaults=useRef<{name:string;value:T}|undefined>(undefined);if(defaults.current?.name!==name)defaults.current={name,value:typeof initial==='function'?(initial as ()=>T)():initial};
 const fallback=defaults.current.value;owned();
 useSyncExternalStore(useCallback(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},[]),()=>revision,()=>0);
 const value=owned().values[name];const accepted=value!==undefined&&(!valid||valid(value))?value as T:fallback;
 const latest=useRef({fallback,valid});latest.current={fallback,valid};
 const set=useCallback((update:SetStateAction<T>)=>{
  const values=transaction||owned().values,old=values[name],previous=old!==undefined&&(!latest.current.valid||latest.current.valid(old))?old as T:latest.current.fallback;
  const next=typeof update==='function'?(update as (v:T)=>T)(previous):update;
  if(JSON.stringify(previous)===JSON.stringify(next))return;
  if(transaction){transaction[name]=next;return;}
  current={...owned(),values:{...owned().values,[name]:next}};write(current);emit();
 },[name]);
 return [accepted,set];
}
export function useNavigationGuard(dirty:boolean,{locked=false,onLeave}:{locked?:boolean;onLeave?:()=>void}={}){
 const id=useRef(Symbol('navigation guard')),latest=useRef({dirty,locked,leave:onLeave});latest.current={dirty,locked,leave:onLeave};
 useLayoutEffect(()=>{start();guards.set(id.current,latest.current);return()=>{guards.delete(id.current);};},[]);
 useLayoutEffect(()=>{guards.set(id.current,latest.current);});
}
export const navigationEnum=<T extends string>(...values:T[])=>(value:unknown):value is T=>typeof value==='string'&&values.includes(value as T);
export const navigationText=(value:unknown):value is string=>typeof value==='string'&&value.length<=500;
