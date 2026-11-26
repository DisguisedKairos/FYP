'use strict';

const {HttpError}=require('../models/errors');
const {cents}=require('./ledger');

// The caller supplies a read-only snapshot. History is reconstructed from its
// recorded opening provenance and settled entries, never a mutable balance.
async function periodBalances(client,user,range){
  const rows=(await client.query(`SELECT a.*,
    COALESCE(SUM(t.amount_cents),0) AS ledger_net,
    COALESCE(SUM(t.amount_cents) FILTER(WHERE t.completed_at<$2::timestamptz),0) AS before_start,
    COALESCE(SUM(t.amount_cents) FILTER(WHERE t.completed_at<$3::timestamptz),0) AS before_end,
    MIN(t.completed_at) AS first_settlement
    FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.status='completed'
    WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.id`,[user.id,range.start,range.end])).rows;
  return rows.map(row=>{
    const baseline=cents(row.opening_balance_cents),created=new Date(row.created_at).toISOString();
    const corrupt=()=>new HttpError(409,'Account history cannot be reconciled with its recorded balance. Contact the project administrator.');
    if(!['new','seed','legacy_verified'].includes(row.opening_provenance)||baseline<0||baseline+cents(row.ledger_net)!==cents(row.balance_cents)||(row.first_settlement&&new Date(row.first_settlement)<new Date(created)))throw corrupt();
    const openingBalanceCents=created>=range.start?0:baseline+cents(row.before_start);
    const closingBalanceCents=created>=range.end?0:baseline+cents(row.before_end);
    if(openingBalanceCents<0||closingBalanceCents<0)throw corrupt();
    return {id:String(row.id),name:row.name,number:row.number,status:row.status,balanceCents:cents(row.balance_cents),openingBalanceCents,closingBalanceCents,balanceChangeCents:closingBalanceCents-openingBalanceCents};
  });
}
module.exports={periodBalances};
