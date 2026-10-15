import test from 'node:test';
import assert from 'node:assert/strict';
import {renderGuardianEmail} from './guardian-email-template.mjs';
import {GUARDIAN_NOTICE,GUARDIAN_NOTICE_VERSION} from './guardian-email.mjs';
const input={publicURL:'https://example.invalid/',requestId:'preview',approvalToken:'APPROVAL',withdrawalToken:'WITHDRAWAL',notice:GUARDIAN_NOTICE,noticeVersion:GUARDIAN_NOTICE_VERSION};
test('concise bilingual email links to privacy and routes both languages to an explicit guardian decision',()=>{
 const {html,text}=renderGuardianEmail(input);
 for(const lang of ['en','es'])assert.ok(!text.includes(GUARDIAN_NOTICE[lang]));
 assert.ok(text.split(/\s+/).length<400);
 assert.equal((html.match(/href="https:\/\/example.invalid\/#privacy"/g)||[]).length,2);
 assert.match(html,/I’m Daniel from Origen Edu/);assert.match(html,/Soy Daniel, de Origen Edu/);
 assert.match(html,/#f4eee4/);assert.match(html,/#a4513c/);
 assert.equal((html.match(/href="https:\/\/example.invalid\/#guardian\/APPROVAL"/g)||[]).length,2);
 assert.equal((html.match(/href="https:\/\/example.invalid\/#guardian\/WITHDRAWAL"/g)||[]).length,2);
 assert.doesNotMatch(html,/<script|<form|https?:[^"\s]+\.(?:png|woff)|action=approve|tracking/i);
 assert.match(html,/48 hours/);assert.match(html,/48 horas/);
 assert.match(html,/Review and accept/);assert.match(html,/Revisar y aceptar/);
});
test('untrusted references are escaped in HTML and tokens remain URL-fragment values',()=>{
 const {html}=renderGuardianEmail({...input,requestId:'<img src=x onerror=alert(1)>',approvalToken:'"/><script>x</script>',notice:{en:'<b>Untrusted</b>',es:'<b>No confiable</b>'}});
 assert.doesNotMatch(html,/<script>|<b>Untrusted|onerror=alert\(1\)>/);
 assert.match(html,/&lt;img/);
 assert.match(html,/#guardian\/%22%2F%3E%3Cscript%3Ex%3C%2Fscript%3E/);
});
