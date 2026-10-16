import {execFileSync} from 'node:child_process';
import {sourcePath,hash} from './contracts.mjs';
// Operator-only: reads an immutable commit, never a working tree, .env or git archive tar.
const revision=process.argv[2];if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('exact_commit_required');
const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,...args],{maxBuffer:24*1024*1024,encoding:'utf8',shell:false});
const tree=git(['ls-tree','-r','-z',revision]).split('\0').filter(Boolean),files=[];
for(const row of tree){const match=/^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(row);if(!match)continue;const [,mode,object,path]=match;try{sourcePath(path);}catch{continue;}if(mode!=='100644'&&mode!=='100755')throw Error('source_link_denied');const content=git(['cat-file','blob',object]);if(content.includes('\0'))throw Error('binary_source_denied');files.push({path,content});}
const lock=files.find(f=>f.path==='package-lock.json');if(!lock)throw Error('lockfile_required');
process.stdout.write(JSON.stringify({bundle:{revision,files},release:{revision,lockDigest:hash(lock.content),files:files.map(f=>({path:f.path,sha256:hash(f.content)}))}})+'\n');
