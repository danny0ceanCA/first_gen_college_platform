import test from 'node:test';
import assert from 'node:assert/strict';
import {binderRevealDelta,revealBinderTopic} from '../src/binderReveal.mjs';

const rect=(left,top,right,bottom)=>({left,top,right,bottom});
test('divider reveal scrolls only enough to clear viewport edges and the voice dock',()=>{
 const viewport={top:24,bottom:600,left:20,right:1000};
 assert.deepEqual(binderRevealDelta(rect(50,100,200,180),viewport),{x:0,y:0});
 assert.deepEqual(binderRevealDelta(rect(1020,680,1180,760),viewport),{x:180,y:160});
 assert.deepEqual(binderRevealDelta(rect(-100,-120,100,-20),viewport),{x:-120,y:-144});
 assert.equal(binderRevealDelta(rect(20,300,200,1300),viewport).y,276,'large targets align their beginning rather than overscroll');
});

function fixture({hidden=false,editing=false,reduced=false,closed=false}={}){
 const scrolls=[],focus=[];
 const rail={getBoundingClientRect:()=>rect(0,1000,300,1100),scrollBy:options=>scrolls.push(['rail',options])};
 const node={getClientRects:()=>[{}],getBoundingClientRect:()=>rect(400,1000,550,1080),closest:selector=>selector==='[hidden],[inert]'?null:closed?null:rail,focus:()=>focus.push('focus'),click:()=>assert.fail('must never select a topic')};
 const root={querySelectorAll:()=>[node]};
 const view={innerHeight:800,document:{hidden,activeElement:{matches:()=>editing},querySelector:()=>({getBoundingClientRect:()=>({...rect(0,700,500,800),height:100})})},matchMedia:()=>({matches:reduced}),scrollBy:options=>scrolls.push(['page',options])};
 return {root,view,scrolls,focus,node};
}
test('desktop rail and document reveal preserve selected tab/focus and honor reduced motion',()=>{
 for(const reduced of [false,true]){
  const f=fixture({reduced});assert.equal(revealBinderTopic(f.root,'transfer',f.view),true);
  assert.deepEqual(f.scrolls,[['rail',{left:254,behavior:reduced?'instant':'smooth'}],['page',{top:400,behavior:reduced?'instant':'smooth'}]]);
  assert.deepEqual(f.focus,[]);
 }
});
test('closed-cover and mobile indicators scroll without opening, and hidden tabs/editors stay untouched',()=>{
 const cover=fixture({closed:true});assert.equal(revealBinderTopic(cover.root,'transfer',cover.view),true);assert.equal(cover.scrolls.length,1);
 for(const options of [{hidden:true},{editing:true}]){const f=fixture(options);assert.equal(revealBinderTopic(f.root,'transfer',f.view),false);assert.deepEqual(f.scrolls,[]);}
 const hidden=fixture();hidden.node.closest=()=>({hidden:true});assert.equal(revealBinderTopic(hidden.root,'transfer',hidden.view),false);
 const invalid=fixture();assert.equal(revealBinderTopic(invalid.root,'summary',invalid.view),false);
});
