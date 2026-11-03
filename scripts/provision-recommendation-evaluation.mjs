// Operator-only capability. Service-quality and ordinary reply access do not qualify.
import {createDatabase} from '../server/database.mjs';
const [organization,coordinator,expiry]=process.argv.slice(2),uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
if(process.argv.length!==5||!uuid(organization)||!uuid(coordinator)||expiry!=='revoke'&&!Number.isFinite(Date.parse(expiry)))throw Error('Usage: node scripts/provision-recommendation-evaluation.mjs <organization UUID> <reviewer coordinator UUID> <ISO expiry within 90 days | revoke>');
if(!process.env.MIGRATION_DATABASE_URL)throw Error('Operator MIGRATION_DATABASE_URL is required.');
const pool=createDatabase({DATABASE_URL:process.env.MIGRATION_DATABASE_URL});
try{await pool.query('SELECT origen_recommendation_evaluation_grant($1::uuid,$2::uuid,$3::timestamptz)',[organization,coordinator,expiry==='revoke'?null:new Date(expiry).toISOString()]);console.log(expiry==='revoke'?'Recommendation review access revoked.':'Scoped recommendation review access recorded. Separate student opt-ins are required.');}finally{await pool.end();}
