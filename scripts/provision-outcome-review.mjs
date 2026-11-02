// Operator-only scope provisioning; the normal application role cannot grant it.
import {createDatabase} from '../server/database.mjs';
import {outcomeDefinition} from '../src/outcomeEvidence.mjs';
const [organization,coordinator,definition,basis,expiry]=process.argv.slice(2);
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
if(!uuid(organization)||!uuid(coordinator)||!outcomeDefinition(definition,1)||!basis||!expiry)throw Error('Usage: node scripts/provision-outcome-review.mjs <organization UUID> <coordinator UUID> <definition ID> <comma-separated bases> <ISO expiry | revoke>');
const bases=[...new Set(basis.split(','))];if(bases.some(v=>!['student_account','direct_observation','declared_record_review'].includes(v))||expiry!=='revoke'&&!Number.isFinite(Date.parse(expiry)))throw Error('Invalid outcome review scope');
if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required. Use the operator credential; ordinary response permission cannot grant outcome scopes.');
const pool=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
try{await pool.query('SELECT origen_outcome_review_grant($1::uuid,$2::uuid,$3::text,$4::text[],$5::timestamptz)',[organization,coordinator,definition,bases,expiry==='revoke'?null:new Date(expiry).toISOString()]);console.log(expiry==='revoke'?'Outcome review scope revoked.':'Outcome review scope recorded. It does not confer institutional verification authority.');}
finally{await pool.end();}
