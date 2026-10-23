'use strict';
const { randomUUID } = require('node:crypto');
const ledger = require('./ledger');
const { HttpError } = require('../models/errors');
const iso = value => value ? new Date(value).toISOString() : null;
const instant = now => new Date(now()).toISOString();

async function scheduleView(db, row) {
  const payload = row.payload_json;
  const source = (await db.query('SELECT name FROM accounts WHERE id=$1', [payload.fromId])).rows[0];
  const biller = payload.billerId ? (await db.query('SELECT name FROM billers WHERE id=$1',[payload.billerId])).rows[0] : null;
  const runs = (await db.query(`SELECT r.*,t.status AS transaction_status FROM scheduled_payment_runs r LEFT JOIN transactions t ON t.id=r.transaction_id WHERE r.schedule_id=$1 ORDER BY r.due_at DESC`,[row.id])).rows;
  return { id:row.id,type:row.type,fromAccountId:String(payload.fromId),fromAccountName:source?.name || '',toAccountNumber:payload.number || null,billerId:payload.billerId || null,billerName:biller?.name || null,
    reference:payload.reference || '',amountCents:Number(row.amount_cents),description:payload.note || '',frequency:row.frequency,status:row.status,scheduledAt:iso(row.scheduled_at),nextRunAt:iso(row.next_run_at),createdAt:iso(row.created_at),lastRunAt:iso(row.last_run_at),lastStatus:runs[0]?.transaction_status || row.last_status,lastError:row.last_error,
    runs:runs.map(run => ({id:run.id,dueAt:iso(run.due_at),status:run.transaction_status || run.status,transactionId:run.transaction_id,error:run.error,attempts:run.attempts,nextAttemptAt:iso(run.next_attempt_at),createdAt:iso(run.created_at),completedAt:iso(run.completed_at)})) };
}
async function listSchedules(db,user) { const rows=(await db.query('SELECT * FROM scheduled_payments WHERE user_id=$1 ORDER BY created_at DESC,id DESC',[user.id])).rows; return Promise.all(rows.map(row=>scheduleView(db,row))); }
async function createSchedule(db,user,body,{authorize,now=Date.now}={}) {
  if(!body || typeof body!=='object' || Array.isArray(body))throw new HttpError(400,'Send a schedule as a JSON object.');
  if(!['transfer','bill'].includes(body.type) || !['once','weekly','monthly'].includes(body.frequency))throw new HttpError(400,'Choose a payment type and frequency.');
  if(typeof body.scheduledAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.scheduledAt))throw new HttpError(400,'Choose a valid future UTC date.');
  const date=new Date(body.scheduledAt), normalized=body.scheduledAt.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction='')=>`.${fraction.padEnd(3,'0')}Z`);
  if(!Number.isFinite(date.getTime()) || date.toISOString()!==normalized)throw new HttpError(400,'Choose a valid future UTC date.');
  const payload=ledger.normalize(body.type,body),key=ledger.requestKey(body.requestId),canonical={type:body.type,payload,frequency:body.frequency,scheduledAt:date.toISOString()},hash=ledger.canonicalHash(user.id,'schedule',canonical);
  const authorization=await (authorize || ledger.authorize)(db,user,body.authorizationPassword,now);
  return db.transaction(async client=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    await ledger.assertAuthorization(client,user,authorization);
    const old=(await client.query('SELECT * FROM requests WHERE user_id=$1 AND request_id=$2',[user.id,key])).rows[0];
    if(old){if(old.kind!=='schedule'||old.payload_hash!==hash)throw new HttpError(409,'This request identifier is already bound to other details.');return scheduleView(client,(await client.query('SELECT * FROM scheduled_payments WHERE id=$1',[old.result_json.id])).rows[0]);}
    if((await client.query('SELECT 1 FROM payment_bindings WHERE user_id=$1 AND request_id=$2',[user.id,key])).rowCount)throw new HttpError(409,'This request identifier is already in use.');
    if(date.getTime()<=now())throw new HttpError(400,'Choose a future date.');
    await ledger.resolve(client,user,body.type,payload,{checkFunds:false,lock:true});
    const id=randomUUID(),createdAt=instant(now);
    const row=(await client.query('INSERT INTO scheduled_payments(id,user_id,type,payload_json,amount_cents,frequency,scheduled_at,next_run_at,authorization_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) RETURNING *',[id,user.id,body.type,payload,payload.amountCents,body.frequency,date.toISOString(),{...authorization,scope:'scheduled_payment',scheduleId:id},createdAt])).rows[0];
    const view=await scheduleView(client,row);
    await client.query("INSERT INTO requests(user_id,request_id,kind,payload_hash,result_json,created_at) VALUES($1,$2,'schedule',$3,$4,$5)",[user.id,key,hash,view,createdAt]);
    await ledger.enqueue(client,{userId:user.id,type:'schedule.created',title:'Payment scheduled',message:'Your authorized scheduled instruction has been saved.',createdAt,metadata:{scheduleId:id}});
    await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'schedule.created',$2)",[user.id,{scheduleId:id}]);
    return view;
  });
}
async function cancelSchedule(db,user,id,{now=Date.now}={}){
  return db.transaction(async client=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    const row=(await client.query('SELECT * FROM scheduled_payments WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id])).rows[0];
    if(!row)throw new HttpError(404,'Scheduled payment not found.');
    if(row.status==='cancelled')return scheduleView(client,row);
    if(row.status!=='active')throw new HttpError(409,'This schedule has already finished.');
    const updated=(await client.query("UPDATE scheduled_payments SET status='cancelled',next_run_at=NULL,lease_owner=NULL,lease_until=NULL WHERE id=$1 RETURNING *",[id])).rows[0];
    // A worker may have committed the ledger and crashed before recording its
    // run result. The sender lock prevents a later settlement during this read.
    const pending=(await client.query("SELECT * FROM scheduled_payment_runs WHERE schedule_id=$1 AND status IN ('processing','retrying') FOR UPDATE",[id])).rows;
    for(const run of pending){
      const requestId=`schedule:${id}:${new Date(run.due_at).getTime()}`;
      const receipt=(await client.query('SELECT result_json FROM requests WHERE user_id=$1 AND request_id=$2',[user.id,requestId])).rows[0]?.result_json;
      await client.query('UPDATE scheduled_payment_runs SET status=$2,transaction_id=$3,next_attempt_at=NULL,completed_at=$4 WHERE id=$1',
        [run.id,receipt?.status || 'cancelled',receipt?.id || null,receipt?.completedAt || instant(now)]);
    }
    await ledger.enqueue(client,{userId:user.id,type:'schedule.cancelled',title:'Scheduled payment cancelled',message:'Future occurrences have been cancelled.',createdAt:instant(now),metadata:{scheduleId:id}});
    return scheduleView(client,updated);
  });
}
function nextOccurrence(row){if(row.frequency==='once')return null;const date=new Date(row.next_run_at);if(row.frequency==='weekly')date.setUTCDate(date.getUTCDate()+7);else{const anchor=new Date(row.scheduled_at).getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(Math.min(anchor,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));}return date.toISOString();}
async function runDue(db,{riskClient,now=Date.now,maxAttempts=5}={}){
  const owner=randomUUID(),date=instant(now);
  const due=await db.transaction(async client=>{
    const rows=(await client.query("SELECT * FROM scheduled_payments WHERE status='active' AND next_run_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_run_at,id LIMIT 20 FOR UPDATE SKIP LOCKED",[date])).rows;
    for(const row of rows){await client.query('UPDATE scheduled_payments SET lease_owner=$2,lease_until=$3 WHERE id=$1',[row.id,owner,new Date(now()+300000)]);await client.query("INSERT INTO scheduled_payment_runs(id,schedule_id,due_at,status,created_at,attempts) VALUES($1,$2,$3,'processing',$4,1) ON CONFLICT(schedule_id,due_at) DO UPDATE SET status='processing',attempts=scheduled_payment_runs.attempts+1,next_attempt_at=NULL",[randomUUID(),row.id,row.next_run_at,date]);}
    return rows;
  });
  for(const row of due){let result=null,failure=null;try{
    const user=(await db.query('SELECT id,name,email,role FROM users WHERE id=$1',[row.user_id])).rows[0],saved=row.payload_json;
    if(!user)throw new HttpError(404,'The account owner no longer exists.');
    const body={fromAccountId:saved.fromId,amount:(saved.amountCents/100).toFixed(2),requestId:`schedule:${row.id}:${new Date(row.next_run_at).getTime()}`,...(row.type==='transfer'?{toAccountNumber:saved.number,description:saved.note}:{billerId:saved.billerId,reference:saved.reference})};
    result=await ledger.submit(db,user,row.type,body,{riskClient,now,scheduledAuthorization:row.authorization_json,scheduleClaim:{id:row.id,dueAt:iso(row.next_run_at),owner}});
  }catch(error){failure=error;}
    await db.transaction(async client=>{
      const current=(await client.query('SELECT * FROM scheduled_payments WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
    if(current.lease_owner!==owner || current.status!=='active' || iso(current.next_run_at)!==iso(row.next_run_at))return;
      const run=(await client.query('SELECT * FROM scheduled_payment_runs WHERE schedule_id=$1 AND due_at=$2 FOR UPDATE',[row.id,row.next_run_at])).rows[0];
      const leaseExpired=current.lease_until && new Date(current.lease_until).getTime()<=now();
      const retry=failure && (!failure.status || failure.status>=500 || failure.status===429 || leaseExpired) && run.attempts<maxAttempts;
      const message=failure?String(failure.message || failure).slice(0,500):null;
      if(retry){const nextAttempt=new Date(now()+Math.min(300000,1000*2**run.attempts));await client.query("UPDATE scheduled_payment_runs SET status='retrying',error=$3,next_attempt_at=$4 WHERE schedule_id=$1 AND due_at=$2",[row.id,row.next_run_at,message,nextAttempt]);await client.query("UPDATE scheduled_payments SET lease_owner=NULL,lease_until=$2,last_status='retrying',last_error=$3 WHERE id=$1",[row.id,nextAttempt,message]);return;}
      const status=result?.status || 'failed',next=nextOccurrence(row),completedAt=instant(now);
      await client.query('UPDATE scheduled_payment_runs SET status=$3,transaction_id=$4,error=$5,next_attempt_at=NULL,completed_at=$6 WHERE schedule_id=$1 AND due_at=$2',[row.id,row.next_run_at,status,result?.id || null,message,completedAt]);
      await client.query('UPDATE scheduled_payments SET status=$2,next_run_at=$3,last_run_at=$4,last_status=$5,last_error=$6,lease_owner=NULL,lease_until=NULL WHERE id=$1',[row.id,next?'active':failure?'failed':'completed',next,completedAt,status,message]);
      if(failure)await ledger.enqueue(client,{userId:row.user_id,type:'schedule.failed',title:'Scheduled payment failed',message:'A scheduled occurrence could not complete. Review its run history.',createdAt:completedAt,metadata:{scheduleId:row.id}});
    });
  }return {schedulesProcessed:due.length};
}
async function dispatch(db,{now=Date.now}={}){return db.transaction(async client=>{const rows=(await client.query("SELECT * FROM notification_outbox WHERE status IN ('pending','processing') AND available_at<=$1 AND (locked_until IS NULL OR locked_until<=$1) ORDER BY created_at,id LIMIT 50 FOR UPDATE SKIP LOCKED",[instant(now)])).rows;for(const row of rows){const event=row.payload_json;await client.query('INSERT INTO notifications(id,user_id,type,title,message,transaction_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',[row.id,row.user_id,event.type,event.title,event.message,event.transactionId || null,event.metadata || {},event.createdAt || row.created_at]);await client.query("UPDATE notification_outbox SET status='delivered',delivered_at=$2,attempts=attempts+1,locked_until=NULL WHERE id=$1",[row.id,instant(now)]);}return {notificationsDelivered:rows.length,notificationsFailed:0};});}
async function notifications(db,user,{unreadOnly=false}={}){const rows=(await db.query(`SELECT * FROM notifications WHERE user_id=$1 ${unreadOnly?'AND read_at IS NULL':''} ORDER BY created_at DESC,id DESC LIMIT 200`,[user.id])).rows;return {notifications:rows.map(row=>({id:row.id,type:row.type,title:row.title,message:row.message,transactionId:row.transaction_id,metadata:row.metadata,createdAt:iso(row.created_at),isRead:Boolean(row.read_at),readAt:iso(row.read_at)})),unreadCount:Number((await db.query('SELECT count(*) AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL',[user.id])).rows[0].count)};}
async function markRead(db,user,id,{now=Date.now}={}){if(id==='all')await db.query('UPDATE notifications SET read_at=COALESCE(read_at,$2) WHERE user_id=$1',[user.id,instant(now)]);else if(!(await db.query('UPDATE notifications SET read_at=COALESCE(read_at,$3) WHERE id=$1 AND user_id=$2',[id,user.id,instant(now)])).rowCount)throw new HttpError(404,'Notification not found.');return notifications(db,user);}
module.exports={listSchedules,createSchedule,cancelSchedule,runDue,nextOccurrence,dispatch,notifications,markRead};
