import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceBinderTopics,binderTopicGuide} from '../src/voiceBinderTopics.mjs';
import {createBinderActivity} from '../src/binderSignals.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';

function fixture(overrides={}){
 const activity=createBinderActivity();activity.begin('call','account','student',[]);
 let turn='1',guide='planning',allowed=true,focus;
 const changes=[];
 const control=voiceBinderTopics({getTurn:()=>turn,getGuide:()=>guide,getFocusTopic:()=>focus,canApply:()=>allowed,
  highlight:topics=>activity.update('call',topics),
  switchGuide:async(next,topic,current)=>{changes.push(next);if(current()){guide=next;focus=topic;}},...overrides});
 return {activity,control,changes,guide:()=>guide,setTurn:value=>turn=value,setAllowed:value=>allowed=value,setFocus:value=>focus=value};
}

test('topic signals replace the current selection and synchronize planning, aid and applications',async()=>{
 const f=fixture();
 for(const [topics,expected] of [[['transfer'],'planning'],[['costs'],'finance'],[['applications'],'admissions'],[['options'],'planning']]){
  assert.equal(await f.control.update(topics,'1'),true);assert.deepEqual(f.activity.snapshot().topics,topics);assert.equal(f.guide(),expected);
 }
 assert.deepEqual(f.changes,['finance','admissions','planning']);
 assert.equal(await f.control.update([],'1'),true);assert.deepEqual(f.activity.snapshot().topics,[]);
 assert.equal(binderTopicGuide('costs','loans'),'loans');
});

test('stale, invalid, unconfirmed or stopped topic proposals cannot change the screen or guide',async()=>{
 const f=fixture();await f.control.update(['transfer'],'1');f.setTurn('2');
 for(const topics of [['costs'],null,['other'],['costs','costs']])assert.equal(await f.control.update(topics,'1'),false);
 assert.equal(await f.control.update(['costs'],undefined),false);
 f.setAllowed(false);assert.equal(await f.control.update(['costs'],'2'),false);f.setAllowed(true);
 f.control.stop();assert.equal(await f.control.update(['costs'],'2'),false);
 assert.deepEqual(f.activity.snapshot().topics,['transfer']);assert.deepEqual(f.changes,[]);
});

test('a new topic supersedes an in-flight topic update without restoring its old glow',async()=>{
 let release,started;const began=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve);
 let guide='planning';const callbacks=[];
 const f=fixture({getGuide:()=>guide,switchGuide:async(next,_topic,current)=>{if(next==='finance'){started();await wait;}guide=next;callbacks.push({next,current:current()});}});
 const first=f.control.update(['costs'],'1');await began;f.setTurn('2');
 const second=f.control.update(['applications'],'2');assert.deepEqual(f.activity.snapshot().topics,['applications']);
 release();assert.equal(await first,false);assert.equal(await second,true);
 assert.equal(guide,'admissions');assert.deepEqual(f.activity.snapshot().topics,['applications']);
 assert.deepEqual(callbacks,[{next:'finance',current:false},{next:'admissions',current:true}]);
});

test('topic refresh drops an old selected note context even when the specialty stays planning',async()=>{
 const f=fixture();f.setFocus('options');assert.equal(await f.control.update(['transfer'],'1'),true);
 assert.deepEqual(f.changes,['planning']);assert.deepEqual(f.activity.snapshot().topics,['transfer']);
});

test('failed configuration keeps the current visual subject and permits the next topic',async()=>{
 let notices=0;
 const f=fixture({switchGuide:async()=>{throw Error('offline');},onGuideUnavailable:()=>notices++});
 assert.equal(await f.control.update(['costs'],'1'),true);assert.deepEqual(f.activity.snapshot().topics,['costs']);
 assert.equal(await f.control.update(['applications'],'1'),true);assert.deepEqual(f.activity.snapshot().topics,['applications']);
 assert.equal(notices,2);
});

test('topic handoffs use acknowledged instruction updates on one channel and retain Spanish',async()=>{
 const sent=[];let language;
 language=voiceLanguageControl(event=>{sent.push(event);queueMicrotask(()=>language.event({type:'session.updated',session:event.session}));},{language:'es'});
 language.event({type:'session.created',session:{instructions:'Initial planning'}});
 const f=fixture({switchGuide:async(next,_topic,current)=>language.configure(async()=>({instructions:`Continue in ${next}`,tools:[]}),()=>{if(current())f.changes.push(next);})});
 assert.equal(await f.control.update(['costs'],'1'),true);
 assert.ok(sent.length===1&&sent.every(event=>event.type==='session.update'));
 assert.match(sent[0].session.instructions,/Current conversation language: Spanish/);
 for(const key of ['audio','model','sdp'])assert.equal(sent[0].session[key],undefined);
 assert.deepEqual(f.changes,['finance']);language.stop();
});
