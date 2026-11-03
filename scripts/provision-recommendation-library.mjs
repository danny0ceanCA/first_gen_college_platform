// Operator-only; never run with an application credential or a student's consent.
import {createDatabase} from '../server/database.mjs';
import {actionProcesses} from '../src/recommendationLibrary.mjs';
const [subject,roles,processes,expiry]=process.argv.slice(2);
const selectedRoles=roles?.split(',')||[],selectedProcesses=processes?.split(',')||[];
if(!subject||!selectedRoles.length||selectedRoles.some(r=>!['author','publisher'].includes(r))||!selectedProcesses.length||selectedProcesses.some(p=>!actionProcesses.includes(p))||expiry!=='revoke'&&(!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<=Date.now()||Date.parse(expiry)>Date.now()+90*86400000))throw Error('Usage: node scripts/provision-recommendation-library.mjs <subject> <author,publisher | author | publisher> <comma-separated processes> <ISO expiry within 90 days | revoke>');
if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL required. Only an operator can grant reusable action publication authority.');
const pool=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
try{await pool.query('SELECT origen_recommendation_library_grant($1,$2,$3,$4::text[],$5::timestamptz)',[subject,selectedRoles.includes('author'),selectedRoles.includes('publisher'),selectedProcesses,expiry==='revoke'?null:new Date(expiry).toISOString()]);console.log('Action library permission updated. Publications under the previous grant are unavailable until reviewed and republished.');}
finally{await pool.end();}
