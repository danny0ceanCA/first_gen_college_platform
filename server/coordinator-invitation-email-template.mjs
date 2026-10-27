import {renderRegistrationEmail} from './registration-email-template.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The caller obtains the ticket from Auth0 and delivers it only to that
// identity's email. Rendering does not create users, tickets, or messages.
export function renderCoordinatorInvitationEmail({name,organizationName,email,passwordURL,auth0Domain,publicURL}){
 const url=new URL(passwordURL);
 if(url.protocol!=='https:'||url.hostname!==auth0Domain||url.username||url.password||!['/lo/reset','/u/reset-verify'].includes(url.pathname))throw Error('invalid_password_setup_url');
 if(typeof name!=='string'||!name.trim()||name.length>100||typeof organizationName!=='string'||!organizationName.trim()||organizationName.length>200||typeof email!=='string'||email.length>254||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw Error('invalid_invitation_recipient');
 const copy={
  en:{title:'Let’s get you started.',greeting:`Hello ${name},`,intro:`Your Origen coordinator workspace for ${organizationName} is ready. Use the secure link below to choose your password.`,email:'Your sign-in email',button:'Set your password',expiry:'This link can be used once and expires after 24 hours. If it expires, select “Forgot password” on the Origen sign-in page to request a new one.',next:'After choosing your password, sign in to Origen. On your first coordinator login, you’ll set up two-step verification with an authenticator app. A completed verification lasts 12 hours.',help:'If you need a hand, reply to this email. I’m happy to help.',thanks:'Thank you,',role:'Founder, Origen Edu'},
  es:{title:'Comencemos.',greeting:`Hola ${name},`,intro:`Tu espacio de coordinador de Origen para ${organizationName} está listo. Usa el enlace seguro de abajo para elegir tu contraseña.`,email:'Tu correo para iniciar sesión',button:'Crear tu contraseña',expiry:'Este enlace se puede usar una sola vez y vence después de 24 horas. Si vence, selecciona “¿Olvidaste tu contraseña?” al iniciar sesión en Origen para solicitar otro.',next:'Después de elegir tu contraseña, inicia sesión en Origen. En tu primer acceso como coordinador, configurarás la verificación en dos pasos con una aplicación de autenticación. Una verificación completada dura 12 horas.',help:'Si necesitas ayuda, responde a este correo. Con gusto te ayudo.',thanks:'Gracias,',role:'Fundador de Origen Edu'}
 };
 const section=lang=>{const c=copy[lang];return `<tr><td class="section" lang="${lang}" style="padding:32px 36px;${lang==='es'?'border-top:1px solid #e4d7ca;':''}"><p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#a4513c;">${lang==='en'?'English':'Español'}</p><h1 style="font-size:29px;line-height:1.2;color:#2f343b;">${escape(c.title)}</h1><p>${escape(c.greeting)}</p><p>${escape(c.intro)}</p><p><strong>${c.email}:</strong><br>${escape(email)}</p><table role="presentation"><tr><td bgcolor="#a4513c" style="border-radius:8px;"><a href="${escape(url.href)}" style="display:inline-block;padding:16px 24px;border-radius:8px;color:white;font-size:16px;font-weight:bold;text-decoration:none;">${c.button}</a></td></tr></table><p style="margin-top:24px;">${c.expiry}</p><p>${c.next}</p><p>${c.help}</p><p>${c.thanks}<br><strong style="font-size:19px;color:#a4513c;">Daniel</strong><br>${c.role}<br><a href="mailto:daniel@origenedu.ai" style="color:#813e2e;">daniel@origenedu.ai</a></p></td></tr>`;};
 const base=renderRegistrationEmail({kind:'coordinator-approved',name,organizationName,publicURL}).html;
 const start=base.indexOf('<tr><td class="section" lang="en"'),end=base.indexOf('<tr><td style="padding:22px;',start);
 if(start<0||end<0)throw Error('email_layout_changed');
 const text=['Daniel · Origen Edu',...['en','es'].map(lang=>{const c=copy[lang];return [c.title,c.greeting,c.intro,`${c.email}: ${email}`,`${c.button}: ${url.href}`,c.expiry,c.next,c.help,c.thanks,`Daniel\n${c.role}\ndaniel@origenedu.ai`].join('\n\n');})].join('\n\n--------------------\n\n');
 return {subject:'Set up your Origen password',html:base.slice(0,start)+section('en')+section('es')+base.slice(end),text};
}
