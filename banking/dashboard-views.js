'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const companyActivity=require('./company-activity');
const object=value=>value && typeof value==='object' && !Array.isArray(value);
const day=value=>new Date(value+8*3600000).toISOString().slice(0,10);
const SAVE_INTENT=/\b(?:save|bookmark)\b.{0,100}\b(?:dashboard|view|summary|report|it|this|that)\b|\bkeep\s+(?:(?:this|that|the|my)\s+)?(?:dashboard|view|summary|report)\b/i;
const FOLLOWUP=/^\s*(?:(?:please|can you|could you|yes)[,\s]+)*(?:save|bookmark|keep)\s+(?:(?:it|this|that)(?:\s+(?:dashboard|view))?|(?:the|my)\s+(?:dashboard|view))(?:\s+as\s+(?:a\s+)?(?:dashboard\s*view|dashboard|view))?(?:\s+for\s+(?:later|future use))?[.!?]*\s*$/i;
function saveIntent(message){message=String(message).replace(/\u2019/g,"'");return !/\b(?:how\s+(?:to|do|can|should|would)|tell me how|explain|instructions?|steps?|not (?:now|yet|today))\b/i.test(message) && SAVE_INTENT.test(message) && !/\b(?:do not|don't|dont|never|without)\s+(?:\w+\s+){0,2}(?:save|saving|bookmark|keep)\b/i.test(message) && !/\b(?:how|can|could)\s+(?:do\s+)?(?:I|one|someone)\b/i.test(message);}
function followup(message){return saveIntent(message) && FOLLOWUP.test(message);}
function canonical(value){
 if(!object(value) || Object.keys(value).some(key=>!['scope','company','period'].includes(key)) || !['all','company'].includes(value.scope) || typeof value.company!=='string' || !object(value.period))throw new HttpError(400,'Choose a valid company dashboard definition.');
 const company=value.company.trim().replace(/\s+/g,' '),period=value.period;
 if(value.scope==='all'?company!=='':company.length<2 || company.length>120 || /[\x00-\x1f\x7f]/.test(company))throw new HttpError(400,'Choose a valid recorded company.');
 if(period.kind==='rolling' && Object.keys(period).every(key=>['kind','days'].includes(key)) && Number.isInteger(period.days) && period.days>=1 && period.days<=366)return {scope:value.scope,company,period:{kind:'rolling',days:period.days}};
 if(period.kind==='fixed' && Object.keys(period).every(key=>['kind','from','to'].includes(key)) && typeof period.from==='string' && typeof period.to==='string' && period.from && period.to)return {scope:value.scope,company,period:{kind:'fixed',from:period.from,to:period.to}};
 throw new HttpError(400,'Choose fixed dates or a rolling period of 1-366 days.');
}
function paramsFor(config,{now=Date.now,page=1}={}){
 const today=day(now()),range=config.period.kind==='rolling'?{from:day(now()-(config.period.days-1)*86400000),to:today}:{from:config.period.from,to:config.period.to};
 return new URLSearchParams({scope:config.scope,company:config.company,...range,page:String(page),pageSize:'10'});
}
const view=row=>({id:row.id,title:row.title,definition:row.config_json,createdAt:new Date(row.created_at).toISOString()});
async function readDefinition(db,user,definition,options={}){return companyActivity.dashboard(db,user,paramsFor(canonical(definition),options),{...options,exactCompany:true});}
function validId(id){if(typeof id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new HttpError(404,'Saved dashboard not found.');return id;}
async function list(db,user){await assertCurrentUser(db,user);return (await db.query('SELECT * FROM saved_dashboard_views WHERE user_id=$1 ORDER BY created_at DESC,id DESC',[user.id])).rows.map(view);}
async function detail(db,user,id,{now=Date.now,page=1}={}){
 await assertCurrentUser(db,user);const row=(await db.query('SELECT * FROM saved_dashboard_views WHERE id=$1 AND user_id=$2',[validId(id),user.id])).rows[0];
 if(!row)throw new HttpError(404,'Saved dashboard not found.');
 return {view:view(row),dashboard:await readDefinition(db,user,row.config_json,{now,page})};
}
async function save(db,user,body,{now=Date.now,validateSession=async()=>{}}={}){
 if(!object(body) || Object.keys(body).some(key=>!['title','definition'].includes(key)))throw new HttpError(400,'Supply only the dashboard name and definition.');
 const definition=canonical(body.definition),data=await readDefinition(db,user,definition,{now});
 if(data.status!=='ready')throw new HttpError(409,'Choose a recorded company before saving this dashboard.');
 if(definition.scope==='company')definition.company=data.company;
 const title=body.title===undefined?(definition.scope==='all'?'Transactions with all companies':'Activity with '+data.company).slice(0,80):typeof body.title==='string'?body.title.trim().replace(/\s+/g,' '):'';
 if(title.length<2 || title.length>80 || /[\x00-\x1f\x7f]/.test(title))throw new HttpError(400,'Use a dashboard name of 2-80 characters.');
 const configHash=createHash('sha256').update(JSON.stringify(definition)).digest('hex');
 return db.transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('greenlink:dashboards:'||$1::text,0))",[String(user.id)]);
  await validateSession();await assertCurrentUser(client,user,{lock:true});
  const existing=(await client.query('SELECT * FROM saved_dashboard_views WHERE user_id=$1 AND config_hash=$2',[user.id,configHash])).rows[0];
  if(existing)return {view:view(existing),alreadySaved:true};
  const count=Number((await client.query('SELECT count(*) FROM saved_dashboard_views WHERE user_id=$1',[user.id])).rows[0].count);
  if(count>=20)throw new HttpError(409,'You can keep up to 20 saved dashboards. Remove an old view first.');
  const row=(await client.query('INSERT INTO saved_dashboard_views(id,user_id,title,config_json,config_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),user.id,title,definition,configHash,new Date(now()).toISOString()])).rows[0];
  await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'dashboard_view.created',$2,$3)",[user.id,{viewId:row.id,scope:definition.scope,configHash},new Date(now()).toISOString()]);
  return {view:view(row),alreadySaved:false};
 });
}
async function remove(db,user,id){return db.transaction(async client=>{await assertCurrentUser(client,user,{lock:true});const row=(await client.query('DELETE FROM saved_dashboard_views WHERE id=$1 AND user_id=$2 RETURNING id',[validId(id),user.id])).rows[0];if(!row)throw new HttpError(404,'Saved dashboard not found.');await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'dashboard_view.removed',$2)",[user.id,{viewId:row.id}]);return {removed:true};});}
module.exports={list,detail,save,remove,canonical,paramsFor,readDefinition,saveIntent,followup};
