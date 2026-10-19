const names=new Set(['lookup_coordinator_code','prepare_coordinator_connection']);
const cancelled={status:'cancelled',instruction:'This turn was superseded. Nothing is confirmed. Follow the newest turn.'};
export function coordinatorVoiceTools({post,studentId,onPrepared,onClear,onCode=()=>{}}){
 let context,opening,registration=Promise.resolve(),sequence=0,stopped=false,turnId;
 const calls=new Map();
 const base=()=>({contextId:context,sequence});
 const close=id=>post({action:'close',contextId:id}).catch(()=>{});
 return {
  isTool:name=>names.has(name),sequence:()=>sequence,
  configure(enabled){if(!enabled||opening||stopped)return;opening=post({action:'open',studentId,channel:'voice'}).then(async r=>{if(stopped){await close(r.contextId);return;}context=r.contextId;if(turnId)await post({action:'turn',...base(),turnId});}).catch(()=>{});registration=opening;},
  begin(id){if(stopped||turnId===id)return;turnId=id;sequence++;onClear();const seq=sequence;registration=Promise.resolve(opening).then(()=>context&&!stopped?post({action:'turn',contextId:context,sequence:seq,turnId:id}):null).catch(()=>null);},
  async invoke(item,expectedSequence=sequence){
   if(!names.has(item.name))return null;
   if(stopped||expectedSequence!==sequence)return cancelled;
   const key=`${sequence}:${item.call_id}`;if(calls.has(key))return calls.get(key);
   const seq=sequence;
   const task=(async()=>{try{
    const args=JSON.parse(item.arguments),field=item.name==='lookup_coordinator_code'?'code':'challengeId';
    if(!args||Object.keys(args).length!==1||typeof args[field]!=='string')throw new Error();
    if(field==='code')onCode(args.code);
    await registration;if(!context||stopped||seq!==sequence)return cancelled;
    const r=await post({action:field==='code'?'lookup':'prepare',contextId:context,sequence:seq,...args});
    if(stopped||seq!==sequence)return cancelled;
    if(field==='challengeId')onPrepared({...r,contextId:context,sequence:seq});
    return {...r,instruction:field==='code'?'Read back the name and organization. Prepare the card using this challenge. Never save the code.':'The student must press Confirm request on screen. No connection or binder sharing is authorized yet.'};
   }catch{return {status:'unavailable',instruction:'No connection is confirmed. Offer typing the code in the binder. Do not guess or automatically retry.'};}})();calls.set(key,task);return task;
  },
  stop(){stopped=true;sequence++;onClear();if(context)void close(context);},
 };
}
