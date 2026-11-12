'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const companyActivity=require('./company-activity');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const DAY=86400000,WEEK=7*DAY;
const day=v=>new Date(v+8*3600000).toISOString().slice(0,10);
const DEFAULT_PRESENTATION=Object.freeze({chartType:'bar',showStatus:true,showCompanies:true});
const SAVE_INTENT=/\b(?:save|bookmark|add|pin)\b.{0,100}\b(?:dashboard|view|summary|report|chart|it|this|that)\b|\bkeep\s+(?:(?:this|that|the|my)\s+)?(?:dashboard|view|summary|report|chart)\b/i;
const FOLLOWUP=/^\s*(?:(?:please|can you|could you|yes)[,\s]+)*(?:save|bookmark|keep|add|pin)\s+(?:(?:it|this|that)(?:\s+(?:dashboard|view|chart))?|(?:the|my)\s+(?:dashboard|view|chart)|chart)(?=\s|[.!?]|$)/i;
function saveIntent(message){message=String(message).replace(/\u2019/g,"'");return !/\b(?:how\s+(?:to|do|can|should|would)|tell me how|explain|instructions?|steps?|not (?:now|yet|today))\b/i.test(message)&&SAVE_INTENT.test(message)&&!/\b(?:do not|don't|dont|never|without)\s+(?:\w+\s+){0,2}(?:save|saving|bookmark|keep|add|pin)\b/i.test(message)&&!/\b(?:how|can|could)\s+(?:do\s+)?(?:I|one|someone)\b/i.test(message);}
function followup(message){return saveIntent(message)&&FOLLOWUP.test(message);}
function canonical(value){
 if(!object(value)||Object.keys(value).some(k=>!['scope','company','period'].includes(k))||!['all','company'].includes(value.scope)||typeof value.company!=='string'||!object(value.period))throw new HttpError(400,'Choose a valid company dashboard definition.');
 const company=value.company.trim().replace(/\s+/g,' '),p=value.period;
 if(value.scope==='all'?company!=='':company.length<2||company.length>120||/[\x00-\x1f\x7f]/.test(company))throw new HttpError(400,'Choose a valid recorded company.');
 if(p.kind==='rolling'&&Object.keys(p).every(k=>['kind','days'].includes(k))&&Number.isInteger(p.days)&&p.days>=1&&p.days<=366)return {scope:value.scope,company,period:{kind:'rolling',days:p.days}};
 if(p.kind==='months'&&Object.keys(p).every(k=>['kind','months'].includes(k))&&Number.isInteger(p.months)&&p.months>=1&&p.months<=12)return {scope:value.scope,company,period:{kind:'months',months:p.months}};
 if(p.kind==='fixed'&&Object.keys(p).every(k=>['kind','from','to'].includes(k))&&typeof p.from==='string'&&typeof p.to==='string'&&p.from&&p.to)return {scope:value.scope,company,period:{kind:'fixed',from:p.from,to:p.to}};
 throw new HttpError(400,'Choose fixed dates, 1-366 rolling days or 1-12 calendar months.');
}
function presentation(value={}){
 if(!object(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_PRESENTATION,k))||(value.chartType!==undefined&&!['bar','line','table'].includes(value.chartType))||['showStatus','showCompanies'].some(k=>value[k]!==undefined&&typeof value[k]!=='boolean'))throw new HttpError(400,'Choose supported chart settings.');
 return {...DEFAULT_PRESENTATION,...value};
}
function titleFor(value){const title=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';if(title.length<2||title.length>80||/[\x00-\x1f\x7f]/.test(title))throw new HttpError(400,'Use a dashboard name of 2-80 characters.');return title;}
function cadence(value='manual'){if(!['manual','weekly'].includes(value))throw new HttpError(400,'Choose manual or weekly refresh.');return value;}
function paramsFor(config,{now=Date.now,page=1}={}){
 const p=config.period,today=day(now()),range=p.kind==='months'?companyActivity.requestedPeriod('past '+p.months+' months',{now}):p.kind==='rolling'?{from:day(now()-(p.days-1)*DAY),to:today}:{from:p.from,to:p.to};
 return new URLSearchParams({scope:config.scope,company:config.company,...range,page:String(page),pageSize:'10'});
}
const stamp=value=>value?new Date(value).toISOString():null;
const view=row=>({id:row.id,title:row.title,definition:row.config_json,presentation:presentation(row.presentation_json||{}),refreshCadence:row.refresh_cadence||'manual',version:row.version||1,refreshedAt:stamp(row.refreshed_at),nextRefreshAt:stamp(row.next_refresh_at),refreshError:row.refresh_error||null,createdAt:stamp(row.created_at)});
async function readDefinition(db,user,definition,options={}){return companyActivity.dashboard(db,user,paramsFor(canonical(definition),options),{...options,exactCompany:true});}
function validId(id){if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new HttpError(404,'Saved dashboard not found.');return id;}
async function list(db,user){await assertCurrentUser(db,user);return (await db.query('SELECT * FROM saved_dashboard_views WHERE user_id=$1 ORDER BY created_at DESC,id DESC',[user.id])).rows.map(view);}
async function owned(db,user,id,{lock=false}={}){const row=(await db.query('SELECT * FROM saved_dashboard_views WHERE id=$1 AND user_id=$2'+(lock?' FOR UPDATE':''),[validId(id),user.id])).rows[0];if(!row)throw new HttpError(404,'Saved dashboard not found.');return row;}
async function detail(db,user,id,{now=Date.now,page=1}={}){await assertCurrentUser(db,user);const row=await owned(db,user,id);return {view:view(row),dashboard:await readDefinition(db,user,row.config_json,{now,page})};}
async function save(db,user,body,{now=Date.now,validateSession=async()=>{}}={}){
 if(!object(body)||Object.keys(body).some(k=>!['title','definition','presentation','refreshCadence'].includes(k)))throw new HttpError(400,'Supply only the dashboard name, definition and chart/refresh settings.');
 const definition=canonical(body.definition),data=await readDefinition(db,user,definition,{now});
 if(data.status!=='ready')throw new HttpError(409,'Choose a recorded company before saving this dashboard.');
 if(definition.scope==='company')definition.company=data.company;
 const title=titleFor(body.title===undefined?(definition.scope==='all'?'Transactions with all companies':'Activity with '+data.company).slice(0,80):body.title);
 const display=presentation(body.presentation),refresh=cadence(body.refreshCadence),configHash=createHash('sha256').update(JSON.stringify(definition)).digest('hex');
 return db.transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('greenlink:dashboards:'||$1::text,0))",[String(user.id)]);
  await validateSession(client);await assertCurrentUser(client,user,{lock:true});
  const existing=(await client.query("SELECT * FROM saved_dashboard_views WHERE user_id=$1 AND (config_hash=$2 OR (config_json->>'scope'=$3 AND lower(config_json->>'company')=lower($4) AND config_json->'period'=$5::jsonb)) ORDER BY created_at,id LIMIT 1",[user.id,configHash,definition.scope,definition.company,definition.period])).rows[0];
  if(existing)return {view:view(existing),alreadySaved:true};
  if(Number((await client.query('SELECT count(*) FROM saved_dashboard_views WHERE user_id=$1',[user.id])).rows[0].count)>=20)throw new HttpError(409,'You can keep up to 20 saved dashboards. Remove an old view first.');
  const at=new Date(now()).toISOString();
  const row=(await client.query('INSERT INTO saved_dashboard_views(id,user_id,title,config_json,config_hash,created_at,presentation_json,refresh_cadence,refreshed_at,next_refresh_at,snapshot_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6,$9,$10) RETURNING *',[randomUUID(),user.id,title,definition,configHash,at,display,refresh,refresh==='weekly'?new Date(now()+WEEK).toISOString():null,data])).rows[0];
  await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'dashboard_view.created',$2,$3)",[user.id,{viewId:row.id,scope:definition.scope,configHash,refreshCadence:refresh},at]);
  return {view:view(row),alreadySaved:false};
 });
}
async function configure(db,user,id,body,{now=Date.now,validateSession=async()=>{}}={}){
 if(!object(body)||!Number.isSafeInteger(body.version)||body.version<1||Object.keys(body).some(k=>!['version','title','presentation','refreshCadence'].includes(k))||Object.keys(body).length<2)throw new HttpError(400,'Supply the current version and supported dashboard settings.');
 const patch={...(body.title!==undefined?{title:titleFor(body.title)}:{}),...(body.presentation!==undefined?{display:presentation(body.presentation)}:{}),...(body.refreshCadence!==undefined?{cadence:cadence(body.refreshCadence)}:{})};
 return db.transaction(async client=>{
  await validateSession(client);await assertCurrentUser(client,user,{lock:true});const prior=await owned(client,user,id,{lock:true});
  if(prior.version!==body.version)throw new HttpError(409,'This dashboard changed. Reload before saving your settings.');
  const refresh=patch.cadence||prior.refresh_cadence,next=refresh==='weekly'?(prior.refresh_cadence==='weekly'&&prior.next_refresh_at?prior.next_refresh_at:new Date(now()+WEEK).toISOString()):null;
  const row=(await client.query('UPDATE saved_dashboard_views SET title=$3,presentation_json=$4,refresh_cadence=$5,next_refresh_at=$6,version=version+1 WHERE id=$1 AND user_id=$2 RETURNING *',[id,user.id,patch.title||prior.title,patch.display||prior.presentation_json,refresh,next])).rows[0];
  await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'dashboard_view.configured',$2,$3)",[user.id,{viewId:id,version:row.version,fields:Object.keys(body).filter(k=>k!=='version')},new Date(now()).toISOString()]);
  return {view:view(row)};
 });
}
async function refresh(db,user,id,{now=Date.now,validateSession=async()=>{}}={}){
 await assertCurrentUser(db,user);const prior=await owned(db,user,id),data=await readDefinition(db,user,prior.config_json,{now});
 if(data.status!=='ready')throw new HttpError(409,'This recorded company is unavailable. Choose another saved chart.');
 return db.transaction(async client=>{
  await validateSession(client);await assertCurrentUser(client,user,{lock:true});const current=await owned(client,user,id,{lock:true});
  if(current.version!==prior.version)throw new HttpError(409,'The chart settings changed during refresh. Retry.');
  const row=(await client.query('UPDATE saved_dashboard_views SET snapshot_json=$3,refreshed_at=$4,refresh_error=NULL,next_refresh_at=$5 WHERE id=$1 AND user_id=$2 RETURNING *',[id,user.id,data,new Date(now()).toISOString(),current.refresh_cadence==='weekly'?new Date(now()+WEEK).toISOString():null])).rows[0];
  return {view:view(row),dashboard:data};
 });
}
async function refreshDue(db,{now=Date.now,limit=10}={}){
 let refreshed=0,failed=0;
 for(let i=0;i<Math.min(20,Math.max(0,limit));i++){
  const task=await db.transaction(async client=>{
   const row=(await client.query("SELECT v.id,u.id AS user_id,u.role,u.auth_version FROM saved_dashboard_views v JOIN users u ON u.id=v.user_id WHERE v.refresh_cadence='weekly' AND v.next_refresh_at<=$1 ORDER BY v.next_refresh_at,v.id LIMIT 1 FOR UPDATE OF v SKIP LOCKED",[new Date(now()).toISOString()])).rows[0];
   if(!row)return null;await client.query('UPDATE saved_dashboard_views SET next_refresh_at=$2 WHERE id=$1',[row.id,new Date(now()+10*60000).toISOString()]);return row;
  });
  if(!task)break;
  try{await refresh(db,{id:task.user_id,role:task.role,auth_version:task.auth_version},task.id,{now});refreshed++;}
  catch{failed++;await db.query("UPDATE saved_dashboard_views SET refresh_error='REFRESH_UNAVAILABLE',next_refresh_at=$2 WHERE id=$1 AND refresh_cadence='weekly'",[task.id,new Date(now()+DAY).toISOString()]);}
 }
 return {refreshed,failed};
}
async function remove(db,user,id){return db.transaction(async client=>{await assertCurrentUser(client,user,{lock:true});const row=(await client.query('DELETE FROM saved_dashboard_views WHERE id=$1 AND user_id=$2 RETURNING id',[validId(id),user.id])).rows[0];if(!row)throw new HttpError(404,'Saved dashboard not found.');await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'dashboard_view.removed',$2)",[user.id,{viewId:row.id}]);return {removed:true};});}
function messageOptions(message,{chartType='bar'}={}){
 const options={presentation:{...DEFAULT_PRESENTATION,chartType}};
 const named=message.match(/\bas\s+["?]([^"?]{2,80})["?]/i);if(named)options.title=titleFor(named[1]);
 const noWeekly=/\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,3}(?:refresh|refreshing|update|updating)\b.{0,30}\b(?:weekly|every week)\b|\bno weekly refresh\b/i.test(message.replace(/\u2019/g,"'"));
 if(noWeekly)options.refreshCadence='manual';else if(/\bweekly\b|\bevery week\b/i.test(message))options.refreshCadence='weekly';
 return options;
}
module.exports={list,detail,save,configure,refresh,refreshDue,remove,canonical,presentation,paramsFor,readDefinition,saveIntent,followup,messageOptions,DEFAULT_PRESENTATION};
