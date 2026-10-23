// pg-pool can resolve end() before its client.end callbacks emit remove.
// Wait for those socket closures before a fixture drops its database.
export async function closeTestPool(pool){
 if(!pool)return;
 const count=pool.totalCount;
 if(!count){await pool.end();return;}
 let removed=0,timer,onRemove;
 const closed=new Promise((resolve,reject)=>{
  onRemove=()=>{if(++removed===count)resolve();};
  pool.on('remove',onRemove);
  timer=setTimeout(()=>reject(Error('test_pool_close_timeout')),5000);
 });
 try{await Promise.all([pool.end(),closed]);}
 finally{clearTimeout(timer);pool.off('remove',onRemove);}
}
