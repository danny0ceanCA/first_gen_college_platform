import './AuthenticatorGuide.css';

export function AuthenticatorGuide({es=false}:{es?:boolean}){
 const t=(en:string,sp:string)=>es?sp:en;
 return <details className="authenticator-guide">
  <summary>{t('First time using an authenticator? Here’s how.','¿Es tu primera vez con una app de autenticación? Así funciona.')}</summary>
  <ol>
   <li>{t('Install the free Google Authenticator app on your phone, or use an authenticator app you already have.','Instala la app gratuita Google Authenticator en tu teléfono o usa una app de autenticación que ya tengas.')} <span className="authenticator-downloads"><a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank" rel="noopener noreferrer">Android</a><a href="https://apps.apple.com/app/google-authenticator/id388497605" target="_blank" rel="noopener noreferrer">iPhone</a></span></li>
   <li>{t('When Origen asks you to verify your identity, sign in and follow the setup screen. Use your authenticator app to scan its QR code. If you’re using the same phone, choose the manual setup option instead.','Cuando Origen te pida verificar tu identidad, inicia sesión y sigue las instrucciones. Escanea el código QR con tu app de autenticación. Si estás usando el mismo teléfono, elige la opción de configuración manual.')}</li>
   <li>{t('Enter the six-digit code from the app to finish. When verification is requested later, open the app for a new code.','Ingresa el código de seis dígitos de la app para terminar. Cuando se te pida verificar de nuevo, abre la app para obtener un código nuevo.')}</li>
  </ol>
  <p>{t('Save the recovery code shown during setup somewhere private. It helps you regain access if you lose your phone.','Guarda el código de recuperación que aparece durante la configuración en un lugar privado. Te ayudará a recuperar el acceso si pierdes tu teléfono.')}</p>
 </details>;
}

export function CoordinatorReadiness({es=false}:{es?:boolean}){
 const t=(en:string,sp:string)=>es?sp:en;
 return <section className="coordinator-readiness" aria-label={t('What to have ready','Qué necesitas tener a mano')}>
  <h2>{t('What to have ready','Qué necesitas tener a mano')}</h2>
  <ul><li>{t('An email address you can verify.','Una dirección de correo que puedas verificar.')}</li><li>{t('For workspace access: a phone with a free authenticator app.','Para acceder al espacio de trabajo: un teléfono con una app de autenticación gratuita.')}</li></ul>
  <p>{t('You can apply first. You’ll set up two-step verification when you’re asked to verify your identity for staff access. This helps protect the binder pages students choose to share.','Puedes enviar tu solicitud primero. Configurarás la verificación en dos pasos cuando se te pida verificar tu identidad para acceder como personal. Esto ayuda a proteger las páginas que los estudiantes eligen compartir.')}</p>
  <AuthenticatorGuide es={es}/>
 </section>;
}
