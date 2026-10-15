import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {renderGuardianEmail} from '../server/guardian-email-template.mjs';
import {GUARDIAN_NOTICE,GUARDIAN_NOTICE_VERSION} from '../server/guardian-email.mjs';

// Synthetic, nonfunctional capability values; no database, provider or send call.
const output=new URL('../output/email/',import.meta.url);await mkdir(output,{recursive:true});
const logo=await readFile(new URL('../server/assets/origen-mark.png',import.meta.url));
const message=renderGuardianEmail({publicURL:'https://example.invalid/',requestId:'PREVIEW-ONLY',approvalToken:'PREVIEW-NOT-A-REAL-APPROVAL',withdrawalToken:'PREVIEW-NOT-A-REAL-WITHDRAWAL',notice:GUARDIAN_NOTICE,noticeVersion:GUARDIAN_NOTICE_VERSION});
await writeFile(new URL('guardian-permission-preview.html',output),message.html.replace('cid:origen-mark',`data:image/png;base64,${logo.toString('base64')}`));
await writeFile(new URL('guardian-permission-preview.txt',output),message.text);
const b64=value=>Buffer.from(value).toString('base64').match(/.{1,76}/g).join('\r\n');
const eml=['From: Daniel at Origen Edu <daniel@origenedu.ai>','To: Preview <guardian@example.invalid>',`Subject: ${message.subject}`,'MIME-Version: 1.0','Content-Type: multipart/related; boundary="origen-related"','','--origen-related','Content-Type: multipart/alternative; boundary="origen-alternative"','','--origen-alternative','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(message.text),'--origen-alternative','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(message.html),'--origen-alternative--','--origen-related','Content-Type: image/png','Content-ID: <origen-mark>','Content-Disposition: inline; filename="origen-mark.png"','Content-Transfer-Encoding: base64','',b64(logo),'--origen-related--',''].join('\r\n');
await writeFile(new URL('guardian-permission-preview.eml',output),eml);
console.log('Created HTML, plain-text and EML previews with synthetic links. No email sent.');
