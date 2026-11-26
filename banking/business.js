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
    const error=new HttpError(403,'Business banking access is restricted. Contact bank support before making account or payment changes.');
    error.code='BUSINESS_APPROVAL_REQUIRED';throw error;
  }
  if(accountId && !(await db.query('SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2 AND business_id=$3',[accountId,user.id,row.id])).rowCount)throw new HttpError(409,'This account is not linked to your approved business.');
  return view(row);
}
module.exports={normalize,view,own,create,assertApproved};
