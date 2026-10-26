import {binderTopics} from './binderSignals.mjs';

// Topic views read the same proposed/confirmed memory records. They do not
// copy goals into notes or infer a topic for untagged or family-scoped details.
export function binderMemoryEntries(memories,studentId,topic){
 return (memories||[]).filter(item=>item.studentId===studentId&&['proposed','confirmed'].includes(item.status)&&binderTopics.includes(item.organization?.topic)&&(!topic||item.organization.topic===topic));
}
export const binderMemorySignalId=id=>`memory:${id}`;
