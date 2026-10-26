import test from 'node:test';
import assert from 'node:assert/strict';
import {createBinderFollower,createBinderNavigationGuards,binderFollowDeliverable} from '../src/binderFollow.mjs';
import {createBinderActivity} from '../src/binderSignals.mjs';

const context={subject:'account-a',studentIds:['alex','blair'],role:'parent',ready:true,blocked:false};
const signal=(topics=[],studentId='blair',source='call-a')=>({source,subject:'account-a',studentId,topics});

test('confirmed student opens a binder before a topic exists; topic changes select once',()=>{
 const follower=createBinderFollower(),first=follower.observe(signal(),context);
 assert.equal(first.studentId,'blair');assert.equal(first.topic,null);
 assert.equal(follower.observe(signal(),context),first);
 const transfer=follower.observe(signal(['transfer']),context);
 assert.equal(transfer.topic,'transfer');assert.ok(transfer.serial>first.serial);
 assert.equal(follower.observe(signal(['transfer']),context),transfer);
 const costs=follower.observe(signal(['costs']),context);assert.equal(costs.topic,'costs');
 assert.ok(costs.serial>transfer.serial);
});

test('related topics and reordered lists keep a stable primary divider',()=>{
 const follower=createBinderFollower();
 const first=follower.observe(signal(['costs']),context);
 assert.equal(follower.observe(signal(['transfer','costs']),context),first);
 assert.equal(follower.observe(signal(['costs','transfer']),context),first);
 const next=follower.observe(signal(['transfer','applications']),context);
 assert.equal(next.topic,'transfer');
 assert.equal(follower.observe(signal(['applications','transfer']),context),next);
});

test('unrelated conversation cancels a queued topic; it does not select another divider',()=>{
 const follower=createBinderFollower(),transfer=follower.observe(signal(['transfer']),context);
 assert.equal(follower.observe(signal([]),context),null);
 assert.equal(follower.observe(signal([]),context),null);
 assert.equal(binderFollowDeliverable(transfer,signal([]),context),false);
 assert.equal(follower.observe(signal(['transfer']),context).topic,'transfer');
});

test('family confirmation is separate from student selection and unavailable to student roles',()=>{
 const follower=createBinderFollower(),family=follower.observe(signal(['costs'],null),context);
 assert.equal(family.studentId,null);assert.equal(family.topic,'costs');
 assert.equal(binderFollowDeliverable(family,signal(['costs'],null),context),true);
 assert.equal(follower.observe(signal(['costs'],null),{...context,role:'student'}),null);
 assert.equal(binderFollowDeliverable(family,signal(['costs'],null),{...context,role:'student'}),false);
});

test('onboarding, foreign accounts, unknown students, and ended calls cannot navigate',()=>{
 for(const [activity,settings] of [[signal(),{...context,ready:false}],[{...signal(),subject:'other'},context],[signal([],'unknown'),context],[null,context]]){
  assert.equal(createBinderFollower().observe(activity,settings),null);
 }
 const request=createBinderFollower().observe(signal(['transfer']),context);
 assert.equal(binderFollowDeliverable(request,null,context),false);
 assert.equal(binderFollowDeliverable(request,signal(['transfer']),{...context,subject:'other'}),false);
 assert.equal(binderFollowDeliverable(request,signal(['transfer']),{...context,studentIds:['alex']}),false);
 assert.equal(binderFollowDeliverable(request,signal(['transfer']),{...context,ready:false}),false);
});

test('deferred navigation uses the latest confirmed scope and is cancelled when its call ends',()=>{
 const activity=createBinderActivity(),follower=createBinderFollower();
 activity.begin('call-a','account-a','alex',['options']);
 const old=follower.observe(activity.snapshot(),context);
 assert.equal(binderFollowDeliverable(old,activity.snapshot(),{...context,blocked:true}),false);
 activity.begin('call-b','account-a','blair',['transfer']);
 const latest=follower.observe(activity.snapshot(),context);
 activity.end('call-a'); // delayed cleanup from the older session is harmless
 assert.equal(binderFollowDeliverable(old,activity.snapshot(),context),false);
 assert.equal(binderFollowDeliverable(latest,activity.snapshot(),context),true);
 activity.end('call-b');assert.equal(follower.observe(activity.snapshot(),context),null);
 assert.equal(binderFollowDeliverable(latest,activity.snapshot(),context),false);
});

test('all draft owners must release their guard before queued navigation can resume',()=>{
 const guards=createBinderNavigationGuards(),note={},memory={},action={};let changes=0;
 const unsubscribe=guards.subscribe(()=>changes++);
 guards.set(note,true);guards.set(memory,true);guards.set(action,true);
 assert.equal(guards.snapshot(),true);assert.equal(changes,1);
 guards.set(note,false);guards.set(memory,false);assert.equal(guards.snapshot(),true);
 guards.set(action,false);assert.equal(guards.snapshot(),false);assert.equal(changes,2);
 guards.set(action,false);assert.equal(changes,2);unsubscribe();
});
