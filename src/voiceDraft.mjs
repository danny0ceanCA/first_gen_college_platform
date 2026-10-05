// Live onboarding writes directly to its canonical draft. Never replay a second,
// older suggestion snapshot over details the person subsequently corrected.
export function voiceDraft(recovery,live){
 return {
  read(){return live?{}:recovery?.read({})||{};},
  write(changes){if(live){recovery?.clear();return true;}return recovery?.write(changes)??true;},
  accept(previous,next,apply){if(live){apply(next);recovery?.clear();return {};}return {...previous,...next};},
 };
}
