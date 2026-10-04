import test from 'node:test';
import assert from 'node:assert/strict';
import {rebaseInstitutionDraft} from '../src/institutionDraft.mjs';
test('refresh preserves local edits and brings in changes to other fields',()=>{
 const base={name:'College',description:'Original',links:[]};
 const draft={...base,description:'My edits'},latest={...base,name:'New college'};
 const result=rebaseInstitutionDraft(base,draft,latest);
 assert.deepEqual(result,{merged:{...latest,description:'My edits'},conflicts:[]});
});
test('refresh detects competing edits instead of silently overwriting them',()=>{
 const base={description:'Original',links:[]};
 const result=rebaseInstitutionDraft(base,{...base,description:'Mine'},{...base,description:'Theirs'});
 assert.deepEqual(result.conflicts,['description']);assert.equal(result.merged.description,'Mine');
});
