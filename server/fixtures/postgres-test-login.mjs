// Disposable integration-test roles only. Never imported by application runtime.
import {randomBytes} from 'node:crypto';

const passwords=new Map();
export async function createTestLogin(database,role){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(role))throw Error('invalid_test_role');
 const password=randomBytes(32).toString('hex');
 // Both interpolations are restricted to identifier/hex alphabets above.
 await database.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
 passwords.set(role,password);
}
export function useTestLogin(url,role){
 if(!passwords.has(role))throw Error('unknown_test_role');
 url.username=role;url.password=passwords.get(role);
 return url;
}
