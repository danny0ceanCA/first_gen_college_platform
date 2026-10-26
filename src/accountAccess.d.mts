export function adminAccessDecision(response:Response):Promise<'allowed'|'denied'>;
export function defaultWorkspace(access:{coordinatorAccountsEnabled?:boolean;coordinatorApplicationStatus?:string|null;memberships:unknown[];hasPersonalAccount:boolean},options?:{personalRequested?:boolean}):'coordinator'|'registration'|'institution'|'chooser'|'personal';
