import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderRegistrationEmail,registrationEmailKinds} from './registration-email-template.mjs';
import {createRegistrationMailer,registrationMailConfig,startRegistrationEmailWorker,assertRegistrationEmailReady} from './registration-email.mjs';
const env={GUARDIAN_EMAIL_TRANSPORT:'resend',GUARDIAN_PUBLIC_URL:'https://origen.example/',RESEND_API_KEY:'synthetic-not-a-key'};

test('all four bilingual templates match the parent email branding and escape names',()=>{
 for(const kind of registrationEmailKinds){
  const message=renderRegistrationEmail({kind,name:'<img onerror=alert(1)>',organizationName:'A & B College',publicURL:'https://origen.example/'});
  assert.ok(message.html.includes('#a4513c'));assert.ok(message.html.includes('#f4eee4'));assert.ok(message.html.includes('cid:origen-mark'));
  assert.ok(message.html.includes('lang="es"'));assert.ok(message.html.includes('&lt;img onerror=alert(1)&gt;'));assert.ok(!message.html.includes('<img onerror'));
  assert.ok(message.html.includes('A &amp; B College'));assert.match(message.text,/Daniel\n(?:Founder, )?Origen Edu/);
  const route=kind.startsWith('organization-')?'institutions':kind==='coordinator-received'?'coordinator-register':'coordinators';
  assert.ok(message.text.includes(`https://origen.example/#${route}`));
 }
 assert.throws(()=>renderRegistrationEmail({kind:'unknown',publicURL:env.GUARDIAN_PUBLIC_URL}));
 assert.throws(()=>renderRegistrationEmail({kind:'coordinator-approved',publicURL:'https://evil@example.org/'}));
});

test('mailer reuses guardian configuration, keeps delivery disabled locally, and sends idempotent captured requests',async()=>{
 assert.equal(registrationMailConfig({}).mode,'disabled');assert.equal(registrationMailConfig({...env,REGISTRATION_EMAIL_TRANSPORT:'disabled'}).mode,'disabled');
 assert.throws(()=>registrationMailConfig({...env,REGISTRATION_PUBLIC_URL:'http://localhost/'}));
 assert.throws(()=>registrationMailConfig({...env,RESEND_API_KEY:''}));
 const calls=[],mailer=createRegistrationMailer(env,async(url,options)=>{calls.push({url,...options});return {ok:true};});
 const item={id:randomUUID(),kind:'coordinator-approved',recipient:'verified@example.test',name:'Alex',organizationName:'Synthetic Org'};
 assert.equal(await mailer.send(item),'accepted');assert.equal(await mailer.send(item),'accepted');
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].body,calls[1].body);
 const body=JSON.parse(calls[0].body);assert.deepEqual(body.to,['verified@example.test']);assert.equal(body.reply_to,'daniel@origenedu.ai');assert.equal(body.attachments[0].content_id,'origen-mark');
 assert.ok(!body.html.includes('synthetic-not-a-key'));assert.equal(await mailer.send({...item,recipient:'bad\r\nBcc: other@example.test'}),'failed');assert.equal(calls.length,2);
 assert.equal(await createRegistrationMailer(env,async()=>{throw Error('private provider error');}).send(item),'failed');
 assert.equal(await createRegistrationMailer({},()=>{throw Error('must not send');}).send(item),'disabled');
});

test('worker serializes sends, acknowledges captured outcomes, and shuts down cleanly',async()=>{
 const item={id:randomUUID(),leaseToken:randomUUID()},commands=[];let sent=0,complete;
 const finished=new Promise(resolve=>{complete=resolve;});
 const database={query:async(_sql,[raw])=>{const input=JSON.parse(raw);commands.push(input);if(input.action==='finish'){complete();return {rows:[{result:{updated:true}}]};}return {rows:[{result:commands.length===1?item:{}}]};}};
 const stop=startRegistrationEmailWorker({database,mailer:{mode:'capture',send:async()=>{sent++;return 'accepted';}},intervalMs:100000});
 await finished;await stop();assert.equal(sent,1);assert.equal(commands.find(x=>x.action==='finish').accepted,true);
 assert.deepEqual(commands.find(x=>x.action==='finish').leaseToken,item.leaseToken);
 await assert.rejects(assertRegistrationEmailReady(null,env),/registration_email_migration_required/);
});
