import test from 'node:test';
import assert from 'node:assert/strict';
import {researchTablesEnabled} from './research-feature-flags.mjs';
test('production tables require explicit enablement; local flags never bypass it',()=>{
 for(const value of [undefined,'false','rules','decisions','1'])assert.equal(researchTablesEnabled({NODE_ENV:'production',ORIGEN_RESEARCH_TABLES:value,ORIGEN_LOCAL_VISUAL_CARDS:'true'}),false);
 assert.equal(researchTablesEnabled({NODE_ENV:'production',ORIGEN_RESEARCH_TABLES:'true'}),true);
 assert.equal(researchTablesEnabled({NODE_ENV:'development',ORIGEN_LOCAL_VISUAL_CARDS:'true'}),true);
});
