import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {releaseDefinitions,releaseSourceHashes,captureTemplate,reviewPersonalization,comparePersonalization} from '../server/personalization-release.mjs';
const [command='prepare',...paths]=process.argv.slice(2),{catalog,rubric}=await releaseDefinitions();
const read=async p=>JSON.parse(await readFile(p,'utf8'));
if(command==='prepare'){
 const directory=resolve(paths[0]||'output/personalization-release');await mkdir(directory,{recursive:true});
 const sourceHashes=await releaseSourceHashes();
 for(const [name,data] of Object.entries({catalog,rubric,baseline:captureTemplate(catalog,rubric,'baseline',sourceHashes),candidate:captureTemplate(catalog,rubric,'candidate',sourceHashes)}))await writeFile(resolve(directory,name+'.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({directory,casesPerArm:catalog.cases.length,scenarioRuns:catalog.cases.length*2,liveCallsMade:0,budgetAuthorized:false}));
}else{
 const result=command==='review'?reviewPersonalization(catalog,rubric,await read(paths[0])):command==='compare'?comparePersonalization(catalog,rubric,...await Promise.all(paths.map(read))):null;
 if(!result)throw new Error('Use prepare [new-directory], review <capture.json>, or compare <baseline.json> <candidate.json>');
 console.log(JSON.stringify(result,null,2));if(!result.technicalGatePassed)process.exitCode=1;
}
