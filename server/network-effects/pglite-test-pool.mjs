/** Test/preview adapter only. It accepts an already-created isolated PGlite database. */
export function createPGlitePool(db) {
  let tail=Promise.resolve();
  const query=async(sql,args)=>{
    const result=args?await db.query(sql,args):(await db.exec(sql)).at(-1);
    return {...result,rowCount:result?.affectedRows??result?.rows?.length??0};
  };
  const connect=async()=>{
    const previous=tail;let unlock;tail=new Promise(resolve=>{unlock=resolve;});await previous;
    let released=false;
    return {query,release(){if(!released){released=true;unlock();}}};
  };
  return {connect,query:async(sql,args)=>{const client=await connect();try{return await client.query(sql,args);}finally{client.release();}}};
}
