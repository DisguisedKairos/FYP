'use strict';

// Warnings are computed from permitted ledger facts, not model prose.
function projectionWarnings({shortfalls,generatedAt,days,occurrenceCount=0}){
  return {available:true,checkedAt:generatedAt,days,occurrenceCount,basis:'Active schedules only. Unentered bills and unscheduled income are not included.',warnings:shortfalls.map(row=>({
    code:'scheduled_shortfall',accountId:row.accountId,accountName:row.name,
    shortageCents:row.shortageCents,dueAt:row.dueAt,days,checkedAt:generatedAt,
    title:'Scheduled payments may have insufficient funds.',
    message:'The scheduled-payment scenario falls below zero on this account. Review its funding before processing. Unscheduled income is not predicted and pending payments do not reserve funds.'
  }))};
}
function draftWarnings(source,requiredCents,{scheduled=false,now=Date.now}={}){
  const availableCents=Number(source.balance_cents);
  if(requiredCents===undefined || requiredCents<=availableCents)return [];
  return [{code:scheduled?'scheduled_draft_shortfall':'payment_shortfall',accountId:String(source.id),accountName:source.name,availableCents,requiredCents,shortageCents:requiredCents-availableCents,checkedAt:new Date(now()).toISOString(),
    title:scheduled?'Current funds do not cover this scheduled amount.':'Insufficient funds for this payment draft.',
    message:scheduled?'Review funding before the due time. Scheduling does not reserve funds, and funds will be checked again when the payment is due.':'Reduce the amount or fund this source account before authorizing. Other accounts are not combined automatically.'}];
}
function collect(results){
  const coverage=[...results].reverse().find(row=>row.value?.fundingCheck)?.value.fundingCheck;
  const payment=[...results].reverse().find(row=>['prepare_payment_draft','check_payment_funds'].includes(row.tool))?.value;
  return [...(coverage?.warnings||[]),...(payment?.fundingWarnings||[])];
}
module.exports={projectionWarnings,draftWarnings,collect};
