import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadPolicy} from './policy.mjs';
import {gatewayClient} from './gateway-client.mjs';
import {startInvestigation} from './broker.mjs';
import {assertAgentRole,auditWriter,reportStore} from './audit.mjs';
import {telemetryPool,assertServiceIsolation} from '../observability/config.mjs';
import {createProtocol,serveProtocol} from './protocol.mjs';
import {capabilityEnabled} from '../diagnostic-controls.mjs';
export async function startBroker(env=process.env){
 assertServiceIsolation(env);
 if(env.DIAGNOSTIC_AGENT_ENABLED!=='true'||env.SUPPORT_CONTROL_DATABASE_URL||env.TELEMETRY_QUERY_DATABASE_URL||env.APPLICATION_SUPPORT_DATABASE_URL)throw Error('agent_configuration_invalid');
 const auditUrl=new URL(env.AGENT_AUDIT_DATABASE_URL),reportsUrl=new URL(env.AGENT_REPORT_DATABASE_URL);
 if(auditUrl.hostname!==reportsUrl.hostname||auditUrl.port!==reportsUrl.port||auditUrl.pathname!==reportsUrl.pathname||auditUrl.username===reportsUrl.username)throw Error('agent_configuration_invalid');
 const policy=await loadPolicy({policyFile:env.AGENT_POLICY_FILE,expectedDigest:env.AGENT_POLICY_SHA256,agentWorkspace:env.AGENT_WORKSPACE});
 const secret=async file=>{const bytes=await readFile(file);if(bytes.length>8192)throw Error();return bytes.toString('utf8').trim();};
 const token=await secret(env.AGENT_GATEWAY_TOKEN_FILE),capability=await secret(env.AGENT_CAPABILITY_FILE),publicKey=await secret(env.SUPPORT_VERIFY_KEY_FILE);
 const audit=telemetryPool(env,'AGENT_AUDIT_DATABASE_URL'),reports=telemetryPool(env,'AGENT_REPORT_DATABASE_URL');let broker;
 try{
  await assertAgentRole(audit,'audit');await assertAgentRole(reports,'reports');for(const pool of [audit,reports])if((await pool.query('SELECT pg_is_in_recovery() AS replica')).rows[0]?.replica!==false)throw Error();
  broker=await startInvestigation({capability,publicKey,audience:env.DIAGNOSTICS_AUDIENCE,policy,gateway:gatewayClient({url:env.AGENT_GATEWAY_URL,token}),audit:auditWriter(audit),reports:reportStore(reports),enabled:()=>env.DIAGNOSTIC_AGENT_ENABLED==='true'&&capabilityEnabled(env.DIAGNOSTIC_AGENT_CONTROL_FILE)});
  return {broker,close:async()=>{try{await broker.close();}finally{await Promise.all([audit.end(),reports.end()]);}}};
 }catch(error){await Promise.all([audit.end(),reports.end()]);throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let app;try{app=await startBroker();const stop=()=>{void app.close().finally(()=>process.exit(0));};process.once('SIGTERM',stop);process.once('SIGINT',stop);await serveProtocol(process.stdin,process.stdout,createProtocol(app.broker));}catch{process.stderr.write('Diagnostic broker unavailable.\n');process.exitCode=1;}finally{await app?.close();}}
