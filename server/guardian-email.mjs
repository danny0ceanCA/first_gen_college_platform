// No SMTP password or alias authentication. Real transport is an explicit,
// future opt-in; tests inject a capture-only transport and never send email.
export const GUARDIAN_NOTICE_VERSION='guardian-2026-10-15-v1';
export const GUARDIAN_NOTICE={
 en:'Origen Edu, operated by Blueprint Holdings LLC, offers college planning for ninth graders and above. You are being asked to permit a teenager aged 13–17 to use an account. The student may provide profile information and college questions. Voice sends audio and relevant context to OpenAI; Origen does not keep microphone recordings. OpenAI processes data under its own applicable API retention settings. Origen saves conversation summaries, which may include personal context, and user-saved profiles, plans, notes and worksheets. Summary retention and deletion controls do not automatically delete those separate records. Permission does not link family accounts or let you, a referring organization, or a coordinator read private conversations. No sale of personal information is authorized by this permission. You can decline, withdraw using the separate link in this email, or contact daniel@origenedu.ai to request help or deletion. Withdrawing stops further permitted use; it does not by itself erase existing records. Email possession and your declaration do not conclusively verify guardianship. Approval lasts 180 days from the request and must then be renewed.',
 es:'Origen Edu, operado por Blueprint Holdings LLC, ofrece orientación universitaria desde el noveno grado. Se te pide autorizar a un adolescente de 13–17 años a usar una cuenta. El estudiante puede proporcionar información de perfil y preguntas universitarias. La voz envía audio y contexto relevante a OpenAI; Origen no guarda grabaciones del micrófono. OpenAI procesa datos según sus condiciones de retención de API aplicables. Origen guarda resúmenes de conversaciones, que pueden incluir contexto personal, y perfiles, planes, notas y hojas de trabajo guardados por el usuario. Los controles de retención y eliminación de resúmenes no eliminan automáticamente esos registros separados. El permiso no vincula cuentas familiares ni permite que tú, una organización de referencia o un coordinador lean conversaciones privadas. Este permiso no autoriza la venta de información personal. Puedes rechazar, retirar el permiso con el enlace separado de este correo o contactar a daniel@origenedu.ai para pedir ayuda o eliminación. Retirarlo detiene el uso permitido posterior; no borra por sí solo los registros existentes. La posesión del correo y tu declaración no verifican de forma concluyente la tutela. El permiso dura 180 días desde la solicitud y después debe renovarse.'
};
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
export function guardianMailConfig(env={}){
 const mode=env.GUARDIAN_EMAIL_TRANSPORT||'disabled';
 if(!['disabled','resend'].includes(mode))throw new Error('invalid_guardian_email_transport');
 const from=env.GUARDIAN_EMAIL_FROM||'daniel@origenedu.ai',replyTo=env.GUARDIAN_EMAIL_REPLY_TO||'daniel@origenedu.ai';
 if(!email(from)||!email(replyTo))throw new Error('invalid_guardian_sender');
 let publicURL;
 if(env.GUARDIAN_PUBLIC_URL){const url=new URL(env.GUARDIAN_PUBLIC_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('invalid_guardian_public_url');publicURL=url.origin+'/';}
 if(mode==='resend'&&(!publicURL||!env.RESEND_API_KEY?.trim()))throw new Error('guardian_delivery_configuration_required');
 return {mode,from,replyTo,publicURL};
}
export function createGuardianMailer(env={},request=fetch){
 const config=guardianMailConfig(env);
 return {mode:config.mode,async send({to,requestId,approvalToken,withdrawalToken}){
  if(config.mode==='disabled')return 'disabled';
  const text=`Origen Edu — Parent or guardian permission / Permiso de madre, padre o tutor\nReference / Referencia: ${requestId}\n\n${GUARDIAN_NOTICE.en}\n\n${GUARDIAN_NOTICE.es}\n\nReview and decide within 48 hours / Revisa y decide en 48 horas:\n${config.publicURL}#guardian/${approvalToken}\n\nKeep this private withdrawal link (180 days) / Conserva este enlace privado para retirar el permiso (180 días):\n${config.publicURL}#guardian/${withdrawalToken}\n\nIf this request is unfamiliar, decline it. Do not forward either link. / Si no reconoces la solicitud, recházala. No reenvíes los enlaces.\nPrivacy / Privacidad: ${config.publicURL}#privacy\nNotice / Aviso: ${GUARDIAN_NOTICE_VERSION}`;
  try{
   const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`guardian-${requestId}`},body:JSON.stringify({from:config.from,to:[to],reply_to:config.replyTo,subject:'Origen Edu: guardian permission / permiso de tutor',text}),signal:AbortSignal.timeout(10000)});
   // Accepted means the provider accepted a send request, not delivered/read.
   return response.ok?'accepted':'failed';
  }catch{return 'failed';}
 }};
}
