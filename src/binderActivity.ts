import {createBinderActivity,createBinderNoteUpdates} from './binderSignals.mjs';
import {browserPrivacy} from './browserPrivacy.mjs';

export const binderActivity=createBinderActivity();
export const binderNoteUpdates=createBinderNoteUpdates();
browserPrivacy.subscribe(()=>{binderActivity.clear();binderNoteUpdates.clear();});
