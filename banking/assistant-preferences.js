'use strict';
const {HttpError}=require('../models/errors');
const {assertCurrentUser}=require('./auth');
const DEFAULTS=Object.freeze({responseStyle:'concise',trendMonths:3,chartType:'bar',marketTopic:'general'});
const fields={responseStyle:['concise','detailed'],trendMonths:Array.from({length:12},(_,i)=>i+1),chartType:['bar','line','table'],marketTopic:['general','singapore','fx','trade','interest_rates']};
const view=row=>row?{responseStyle:row.response_style,trendMonths:row.trend_months,chartType:row.chart_type,marketTopic:row.market_topic}:{...DEFAULTS};
function validate(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||!Object.keys(body).length||Object.keys(body).some(k=>!Object.hasOwn(fields,k)||!fields[k].includes(body[k])))throw new HttpError(400,'Choose supported assistant preferences.');
 return body;
}
async function read(db,user){await assertCurrentUser(db,user);return view((await db.query('SELECT * FROM assistant_preferences WHERE user_id=$1',[user.id])).rows[0]);}
async function update(db,user,body,{now=Date.now,validateSession=async()=>{}}={}){
 validate(body);
 return db.transaction(async client=>{
  await validateSession(client);await assertCurrentUser(client,user,{lock:true});
  const settings={...await read(client,user),...body};
  const row=(await client.query('INSERT INTO assistant_preferences(user_id,response_style,trend_months,chart_type,market_topic,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET response_style=EXCLUDED.response_style,trend_months=EXCLUDED.trend_months,chart_type=EXCLUDED.chart_type,market_topic=EXCLUDED.market_topic,updated_at=EXCLUDED.updated_at RETURNING *',[user.id,settings.responseStyle,settings.trendMonths,settings.chartType,settings.marketTopic,new Date(now()).toISOString()])).rows[0];
  await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata,created_at) VALUES($1,$1,'assistant_preferences.updated',$2,$3)",[user.id,{fields:Object.keys(body),settings},new Date(now()).toISOString()]);
  return view(row);
 });
}
module.exports={read,update,validate,DEFAULTS};
