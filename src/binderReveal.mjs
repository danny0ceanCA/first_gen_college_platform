// Reveal a signal with the least scrolling needed. Never select a divider or
// move keyboard focus; the confirmed-scope follower owns page selection.
export function binderRevealDelta(rect,{top=20,bottom,left=0,right}){
 const y=rect.top<top?rect.top-top:rect.bottom>bottom?Math.min(rect.top-top,rect.bottom-bottom):0;
 const x=rect.left<left?rect.left-left:rect.right>right?Math.min(rect.left-left,rect.right-right):0;
 return {x,y};
}

export function revealBinderTopic(root,topic,view=window){
 if(!root||!['options','transfer','costs','applications'].includes(topic)||view.document.hidden)return false;
 const target=[...root.querySelectorAll(`[data-topic="${topic}"].is-discussing`)].find(node=>!node.closest('[hidden],[inert]')&&node.getClientRects().length);
 if(!target)return false;
 // Typing a note takes precedence; do not pull the editor out of view.
 const focused=view.document.activeElement;
 if(focused?.matches('input,textarea,select,[contenteditable="true"]'))return false;
 const behavior=view.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
 const rail=target.closest('.notebook-topics,.notebook-live-topics');
 if(rail){
  const bounds=rail.getBoundingClientRect(),delta=binderRevealDelta(target.getBoundingClientRect(),{top:-Infinity,bottom:Infinity,left:bounds.left+4,right:bounds.right-4});
  if(delta.x)rail.scrollBy({left:delta.x,behavior});
 }
 const dock=view.document.querySelector('.shared-voice-dock')?.getBoundingClientRect();
 const bottom=dock&&dock.height>0&&dock.top>0?Math.min(view.innerHeight,dock.top)-20:view.innerHeight-20;
 const delta=binderRevealDelta(target.getBoundingClientRect(),{top:24,bottom,left:-Infinity,right:Infinity});
 if(delta.y)view.scrollBy({top:delta.y,behavior});
 return true;
}
