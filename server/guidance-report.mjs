import {createDatabase} from './database.mjs';
import {pathToFileURL} from 'node:url';

// Operator-only aggregate report. No account/student/session IDs are output.
export async function guidanceReport(database){
 const cutoff=new Date(Date.now()-90*86400000);
 const sessions=(await database.query('SELECT count(*) AS count FROM origen_guidance_sessions WHERE started_at >= $1',[cutoff])).rows[0];
 const connections=(await database.query("SELECT count(DISTINCT session_id) AS count FROM origen_guidance_events WHERE name='voice.connected' AND received_at >= $1",[cutoff])).rows[0];
 const attempts=(await database.query("SELECT status,count(*) AS count FROM origen_ai_executions WHERE operation='voice' AND started_at >= $1 GROUP BY status",[cutoff])).rows;
 return {windowDays:90,logicalSessions:Number(sessions.count),sessionsWithClientConnection:Number(connections.count),negotiationsByStatus:Object.fromEntries(attempts.map(row=>[row.status,Number(row.count)])),coverage:'Server SDP negotiation onwards; microphone-permission failures are not captured. Browser connection observations can be missing. Reconnecting for another student retains one logical session. Preview traffic is excluded by the collection path.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const database=createDatabase();if(!database)throw new Error('DATABASE_URL is required');
 try{console.log(JSON.stringify(await guidanceReport(database),null,2));}finally{await database.end();}
}
