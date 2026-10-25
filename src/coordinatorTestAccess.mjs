// This is an identifier, not a credential. Auth0 alone issues the exemption
// claim after checking this exact synthetic account and its managed metadata.
export const COORDINATOR_TEST_SUBJECT='auth0|6adaf0051ec26ca8f49f32fe';
export const COORDINATOR_TEST_MFA_CLAIM='https://origenedu.ai/coordinator_test_mfa_exempt';
export function coordinatorTestMfaExempt(identity){
 return identity?.sub===COORDINATOR_TEST_SUBJECT&&identity?.[COORDINATOR_TEST_MFA_CLAIM]===COORDINATOR_TEST_SUBJECT;
}
