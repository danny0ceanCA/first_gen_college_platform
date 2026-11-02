import {createHash} from 'node:crypto';
import {qualityRows} from '../outcome-quality.mjs';
import {outcomeDefinitions} from '../../src/outcomeEvidence.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const syntheticQualityOptions=Object.freeze({definitionId:'document_submitted',period:'2026-10',cutoff:'2026-11-02T00:00:00.000Z',synthetic:true});
// Invented structured inputs run through the same deterministic assessment rules.
export function syntheticQualityRows(){
 const items=Array.from({length:40},(_,i)=>{
  const episodeKey=hash(`synthetic-episode-${i}`),recordedAt='2026-10-15T12:00:00.000Z';
  return {episodeKey,participantKey:hash(`synthetic-participant-${i}`),permissionVersion:1,corrections:i%4===0?1:0,trackingSince:'2026-10-20T12:00:00.000Z',
   episode:{id:episodeKey,version:1,definition_id:'document_submitted',definition_version:1,recorded_at:recordedAt,institution:'present',term:'present',cycle:'present',window_start:'2026-10-01',window_end:i<20?'2026-10-31':i<30?'2026-12-31':'2026-10-31',time_zone:'America/Chicago',state:'current',valid_until:'2027-01-01T00:00:00Z'},
   evidence:[{id:hash(`synthetic-evidence-${i}`),version:1,episode_id:episodeKey,report_id:hash(`synthetic-report-${i}`),report_version:1,response_state:i<20?'answered':i<30?'declined':'unknown',claim_status:i<10?'occurred':i<20?'pending':null,decision:null,event_on:i<20?'2026-10-15':null,time_zone:'America/Chicago',recorded_at:recordedAt}]
  };
 });
 return qualityRows({items,definitions:outcomeDefinitions},new Date(syntheticQualityOptions.cutoff));
}
