import test from 'node:test';
import assert from 'node:assert/strict';
import {homeTopicActivity} from '../src/homeTopics.mjs';

test('home topics use only saved discussions attributed to the selected student',()=>{
 const record={studentId:'one',date:'2026-10-01T12:00:00Z',mode:'planning',summary:'A saved discussion'};
 const items=[record,{...record,studentId:'two',mode:'finance'},{...record,studentId:null,mode:'admissions'},{...record,mode:'profile'},{...record,mode:'loans',summary:'   '},{...record,mode:'admissions',date:'invalid'}];
 assert.deepEqual(homeTopicActivity(items,'one'),[{mode:'planning',date:record.date}]);
 assert.deepEqual(homeTopicActivity(items,''),[]);
 assert.deepEqual(homeTopicActivity(items,'missing'),[]);
});

test('home topics keep the newest discussion per topic and update after history is deleted',()=>{
 const items=[{studentId:'one',mode:'finance',summary:'Older costs',date:'2026-10-01T12:00:00Z'},{studentId:'one',mode:'planning',summary:'Planning',date:'2026-10-02T12:00:00Z'},{studentId:'one',mode:'finance',summary:'Newer costs',date:'2026-10-03T12:00:00Z'}];
 assert.deepEqual(homeTopicActivity(items,'one'),[{mode:'finance',date:items[2].date},{mode:'planning',date:items[1].date}]);
 assert.deepEqual(homeTopicActivity(items.slice(0,2),'one'),[{mode:'planning',date:items[1].date},{mode:'finance',date:items[0].date}]);
 assert.deepEqual(homeTopicActivity([],'one'),[]);
});
