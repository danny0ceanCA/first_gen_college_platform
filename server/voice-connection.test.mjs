import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceConnectionRecovery,voiceProfile} from '../src/voiceConnection.mjs';
function clock(){let id=0;const callbacks=new Map();return {schedule(fn,delay){assert.equal(delay,8000);callbacks.set(++id,fn);return id;},cancel(id){callbacks.delete(id);},tick(){for(const fn of [...callbacks.values()])fn();callbacks.clear();},get count(){return callbacks.size;}};}
test('temporary network loss reconnects without ending the live session',()=>{
 const time=clock();let ended=0;const recovery=voiceConnectionRecovery(()=>ended++,time);
 recovery.change('disconnected');recovery.change('disconnected');assert.equal(time.count,1);
 recovery.change('connected');time.tick();assert.equal(ended,0);
 recovery.change('disconnected');time.tick();assert.equal(ended,1);
});
test('failed connections end immediately and cleanup cancels outstanding recovery',()=>{
 const time=clock();let ended=0;const recovery=voiceConnectionRecovery(()=>ended++,time);
 recovery.change('disconnected');recovery.change('failed');assert.equal(ended,1);time.tick();assert.equal(ended,1);
 const next=voiceConnectionRecovery(()=>ended++,time);next.change('disconnected');next.stop();time.tick();assert.equal(ended,1);
});
test('profile voice uses edited draft while guidance uses the selected saved student',()=>{
 const saved={id:'one',name:'Alex',school:'Old school'},draft={...saved,school:'New school',goals:'Engineering'};
 assert.equal(voiceProfile('profile',draft,[saved],'one'),draft);
 assert.equal(voiceProfile('planning',draft,[saved],'one'),saved);
 assert.equal(voiceProfile('finance',draft,[saved],null).name,'');
});
