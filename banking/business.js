'use strict';

const {HttpError}=require('../models/errors');
const iso=value=>value?new Date(value).toISOString():null;
const nowDate=now=>new Date((now||Date.now)());
function text(value,label,min,max){
  if(typeof value!=='string')throw new HttpError(400,`Enter ${label}.`);
  const result=value.trim().replace(/\s+/g,' ');
  if(result.length<min||result.length>max||/[\u0000-\u001f\u007f]/.test(result))throw new HttpError(400,`Enter ${label} using ${min}–${max} characters.`);
  return result;
}
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'A registered business profile is required.');
  if(input.country!=='SG')throw new HttpError(400,'This project supports Singapore-registered business profiles.');
  if(!['company','partnership','institution'].includes(input.legalForm))throw new HttpError(400,'Choose a business legal form. Personal accounts are not offered.');
  const registrationNumber=text(input.registrationNumber,'the business registration number',6,30).toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9-]{5,29}$/.test(registrationNumber))throw new HttpError(400,'Use letters, numbers or hyphens for the business registration number.');
  return {legalName:text(input.legalName,'the registered business name',2,160),registrationNumber,country:'SG',legalForm:input.legalForm,
    industry:text(input.industry,'the business industry',2,100),registeredAddress:text(input.registeredAddress,'the registered business address',8,300)};
}
function view(row){return row?{id:String(row.id),primaryUserId:String(row.primary_user_id),legalName:row.legal_name,registrationNumber:row.registration_number,country:row.country,
  legalForm:row.legal_form,industry:row.industry,registeredAddress:row.registered_address,status:row.status,version:row.version,review:row.review_json,
  createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}:null;}
async function own(db,user){return view((await db.query('SELECT * FROM businesses WHERE primary_user_id=$1',[user.id])).rows[0]);}
async function create(client,user,profile,{now=Date.now,status='pending_review'}={}){
  const value=normalize(profile),date=nowDate(now);
  const row=(await client.query(`INSERT INTO businesses(primary_user_id,legal_name,registration_number,country,legal_form,industry,registered_address,status,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,[user.id,value.legalName,value.registrationNumber,value.country,value.legalForm,value.industry,value.registeredAddress,status,date])).rows[0];
  await client.query('UPDATE accounts SET business_id=$2 WHERE user_id=$1 AND business_id IS NULL',[user.id,row.id]);
  return view(row);
}
async function assertApproved(db,user,{accountId}={}){
  const row=(await db.query('SELECT * FROM businesses WHERE primary_user_id=$1',[user.id])).rows[0];
  if(!row||row.status!=='approved'){
    const error=new HttpError(403,'Complete your business profile and obtain bank onboarding approval before making account or payment changes.');
    error.code='BUSINESS_APPROVAL_REQUIRED';throw error;
  }
  if(accountId && !(await db.query('SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2 AND business_id=$3',[accountId,user.id,row.id])).rowCount)throw new HttpError(409,'This account is not linked to your approved business.');
  return view(row);
}
async function submit(db,user,body,{authorize,now=Date.now}={}){
  const profile=normalize(body?.business),authorization=await authorize(db,user,body.authorizationPassword,now);
  try{return await db.transaction(async client=>{
    await require('./ledger').assertAuthorization(client,user,authorization);
    const old=(await client.query('SELECT * FROM businesses WHERE primary_user_id=$1 FOR UPDATE',[user.id])).rows[0];
    if(!old&&user.role==='admin')throw new HttpError(403,'Bank staff use the operations workspace. Business banking requires a separate authorized business user.');
    if(old?.status==='approved')throw new HttpError(409,'Approved business identity changes require bank assistance.');
    let business;
    if(old){
      if(body.version!==old.version)throw new HttpError(409,'Your business application changed. Reload before submitting.');
      business=view((await client.query(`UPDATE businesses SET legal_name=$2,registration_number=$3,country=$4,legal_form=$5,industry=$6,registered_address=$7,status='pending_review',review_json=NULL,version=version+1,updated_at=$8 WHERE id=$1 RETURNING *`,
        [old.id,profile.legalName,profile.registrationNumber,profile.country,profile.legalForm,profile.industry,profile.registeredAddress,nowDate(now)])).rows[0]);
    }else business=await create(client,user,profile,{now});
    await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'business.application_submitted',$2,$3)",[user.id,{businessId:business.id,version:business.version},nowDate(now)]);
    return business;
  });}catch(error){if(error.code==='23505')throw new HttpError(409,'A business application with these registration details already exists.');throw error;}
}
async function applications(db,actor,{status='pending_review'}={}){
  require('./ledger').requireAdmin(actor);
  if(!['pending_review','approved','rejected'].includes(status))throw new HttpError(400,'Choose a valid business application status.');
  return (await db.query(`SELECT b.*,u.name AS contact_name,u.email AS contact_email FROM businesses b JOIN users u ON u.id=b.primary_user_id WHERE b.status=$1 ORDER BY b.created_at,b.id LIMIT 200`,[status])).rows
    .map(row=>({...view(row),contact:{name:row.contact_name,email:row.contact_email}}));
}
async function review(db,actor,id,body,{authorize,now=Date.now}={}){
  require('./ledger').requireAdmin(actor);
  if(!/^[1-9]\d{0,18}$/.test(String(id))||BigInt(id)>9223372036854775807n)throw new HttpError(400,'Choose a valid business application.');
  if(!body||!['approve','reject'].includes(body.decision)||!Number.isSafeInteger(body.version))throw new HttpError(400,'Choose a decision and supply the application version.');
  const reason=text(body.reason,'a review reason',3,500);
  if(body.decision==='approve'&&body.verificationConfirmed!==true)throw new HttpError(400,'Confirm that the business verification checks have been completed.');
  const authorization=await authorize(db,actor,body.authorizationPassword,now);
  return db.transaction(async client=>{
    const candidate=(await client.query('SELECT primary_user_id FROM businesses WHERE id=$1',[id])).rows[0];
    if(!candidate)throw new HttpError(404,'Business application not found.');
    await client.query('SELECT id FROM users WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[[actor.id,candidate.primary_user_id]]);
    await require('./ledger').assertAuthorization(client,actor,authorization,{admin:true});
    const row=(await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(String(row.primary_user_id)===String(actor.id))throw new HttpError(403,'An independent bank administrator must review this business.');
    if(row.status!=='pending_review'||row.version!==body.version)throw new HttpError(409,'This application has changed or has already been reviewed.');
    const date=nowDate(now),decision={decision:body.decision,reason,verificationConfirmed:body.decision==='approve',reviewedBy:{id:String(actor.id),name:actor.name},reviewedAt:date.toISOString()};
    const business=view((await client.query('UPDATE businesses SET status=$2,version=version+1,review_json=$3,updated_at=$4 WHERE id=$1 RETURNING *',[id,body.decision==='approve'?'approved':'rejected',decision,date])).rows[0]);
    await require('./ledger').enqueue(client,{userId:row.primary_user_id,type:'business.reviewed',title:body.decision==='approve'?'Business banking approved':'Business application needs attention',message:reason,metadata:{businessId:String(id)},createdAt:date.toISOString()});
    await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$2,'business.application_reviewed',$3,$4)",[actor.id,row.primary_user_id,{businessId:String(id),version:business.version,...decision},date]);
    return business;
  });
}
module.exports={normalize,view,own,create,assertApproved,submit,applications,review};
