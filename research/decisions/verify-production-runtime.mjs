import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Separate from the historical local-only isolation assertion. This release
// intentionally adds production wiring; it must never claim runtime unchanged.
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('./production-runtime-review.json',import.meta.url),'utf8'));
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/').replace(/\/$/,'')}`,...args],{cwd:root,encoding:'utf8'});
const runtime=path=>path&&!path.startsWith('docs/')&&path!=='AGENTS.md'&&!path.startsWith('research/decisions/');
const changed=git('diff',manifest.baselineCommit,'--name-only').split(/\r?\n/).filter(runtime).sort();
const expected=manifest.files.map(row=>row.path).sort();
if(JSON.stringify(changed)!==JSON.stringify(expected))throw Error('unreviewed_production_runtime_paths');
for(const row of manifest.files){
  const body=readFileSync(resolve(root,row.path),'utf8').replaceAll('\r\n','\n');
  if(createHash('sha256').update(body).digest('hex')!==row.sha256)throw Error('production_runtime_hash_changed:'+row.path);
}
console.log(JSON.stringify({matchesReviewedRelease:true,originalRuntimeUnchanged:false,
  baselineCommit:manifest.baselineCommit,reviewedFiles:expected.length,checks:'normalized_LF_sha256_and_exact_runtime_paths'}));
