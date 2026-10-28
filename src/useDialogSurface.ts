import {useCallback,useLayoutEffect,useRef,type KeyboardEvent,type PointerEvent,type SyntheticEvent} from 'react';
import {motionDuration,motionEasing,motionPreference} from './motion';
import './DialogSurface.css';

let locks = 0;
let previousOverflow = '';
function lockPage() {
  if (locks++ === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  return () => { if (--locks === 0) document.body.style.overflow = previousOverflow; };
}

/** Native top-layer modality, nested scroll locks and one dismissal/focus policy.
 * Parent unmounts (including privacy/access changes) always bypass the exit motion.
 */
export function useDialogSurface({onDismiss,blocked=false,open=true,animateDismiss=true,beforeDismiss}:{beforeDismiss?:()=>boolean;onDismiss:()=>void|Promise<void>;blocked?:boolean;open?:boolean;animateDismiss?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  const latest=useRef({onDismiss,blocked,animateDismiss,beforeDismiss});latest.current={onDismiss,blocked,animateDismiss,beforeDismiss};
  const animation=useRef<Animation|null>(null),epoch=useRef(0),closing=useRef(false),outside=useRef(false);
  useLayoutEffect(()=>{
    const node=ref.current;if(!node||!open)return;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const unlock=lockPage();closing.current=false;
    node.showModal();
    // Focus the surface, not a text input: mobile keyboards should open on intent.
    node.focus({preventScroll:true});
    const preference=window.matchMedia(motionPreference);
    const reduce=()=>{if(preference.matches)animation.current?.finish();};
    preference.addEventListener('change',reduce);
    return()=>{
      epoch.current++;animation.current?.cancel();animation.current=null;closing.current=false;
      preference.removeEventListener('change',reduce);node.close();unlock();
      // Do not steal focus from another dialog opened by the same action.
      const top=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
      if(opener?.isConnected&&(!top||top.contains(opener)))opener.focus({preventScroll:true});
    };
  },[open]);
  const dismiss=useCallback(async()=>{
    const node=ref.current;if(!node?.open||latest.current.blocked||closing.current)return;
    if(latest.current.beforeDismiss&&!latest.current.beforeDismiss())return;
    closing.current=true;const current=epoch.current;
    const duration=latest.current.animateDismiss?motionDuration('exit'):0;
    try {
      if(duration){
        animation.current=node.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateY(6px)'}],{duration,easing:motionEasing('exit'),fill:'forwards'});
        await animation.current.finished;
      }
      if(current===epoch.current&&!latest.current.blocked)await latest.current.onDismiss();
    } catch(error) {
      if(!(error instanceof DOMException&&error.name==='AbortError'))throw error;
    } finally {
      if(current===epoch.current){animation.current?.cancel();animation.current=null;closing.current=false;}
    }
  },[]);
  const isOutside=(event:PointerEvent<HTMLDialogElement>)=>{
    if(event.target!==event.currentTarget)return false;
    const b=event.currentTarget.getBoundingClientRect();
    return event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom;
  };
  return {ref,dismiss,dialogProps:{tabIndex:-1,'data-dialog-surface':true,
    onKeyDown:(event:KeyboardEvent<HTMLDialogElement>)=>{
      if(event.key!=='Tab'||event.defaultPrevented)return;
      const node=event.currentTarget;
      // Native modality blocks the background, but browsers may send Tab from
      // the last control to browser chrome. Keep the reading loop on the task.
      const controls=[...node.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex],[contenteditable=true],summary')]
        .filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&!el.closest('[inert]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden');
      if(!controls.length){event.preventDefault();node.focus({preventScroll:true});return;}
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===node)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    },
    onCancel:(event:SyntheticEvent<HTMLDialogElement>)=>{event.preventDefault();void dismiss();},
    onPointerDown:(event:PointerEvent<HTMLDialogElement>)=>{outside.current=isOutside(event);},
    onPointerUp:(event:PointerEvent<HTMLDialogElement>)=>{if(outside.current&&isOutside(event))void dismiss();outside.current=false;},
  }};
}
