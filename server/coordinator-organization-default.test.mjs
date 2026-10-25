import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCoordinatorOrganization} from '../src/coordinatorOrganizationDefault.mjs';

test('defaults to the requested eligible organization, allowing case and spacing differences',()=>{
 assert.equal(defaultCoordinatorOrganization('  Origen   Edu ',[{id:'other',name:'Other organization'},{id:'requested',name:'ORIGEN EDU'}]),'requested');
});
test('does not substitute an unrelated organization or select an ineligible request',()=>{
 assert.equal(defaultCoordinatorOrganization('Origen Edu',[]),'');
 assert.equal(defaultCoordinatorOrganization('Origen Edu',[{id:'other',name:'Other organization'}]),'');
 assert.equal(defaultCoordinatorOrganization('',[{id:'other',name:'Other organization'}]),'');
});
test('requires a manual choice for duplicate names or a truncated result set',()=>{
 assert.equal(defaultCoordinatorOrganization('Origen Edu',[{id:'a',name:'Origen Edu'},{id:'b',name:'origen edu'}]),'');
 assert.equal(defaultCoordinatorOrganization('Origen Edu',Array.from({length:51},(_,i)=>({id:String(i),name:i===0?'Origen Edu':`Other ${i}`}))),'');
});

test('registered organization identity survives renames and never falls back to a different same-name organization',()=>{
 const organizations=[{id:'registered',name:'Correct Legal Name'},{id:'unrelated',name:'Original Name'}];
 assert.equal(defaultCoordinatorOrganization('Original Name',organizations,'registered'),'registered');
 assert.equal(defaultCoordinatorOrganization('Original Name',organizations.filter(o=>o.id!=='registered'),'registered'),'');
});
