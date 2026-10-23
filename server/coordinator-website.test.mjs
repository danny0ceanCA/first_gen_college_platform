import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCoordinatorWebsite} from '../src/coordinatorWebsite.mjs';
import {validateApplication} from './coordinator-applications.mjs';

test('coordinator websites accept bare domains with or without www and keep blank optional',()=>{
 for(const [input,expected] of [['origenedu.ai','https://origenedu.ai/'],['www.origenedu.ai','https://www.origenedu.ai/'],['  origenedu.ai/support  ','https://origenedu.ai/support'],['https://example.org','https://example.org/'],['//example.org','https://example.org/'],['',''],['  ',''],[undefined,'']])assert.equal(normalizeCoordinatorWebsite(input),expected);
});

test('normalization does not turn unsafe or malformed coordinator URLs into valid applications',()=>{
 for(const input of ['javascript:alert(1)','http://example.org','https://user:pass@example.org','https://example.org?token=private','https://example.org/#private','not a website','not-a-domain','example.org\\private','example.org\n/path',null,123,'x'.repeat(2001)])assert.throws(()=>normalizeCoordinatorWebsite(input),/invalid_organization_website/);
});

test('API normalizes the same website that signup sends and saves',()=>{
 const base={action:'submit-application',displayName:'Avery Test',organizationName:'Example',jobRole:'Advisor'};
 for(const input of ['example.org','www.example.org','https://example.org',''])assert.equal(validateApplication({...base,organizationWebsite:input}).organizationWebsite,normalizeCoordinatorWebsite(input));
});
