'use strict';
// Synthetic public data and model selection exist only in tests, never in production.
const {day}=require('../banking/market-context');
function contextFixture(now=Date.now()){
 const asOf=day(now);
 return {asOf,fetchedAt:new Date(now).toISOString(),status:'available',sources:{
  alerts:{available:true,records:[{title:'Investment impersonation scams',publishedAt:asOf,url:'https://www.scamshield.gov.sg/resources/scam-alert/test-investment/',topics:['investment','impersonation']}]},
  fx:{available:true,records:[{pair:'USD/SGD',rate:1.3,changePercent:0.5,asOf,previousDate:asOf,derived:true}]},
  news:{available:true,records:[{title:'ECB financial market update',publishedAt:asOf,url:'https://www.ecb.europa.eu/press/test.en.html'}]},
 },limitations:['Controlled public-source fixture.']};
}
function marketModel(config={}){
 return {mode:'openai',model:'controlled-market-model',inspect:async()=>({available:true,configured:true,model:'controlled-market-model'}),chat:async messages=>{
  const last=[...messages].reverse().find(m=>m.role==='tool');
  if(!last)return {role:'assistant',content:'',tool_calls:[{function:{name:config.publicOnly?'get_daily_market_context':'analyze_market_transactions',arguments:config.initialArgs?.()||{}}}]};
  const {data,evidenceId}=JSON.parse(last.content);
  if(last.tool_name==='analyze_market_transactions'){
   await config.afterAnalysis?.(data);
   const selected=data.transactions.find(t=>t.eligibleSignals.length)||data.transactions[0];
   if(selected&&config.flag!==false&&(selected.eligibleSignals.length||config.signalCode))return {role:'assistant',content:'',tool_calls:[{function:{name:'flag_transaction_for_review',arguments:{transactionId:selected.id,signalCode:config.signalCode||selected.eligibleSignals[0].code}}}]};
  }
  return {role:'assistant',content:last.tool_name==='flag_transaction_for_review'?(data.reviewRequested?'I have referred the suspicious payment for independent human review ['+evidenceId+'].':'A human already reviewed this case; this request did not reopen it ['+evidenceId+'].'):'Review the dated public context and verify payment purposes independently; this limited check cannot establish safety ['+evidenceId+'].'};
 }};
}
module.exports={contextFixture,marketModel};
