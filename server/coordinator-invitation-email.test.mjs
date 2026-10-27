import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCoordinatorInvitationEmail} from './coordinator-invitation-email-template.mjs';
const input={name:'<Keadrian>',organizationName:'CLASSY & Co.',email:'coordinator@example.test',auth0Domain:'origenedu.us.auth0.com',passwordURL:'https://origenedu.us.auth0.com/lo/reset?ticket=synthetic&flow=invite',publicURL:'https://origenedu.ai/'};
test('invitation renders the reviewed bilingual setup message and preserves the Auth0 ticket link',()=>{
 const message=renderCoordinatorInvitationEmail(input);
 assert.equal(message.subject,'Set up your Origen password');
 assert.match(message.html,/Hello &lt;Keadrian&gt;,/);assert.match(message.html,/CLASSY &amp; Co\./);
 assert.ok(!message.html.includes('<Keadrian>'));assert.match(message.html,/lang="es"/);
 assert.match(message.html,/href="https:\/\/origenedu\.us\.auth0\.com\/lo\/reset\?ticket=synthetic&amp;flow=invite"/);
 assert.match(message.text,/expires after 24 hours/);assert.match(message.text,/12 hours/);
 assert.match(message.html,/cid:origen-mark/);assert.ok(!message.html.includes('aria-disabled'));
});
test('invitation rejects non-Auth0 and credential-bearing setup destinations',()=>{
 for(const passwordURL of ['http://origenedu.us.auth0.com/lo/reset?ticket=x','https://example.org/lo/reset?ticket=x','https://user@origenedu.us.auth0.com/lo/reset?ticket=x','https://origenedu.us.auth0.com/authorize','https://origenedu.us.auth0.com/u/reset-verify/other'])assert.throws(()=>renderCoordinatorInvitationEmail({...input,passwordURL}));
 assert.throws(()=>renderCoordinatorInvitationEmail({...input,email:'person@example.test\r\nBcc:other@example.test'}));
});
test('invitation preserves the current Universal Login ticket fragment',()=>{
 const passwordURL='https://origenedu.us.auth0.com/u/reset-verify#ticket=synthetic&flow=invite';
 const message=renderCoordinatorInvitationEmail({...input,passwordURL});
 assert.ok(message.html.includes('href="https://origenedu.us.auth0.com/u/reset-verify#ticket=synthetic&amp;flow=invite"'));
 assert.ok(message.text.includes(passwordURL));
});
