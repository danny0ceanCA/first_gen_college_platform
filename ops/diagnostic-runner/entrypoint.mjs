// Trusted image entrypoint, never sourced from candidate files. No shell or npm scripts.
import {mkdir,writeFile,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {profiles,buildSecondCommand} from './profiles.mjs';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>20*1024*1024)process.exit(65);}
const payload=JSON.parse(raw);raw='';
if(process.versions.node.split('.')[0]!=='22'||!Object.hasOwn(profiles,payload.testProfile))process.exit(65);
for(const {path,content} of payload.files){
 if(!/^[a-zA-Z0-9_./-]+$/.test(path)||path.startsWith('/')||path.split('/').some(p=>p==='..'||p==='.'||p==='node_modules'))process.exit(65);
 await mkdir(`/workspace/${path.slice(0,path.lastIndexOf('/')+1)}`,{recursive:true});await writeFile(`/workspace/${path}`,content,{flag:'wx',mode:0o600});
}
await symlink('/opt/deps/node_modules','/workspace/node_modules');
// Approved optional regression paths exist in every run, so a missing new test is not an arbitrary argv override.
for(const p of ['server/runner-regression.test.mjs','server/permission-runner-regression.test.mjs']){try{await writeFile(`/workspace/${p}`,'// No candidate regression in this run.\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}
async function run(argv){return new Promise(resolve=>{const child=spawn(argv[0],argv.slice(1),{shell:false,cwd:'/workspace',env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/workspace',TMPDIR:'/workspace',NODE_ENV:'test',CI:'true'},stdio:['ignore','inherit','inherit']});child.on('error',()=>resolve(70));child.on('close',code=>resolve(code??70));});}
let code=await run(profiles[payload.testProfile]);if(code===0&&payload.testProfile==='frontend-build')code=await run(buildSecondCommand);process.exit(code);
