'use strict';
const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const {forIndustry,MARKETS,PRIORITIES}=require('./industry-profiles');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function settings(value,profile){
 if(!object(value)||Object.keys(value).length!==3||Object.keys(value).some(k=>!['markets','operations','priorities'].includes(k)))throw new HttpError(400,'Choose markets, operations and priorities from the available business options.');
 const choices={markets:MARKETS,operations:profile.operations,priorities:PRIORITIES},result={};
 for(const key of Object.keys(choices)){
  const list=value[key];
  if(!Array.isArray(list)||!list.length||list.length>Object.keys(choices[key]).length||new Set(list).size!==list.length||list.some(code=>typeof code!=='string'||!Object.hasOwn(choices[key],code)))throw new HttpError(400,'Choose valid '+key+' without duplicates.');
  result[key]=[...list];
 }
 return result;
}
function view(row){
 if(!row)return {available:false};
 const profile=forIndustry(row.industry),matches=row.profile_key===profile.key;
 const selected=settings(matches?row.settings_json:profile.defaults,profile);
 return {available:true,companyName:row.legal_name,industry:row.industry,profileKey:profile.key,label:profile.label,settings:selected,version:row.version||0,configured:Boolean(row.profile_key&&matches),needsReview:Boolean(row.profile_key&&!matches),options:{markets:MARKETS,operations:profile.operations,priorities:PRIORITIES}};
}
async function read(db,user){
 await assertCurrentUser(db,user);
 const row=(await db.query('SELECT b.id,b.legal_name,b.industry,p.profile_key,p.settings_json,p.version FROM businesses b LEFT JOIN business_advisory_profiles p ON p.business_id=b.id WHERE b.primary_user_id=$1',[user.id])).rows[0];
 return view(row);
}
async function save(db,user,body,{now=Date.now}={}){
 if(!object(body)||Object.keys(body).length!==3||Object.keys(body).some(k=>!['profileKey','settings','version'].includes(k))||!Number.isSafeInteger(body.version)||body.version<0)throw new HttpError(400,'Supply the current profile, version and business preferences.');
 return db.transaction(async client=>{
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
  await assertCurrentUser(client,user);
  const business=(await client.query('SELECT id,legal_name,industry FROM businesses WHERE primary_user_id=$1 FOR UPDATE',[user.id])).rows[0];
  if(!business)throw new HttpError(403,'A registered business profile is required.');
  const profile=forIndustry(business.industry);
  if(body.profileKey!==profile.key)throw new HttpError(409,'The registered industry changed. Reload the business preferences.');
  const selected=settings(body.settings,profile);
  const previous=(await client.query('SELECT version FROM business_advisory_profiles WHERE business_id=$1',[business.id])).rows[0];
  if((previous?.version||0)!==body.version)throw new HttpError(409,'Business preferences changed. Reload before saving.');
  const date=new Date(now()).toISOString();
  await client.query('INSERT INTO business_advisory_profiles(business_id,profile_key,settings_json,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(business_id) DO UPDATE SET profile_key=EXCLUDED.profile_key,settings_json=EXCLUDED.settings_json,version=business_advisory_profiles.version+1,updated_at=EXCLUDED.updated_at',[business.id,profile.key,selected,date]);
  await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'business.advisory_preferences_updated',$2,$3)",[user.id,{profileKey:profile.key,settings:selected},date]);
  return read(client,user);
 });
}
async function context(db,user){
 const value=await read(db,user);
 if(!value.available)return null;
 const profile=forIndustry(value.industry);
 return {companyName:value.companyName,registeredIndustry:value.industry,profileKey:profile.key,planningProfile:profile.label,markets:value.settings.markets.map(code=>MARKETS[code]),operations:value.settings.operations.map(code=>profile.operations[code]),priorities:value.settings.priorities.map(code=>PRIORITIES[code]),configuration:value.configured?'Saved business planning preferences; not independently verified.':'Industry defaults; confirm these planning assumptions with the business.',actionOptions:profile.actions};
}
async function searchContext(db,user){
 const value=await read(db,user);
 if(!value.available)throw new HttpError(400,'A registered business profile is needed for your industry news. You can ask for general market news instead.');
 const profile=forIndustry(value.industry);
 return {industryTopic:require('./counterparty-news').industryTopic(value.industry),sourceDomains:profile.sourceDomains,markets:value.settings.markets.map(code=>MARKETS[code]),operations:value.settings.operations.map(code=>profile.operations[code]),priorities:value.settings.priorities.map(code=>PRIORITIES[code])};
}
module.exports={read,save,context,searchContext,settings};
