import {readFile,writeFile} from 'node:fs/promises';
import {createDatabase} from '../server/database.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {completeIdentityClosure} from '../ops/auth0-closure.mjs';
const env=process.env,command=process.argv[2];
if(!env.MIGRATION_DATABASE_URL||!['export-deletions','replay-deletions','complete-identity'].includes(command))throw new Error('Set the operator MIGRATION_DATABASE_URL and choose a privacy command.');
if(command==='replay-deletions'&&env.PRIVACY_RESTORE_PENDING!=='true')throw new Error('Keep restored traffic disabled and set PRIVACY_RESTORE_PENDING=true before replay.');
const pool=createDatabase({...env,DATABASE_URL:env.MIGRATION_DATABASE_URL});
try{
 if(command==='export-deletions'){
  if(!env.PRIVACY_JOURNAL_FILE)throw new Error('PRIVACY_JOURNAL_FILE required');
  const manifest=await exportDeletionManifest(pool);await writeFile(env.PRIVACY_JOURNAL_FILE,JSON.stringify(manifest),{flag:'wx',mode:0o600});console.log('Deletion manifest exported. Protect it separately from application backups.');
 }else if(command==='replay-deletions'){
  if(!env.PRIVACY_JOURNAL_FILE||!env.PRIVACY_EXPECTED_CHECKSUM)throw new Error('Trusted journal file and expected checksum required.');
  const manifest=JSON.parse(await readFile(env.PRIVACY_JOURNAL_FILE,'utf8'));
  if(manifest.checksum!==env.PRIVACY_EXPECTED_CHECKSUM)throw new Error('Trusted manifest checksum does not match.');
  const result=await replayDeletionManifest(pool,manifest);console.log(JSON.stringify(result));
 }else{
  await completeIdentityClosure(pool,{subject:env.PRIVACY_AUTH0_SUBJECT,domain:env.AUTH0_DOMAIN,token:env.AUTH0_MANAGEMENT_TOKEN});console.log('The requested Auth0 identity closure is complete.');
 }
}catch{
 console.error('Privacy operation failed. Keep recovery traffic disabled and identity requests pending; verify operator configuration and prerequisites.');process.exitCode=1;
}finally{await pool.end();}
