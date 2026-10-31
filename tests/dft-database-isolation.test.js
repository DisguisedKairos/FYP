'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const {fixture}=require('./dft-helpers');
const {createDatabase}=require('../database');
test('A blocked migration in one schema does not block initialization of an independent schema',{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const first=await fixture(t,{http:false,seed:false}),schema='dft_'+randomUUID().replace(/-/g,'');
  const blocker=new Client({connectionString:process.env.TEST_DATABASE_URL});await blocker.connect();
  const other=createDatabase({connectionString:process.env.TEST_DATABASE_URL,poolOptions:{options:`-c search_path=${schema}`}});
  let pending;
  try{
    await blocker.query(`CREATE SCHEMA ${schema}`);
    await blocker.query('BEGIN');await blocker.query(`LOCK TABLE ${first.schema}.schema_migrations IN ACCESS EXCLUSIVE MODE`);
    pending=first.db.migrate();
    let waiting=false;
    for(let tries=0;tries<40;tries++){
      const locks=await blocker.query("SELECT 1 FROM pg_locks WHERE relation=$1::regclass AND NOT granted",[first.schema+'.schema_migrations']);
      if(locks.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(waiting,'The first migration is paused by a real table lock.');
    let timer;
    try{await Promise.race([other.migrate(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('An unrelated schema migration blocked initialization.')),2500);})]);}
    finally{clearTimeout(timer);}
    assert.equal(Number((await other.query('SELECT count(*) FROM schema_migrations')).rows[0].count),10);
  }finally{
    await blocker.query('ROLLBACK');if(pending)await pending;await other.close();
    assert.match(schema,/^dft_[a-f0-9]{32}$/);await blocker.query(`DROP SCHEMA ${schema} CASCADE`);await blocker.end();
  }
});

test('A checked-out PostgreSQL connection error cannot crash the app or commit interrupted work',{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const f=await fixture(t,{http:false,seed:false});
  const messages=[];t.mock.method(console,'error',(...args)=>messages.push(args.join(' ')));
  await assert.rejects(f.db.transaction(async client=>{
    await client.query("INSERT INTO audit_log(event_type,metadata) VALUES('test.interrupted_transaction','{}')");
    client.emit('error',Object.assign(new Error('private upstream connection details'),{code:'ECONNRESET'}));
  }),/interrupted before commit/);
  assert.equal(Number((await f.db.query("SELECT count(*) FROM audit_log WHERE event_type='test.interrupted_transaction'")).rows[0].count),0);
  assert.equal((await f.db.query('SELECT true AS ready')).rows[0].ready,true);
  assert.ok(messages.some(message=>message.includes('ECONNRESET')));
  assert.equal(messages.join(' ').includes('private upstream'),false);
});
