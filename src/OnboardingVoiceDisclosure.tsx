/** Shown before microphone capture, independently of the AI's spoken welcome. */
export default function OnboardingVoiceDisclosure({id,t}:{id:string;t:(en:string,es:string)=>string}) {
 return <div id={id} className="voice-privacy-disclosure">
  <p>{t('Starting sends microphone audio and the profile details you provide to OpenAI. Origen does not save microphone recordings; OpenAI’s retention is separate.','Al comenzar, se envían a OpenAI el audio del micrófono y los datos del perfil que proporcionas. Origen no guarda grabaciones del micrófono; la retención de OpenAI es independiente.')}</p>
  <p>{t('After you speak, Origen normally generates a summary automatically when the call ends, without separate approval. During setup, saving it to your account may wait until you save the profile. Saving your profile is a separate action: use Save profile or ask Origen to save it.','Después de que hables, Origen normalmente genera un resumen automáticamente al terminar la llamada, sin aprobación adicional. Durante el registro, guardarlo en tu cuenta puede esperar hasta que guardes el perfil. Guardar el perfil es una acción separada: usa Guardar perfil o pídele a Origen que lo guarde.')}</p>
 </div>;
}
