import {subjectHash,accountClosed} from './account-lifecycle.mjs';
// Call immediately after BEGIN on the same client as the protected operation.
// PostgreSQL row locks serialize closure with all subject-scoped transactions,
// including first registration (where no account row exists yet).
export async function guardAccountTransaction(client,subject){
 const key=subjectHash(subject);
 await client.query('INSERT INTO origen_subject_locks(subject_hash) VALUES($1) ON CONFLICT(subject_hash) DO NOTHING',[key]);
 await client.query('SELECT subject_hash FROM origen_subject_locks WHERE subject_hash=$1 FOR UPDATE',[key]);
 if(await accountClosed(client,subject))throw Object.assign(new Error('account_closed'),{status:403});
}
