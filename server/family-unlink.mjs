export const sharedColumns=['name','stage','interest','gpa','color','institutions','entry_term','school','activities','goals'];

// Caller owns the account transaction. Preserve the remaining participant's
// academic snapshot and private records before detaching the relationship.
export async function unlinkFamily(client,account,id){
 if(client.isolated){
  try{return (await client.query("SELECT origen_family_link_command('unlink',$1) AS result",[id])).rows[0].result;}
  catch(error){if(error.message==='link_not_found')throw Object.assign(error,{status:404});throw error;}
 }
 const link=(await client.query('SELECT * FROM origen_student_links WHERE id=$1 AND (owner_account_id=$2 OR member_account_id=$2) FOR UPDATE',[id,account])).rows[0];
 if(!link)throw Object.assign(new Error('link_not_found'),{status:404});
 const snapshot=(await client.query(`SELECT ${sharedColumns.join(',')} FROM origen_students WHERE account_id=$1 AND id=$2 FOR UPDATE`,[link.owner_account_id,link.owner_student_id])).rows[0];
 if(snapshot)await client.query(`UPDATE origen_students SET ${sharedColumns.map((c,i)=>`${c}=$${i+3}`).join(',')},updated_at=now() WHERE account_id=$1 AND id=$2`,[link.member_account_id,link.member_student_id,...sharedColumns.map(c=>snapshot[c])]);
 await client.query('DELETE FROM origen_student_links WHERE id=$1',[link.id]);
 return {};
}
