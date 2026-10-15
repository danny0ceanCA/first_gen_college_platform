const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const copy={
 en:{language:'English',title:'A little help with college.',hello:'Hello,',intro:'I’m Daniel from Origen Edu. We help students and families explore college options, applications and financial aid.',request:'A student has asked us to contact you as their parent or legal guardian. If this is your child’s request, please review how Origen uses their information and choose whether to allow access.',choice:'Review within 48 hours. You can accept or decline on the next page; opening this email does not grant permission.',button:'Review and accept',unfamiliar:'Don’t recognize the request? Don’t approve it. Reply to me for help, and keep these links private.',withdrawLink:'Withdraw permission',signoff:'Thank you,',reference:'Reference',privacy:'Read the privacy notice'},
 es:{language:'Español',title:'Un poco de ayuda para llegar a la universidad.',hello:'Hola,',intro:'Soy Daniel, de Origen Edu. Ayudamos a estudiantes y familias a explorar opciones universitarias, solicitudes y ayuda financiera.',request:'Un estudiante nos pidió contactarte como su madre, padre o tutor legal. Si la solicitud es de tu hijo o hija, revisa cómo Origen usa su información y decide si autorizas el acceso.',choice:'Revisa la solicitud en 48 horas. Puedes aceptar o rechazar en la siguiente página; abrir este correo no otorga permiso.',button:'Revisar y aceptar',unfamiliar:'¿No reconoces la solicitud? No la apruebes. Respóndeme para pedir ayuda y mantén privados estos enlaces.',withdrawLink:'Retirar el permiso',signoff:'Gracias,',reference:'Referencia',privacy:'Leer el aviso de privacidad'}
};

export function renderGuardianEmail({publicURL,requestId,approvalToken,withdrawalToken,noticeVersion}){
 const reviewURL=`${publicURL}#guardian/${encodeURIComponent(approvalToken)}`;
 const withdrawalURL=`${publicURL}#guardian/${encodeURIComponent(withdrawalToken)}`;
 const privacyURL=`${publicURL}#privacy`;
 const p=text=>`<p style="margin:0 0 18px;font-size:16px;line-height:1.65;">${escape(text)}</p>`;
 const section=lang=>{
  const c=copy[lang];
  // The complete versioned notice is shown by the guardian decision page.
  return `<tr><td lang="${lang}" class="section" style="padding:32px 36px;${lang==='es'?'border-top:1px solid #e4d7ca;':''}">
   <p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#a4513c;">${c.language}</p>
   <h1 style="margin:0 0 24px;font-size:29px;line-height:1.2;letter-spacing:-.6px;color:#2f343b;">${c.title}</h1>
   ${p(c.hello)}${p(c.intro)}${p(c.request)}
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;background:#f4eee4;border:1px solid #e4d7ca;border-radius:12px;"><tr><td style="padding:18px;font-size:14px;line-height:1.6;">${escape(c.choice)}</td></tr></table>
   <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr><td bgcolor="#a4513c" style="border-radius:8px;"><a href="${escape(reviewURL)}" style="display:inline-block;padding:16px 24px;border:1px solid #a4513c;border-radius:8px;color:#ffffff;font-size:16px;line-height:1.2;font-weight:bold;text-decoration:none;">${c.button}</a></td></tr></table>
   <p style="margin:0 0 28px;font-size:12px;line-height:1.6;color:#756b63;overflow-wrap:anywhere;">${c.reference}: ${escape(requestId)}</p>
   ${p(c.unfamiliar)}
   <p style="margin:0 0 24px;line-height:1.6;"><a href="${escape(withdrawalURL)}" style="color:#813e2e;text-decoration:underline;">${c.withdrawLink}</a> &nbsp;·&nbsp; <a href="${escape(privacyURL)}" style="color:#813e2e;text-decoration:underline;">${c.privacy}</a></p>
   <p style="margin:0;font-size:15px;line-height:1.8;">${escape(c.signoff)}<br><strong style="font-size:19px;color:#a4513c;">Daniel</strong><br>Origen Edu<br><a href="mailto:daniel@origenedu.ai" style="color:#813e2e;">daniel@origenedu.ai</a></p>
  </td></tr>`;
 };
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Daniel at Origen Edu · Guardian permission / Permiso de tutor</title><style>@media only screen and (max-width:600px){.outer{padding:12px 8px!important}.section{padding:28px 22px!important}.brand{padding:26px 22px!important}}</style></head>
 <body style="margin:0;padding:0;background:#f4eee4;color:#2f343b;font-family:Arial,Helvetica,sans-serif;">
 <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">A personal note from Daniel. Review a college-guidance request. / Una nota de Daniel. Revisa una solicitud de orientación universitaria.</div>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4eee4"><tr><td class="outer" align="center" style="padding:36px 16px;">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:600px;border:1px solid #e4d7ca;border-radius:18px;overflow:hidden;">
 <tr><td class="brand" style="padding:28px 36px;background:#f4eee4;border-bottom:1px solid #e4d7ca;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;"><img src="cid:origen-mark" alt="Origen circle mark" width="40" height="40" style="display:block;border:0;"></td><td style="padding-left:8px;color:#a4513c;font-size:34px;line-height:40px;font-weight:800;letter-spacing:-1.8px;">origen.</td></tr></table><p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#756b63;">A note from Daniel · Una nota de Daniel<br>English first · Español a continuación</p></td></tr>
 ${section('en')}${section('es')}
 <tr><td style="padding:22px 30px;border-top:1px solid #e4d7ca;font-size:12px;line-height:1.7;text-align:center;color:#756b63;">Origen Edu · Blueprint Holdings LLC<br>Notice / Aviso: ${escape(noticeVersion)}<br>daniel@origenedu.ai</td></tr>
 </table></td></tr></table></body></html>`;
 const text=['Daniel · Origen Edu',...['en','es'].map(lang=>{const c=copy[lang];return [c.language,c.title,c.hello,c.intro,c.request,c.choice,`${c.button}: ${reviewURL}`,`${c.reference}: ${requestId}`,c.unfamiliar,`${c.withdrawLink}: ${withdrawalURL}`,`${c.privacy}: ${privacyURL}`,c.signoff,'Daniel\nOrigen Edu\ndaniel@origenedu.ai'].join('\n\n');}),`Blueprint Holdings LLC\nNotice / Aviso: ${noticeVersion}`].join('\n\n--------------------\n\n');
 return {html,text,subject:'Daniel at Origen: guardian permission / permiso de tutor'};
}
