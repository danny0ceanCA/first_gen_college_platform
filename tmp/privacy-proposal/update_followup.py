from pathlib import Path
root=Path(__file__).resolve().parents[2]
def replace(path,old,new):
    p=root/path
    text=p.read_text(encoding='utf-8')
    assert text.count(old)==1,(path,old[:70],text.count(old))
    p.write_text(text.replace(old,new),encoding='utf-8')

replace('src/ProfileVoice.tsx','{!onboarding&&<p className="small-text">{routing?', '{onboarding?<OnboardingVoiceDisclosure id={disclosureId} t={t}/>:<p className="small-text">{routing?')
replace('src/ProfileVoice.tsx',"{state==='idle'?<VoiceStartButton label=", "{state==='idle'?<VoiceStartButton aria-describedby={onboarding?disclosureId:undefined} label=")
replace('src/Welcome.tsx','You will review everything before saving.','You can review profile details before saving. Conversation summaries save separately and automatically.')
replace('src/Welcome.tsx','Revisarás todo antes de guardar.','Puedes revisar los datos del perfil antes de guardarlos. Los resúmenes se guardan por separado y automáticamente.')
replace('src/Welcome.tsx','After a voice conversation, a short summary helps Origen remember what you discussed. Find it in Home after saving the profile.','After you speak in a voice conversation, Origen normally generates a summary automatically when the call ends, without separate approval. During setup, saving it to your account may wait until you save the profile. Find saved summaries in Home.')
replace('src/Welcome.tsx','Después de una charla, un resumen breve ayuda a Origen a recordar lo conversado. Lo encontrarás en Inicio al guardar el perfil.','Después de que hables en una conversación de voz, Origen normalmente genera un resumen automáticamente al terminar la llamada, sin aprobación adicional. Durante el registro, guardarlo en tu cuenta puede esperar hasta que guardes el perfil. Encontrarás los resúmenes guardados en Inicio.')
replace('src/voiceWelcome.mjs','Do not give an app tour or explain features or summaries before the profile is saved.','Do not give an app tour before the profile is saved. The screen discloses OpenAI processing and automatic summaries before voice starts. If asked about privacy or saving, explain accurately: microphone audio and supplied profile details go to OpenAI; after user speech in a confirmed scope, a summary normally generates and saves automatically when the call ends, without separate summary approval. During onboarding its account save can wait for the profile to exist. Saving the profile is a separate user request. Never say every saved record requires review.')
replace('src/voiceWelcome.mjs','Al terminar una charla y guardar su resumen, Origen prepara los puntos clave para los temas que conversamos.','Después de que hablas y termina la llamada, el resumen normalmente se genera y guarda automáticamente, sin aprobación adicional. Con el resumen guardado, Origen prepara los puntos clave para los temas que conversamos.')
replace('src/voiceWelcome.mjs','After a conversation ends and its summary saves, Origen prepares key points for the topics we covered.','After you speak and the call ends, its summary normally generates and saves automatically, without separate approval. Once the summary saves, Origen prepares key points for the topics we covered.')
