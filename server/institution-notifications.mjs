export async function notifyInstitution(client,id,kind,revision){
 const members=(await client.query('SELECT auth0_subject FROM origen_institution_members WHERE institution_id=$1',[id])).rows;
 for(const member of members)await client.query('INSERT INTO origen_institution_notifications(institution_id,auth0_subject,kind,revision) VALUES($1,$2,$3,$4)',[id,member.auth0_subject,kind,revision]);
}
export async function institutionNotifications(client,subject){
 return (await client.query('SELECT n.id,n.institution_id,n.kind,n.revision,n.created_at,n.read_at,i.draft FROM origen_institution_notifications n JOIN origen_institutions i ON i.id=n.institution_id JOIN origen_institution_members m ON m.institution_id=n.institution_id AND m.auth0_subject=n.auth0_subject WHERE n.auth0_subject=$1 ORDER BY n.created_at DESC LIMIT 50',[subject])).rows.map(row=>({id:row.id,institutionId:row.institution_id,kind:row.kind,revision:row.revision,createdAt:row.created_at,readAt:row.read_at,name:row.draft.name}));
}
