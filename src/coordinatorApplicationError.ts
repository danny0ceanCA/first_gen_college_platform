type Translate=(en:string,es:string)=>string;
export function applicationError(error:string,t:Translate){
 const messages:Record<string,string>={
  invalid_organization_website:t('Enter a website such as example.org or https://example.org.','Escribe un sitio web como ejemplo.org o https://ejemplo.org.'),
  name_required:t('Enter your first and last name.','Escribe tu nombre y apellido.'),
  name_too_long:t('Use a first and last name totaling 100 characters or fewer.','Usa un nombre y apellido de hasta 100 caracteres en total.'),
  organization_changed:t('Organization access changed. Refresh access and review its current status before approving again.','El acceso de la organización cambió. Actualiza el acceso y revisa su estado antes de aprobar de nuevo.'),
  coordinator_review_busy:t('Review is busy. Wait a moment, then refresh applications to check the latest status.','La revisión está ocupada. Espera un momento y actualiza las solicitudes para ver el estado actual.'),
  coordinator_sharing_unavailable:t('Coordinator registration is not open yet. Please check back with the Origen team.','El registro de coordinadores aún no está abierto. Consulta con el equipo de Origen.'),
  verified_email_required:t('Verify your sign-in email, then select Refresh status.','Verifica tu correo de inicio de sesión y selecciona Actualizar estado.'),
  invitation_email_required:t('Sign in again so we can verify your email.','Inicia sesión de nuevo para verificar tu correo.'),
  identity_verification_unavailable:t('The sign-in service is temporarily unavailable. Wait a moment, then select Refresh status. You do not need to verify your email again.','El servicio de inicio de sesión no está disponible temporalmente. Espera un momento y selecciona Actualizar estado. No necesitas verificar tu correo de nuevo.'),
  application_membership_required:t('The applicant must first accept an invitation to the selected organization. Use Invitations and team in its owner workspace.','La persona debe aceptar primero una invitación a la organización seleccionada. Usa Invitaciones y equipo en el espacio del propietario.'),
  application_review_required:t('The Origen team must approve this coordinator’s application before access can be enabled.','El equipo de Origen debe aprobar la solicitud de este coordinador antes de activar su acceso.'),
  application_changed:t('This application has changed. Refresh the list before reviewing it.','Esta solicitud ha cambiado. Actualiza la lista antes de revisarla.'),
  independent_review_required:t('An independent Origen reviewer must review this application. You cannot approve yourself or your own organization.','Un revisor independiente de Origen debe revisar esta solicitud. No puedes aprobarte ni aprobar tu propia organización.'),
  organization_verification_required:t('Choose an organization whose affiliation and coordinator pilot have been approved.','Elige una organización con afiliación y piloto de coordinadores aprobados.'),
 };
 return messages[error]||t('We couldn’t complete this request. Please try again.','No pudimos completar la solicitud. Intenta de nuevo.');
}
