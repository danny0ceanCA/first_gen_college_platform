import {readFile} from 'node:fs/promises';
import {researchTraceReport} from '../server/research-trace-report.mjs';
// Local operator command. Input is an export from the authenticated diagnostics
// endpoint; no credentials, database connection or provider call is required.
if(!process.argv[2])throw Error('Pass an owner-authorized research diagnostic JSON export path.');
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
process.stdout.write(JSON.stringify(researchTraceReport(input),null,2)+'\n');
