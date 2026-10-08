import {mkdir,writeFile} from 'node:fs/promises';
import {analyzeConversationQuality,qualityTrends} from '../server/conversation-quality.mjs';

const samples=[
 {synthetic:true,complete:true,language:'en',turns:[{role:'user',text:'How do I pay for college?',topic:'finance',language:'en'},{role:'assistant',text:'Here is a synthetic answer.',language:'en'},{role:'user',text:"I don't understand. Explain it more simply.",topic:'finance',language:'en'},{role:'assistant',text:'Here is a smaller synthetic explanation.',language:'en'},{role:'user',text:'How do I pay for college?',topic:'finance',language:'en'}]},
 {synthetic:true,complete:true,language:'es',turns:[{role:'user',text:'¿Cómo puedo solicitar ingreso?',topic:'admissions',language:'es'},{role:'assistant',text:'You can begin with this synthetic step.',topic:'admissions',language:'en'}],events:[{event:'guide_update_failed',turnIndex:1}]},
 {synthetic:true,complete:true,language:'es',turns:[{role:'user',text:'No entiendo. Explica de otra forma.',topic:'loans',language:'es'},{role:'assistant',text:'Esta es una explicación de ejemplo.',language:'es'}],events:[{event:'lookup_failure',turnIndex:0}]},
 {synthetic:true,complete:true,language:'en',turns:[],events:[{event:'transcription_timeout'},{event:'connection_failure'}],summaries:[{mode:'planning'}]},
];
const reports=samples.map(analyzeConversationQuality);
const output=new URL('../output/conversation-quality-phase-2.json',import.meta.url);
await mkdir(new URL('../output/',import.meta.url),{recursive:true});
await writeFile(output,JSON.stringify({reports,trends:qualityTrends(reports)},null,2)+'\n');
console.log('Synthetic quality report saved to output/conversation-quality-phase-2.json');
