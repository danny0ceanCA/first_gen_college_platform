export function voiceConnectionRecovery(disconnect,{schedule=setTimeout,cancel=clearTimeout,delay=8000}={}){
 let timer,stopped=false;
 const clear=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
 return {
  change(state){
   if(stopped)return;
   if(state==='failed'){clear();stopped=true;disconnect();}
   else if(state==='disconnected'){
    if(timer===undefined)timer=schedule(()=>{timer=undefined;stopped=true;disconnect();},delay);
   }else clear();
  },
  stop(){stopped=true;clear();},
 };
}
export function voiceProfile(mode,draft,students,id){
 if(mode==='profile')return draft;
 return id===null?{id:'',name:'',stage:'',interest:'',gpa:'',color:'peach'}:students.find(student=>student.id===id)||draft;
}
