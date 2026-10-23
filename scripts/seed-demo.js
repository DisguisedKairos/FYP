'use strict';
const { randomUUID } = require('node:crypto');
const { createOperatorDatabase: createDatabase } = require('../database');
const { hashPassword } = require('../banking/security');
const businesses = require('../banking/business');

async function seedDemo(db, { now = Date.now } = {}) {
  const passwordHash = await hashPassword('Greenlink123!');
  const date = (days, hour = 4) => { const value = new Date(now() - days * 86400000); value.setUTCHours(hour, 15, 0, 0); return value.toISOString(); };
  return db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(783456121)');
    if (Number((await client.query('SELECT count(*) AS count FROM users')).rows[0].count)) return { seeded: false };
    const users = {};
    for (const [key, name, role, days] of [['alex','Alex Morgan','admin',100],['jamie','Jamie Lee','customer',90],['reviewer','Sam Rivera','admin',100]]) {
      users[key] = (await client.query('INSERT INTO users(name,email,password_hash,role,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, `${key}@greenlink.demo`, passwordHash, role, date(days)])).rows[0].id;
    }
    for(const [key,legalName,registrationNumber] of [['alex','Meridian Logistics Pte. Ltd.','202600001A'],['jamie','Harbour Supplies Pte. Ltd.','202600002B'],['reviewer','Northstar Treasury Pte. Ltd.','202600003C']]) {
      await businesses.create(client,{id:users[key]},{legalName,registrationNumber,country:'SG',legalForm:'company',industry:'Business services',registeredAddress:'1 Sample Business Avenue, Singapore 000001'},{now,status:'approved'});
    }
    const accounts = {};
    for (const [key, owner, name, number, days] of [['main','alex','Operating savings','1020001001',100],['rainy','alex','Liquidity reserve','1020001002',80],['jamie','jamie','Operating savings','1020002001',90],['reviewer','reviewer','Operating savings','1020009001',100]]) {
      accounts[key] = (await client.query("INSERT INTO accounts(user_id,name,number,opening_provenance,created_at) VALUES($1,$2,$3,'seed',$4) RETURNING id", [users[owner], name, number, date(days)])).rows[0].id;
    }
    const rows = [
      ['main','credit','Opening balance',1898250,'Welcome deposit','DEMO-OPENING',false,100,null],
      ['main','credit','Invoice settlement',520000,'Acme Trading Pte. Ltd.','INVOICE-025',false,24,null],
      ['main','bill','SP Services bill',-12680,'SP Services','SP-810294',false,18,'sp-services'],
      ['main','transfer','Supplier invoice payment',-8500,'Harbour Supplies Pte. Ltd.','DEMO-SUPPLIER',false,14,'1020002001'],
      ['jamie','credit','Opening balance',111500,'Welcome deposit','DEMO-OPENING',false,90,null],
      ['jamie','transfer','Supplier invoice payment',8500,'Meridian Logistics Pte. Ltd.','DEMO-SUPPLIER',false,14,'1020001001'],
      ['main','transfer','Liquidity allocation',-50000,'Liquidity reserve','DEMO-LIQUIDITY',true,10,'1020001002'],
      ['rainy','credit','Opening balance',470000,'Welcome deposit','DEMO-OPENING',false,80,null],
      ['rainy','transfer','Liquidity allocation',50000,'Operating savings','DEMO-LIQUIDITY',true,10,'1020001001'],
      ['main','bill','Business connectivity bill',-4800,'Singtel','ST-298134',false,5,'singtel'],
      ['main','credit','Client invoice receipt',142780,'Studio North Pte. Ltd.','INVOICE-026',false,2,null],
    ];
    for (const [key,type,description,cents,counterparty,reference,internal,days,payee] of rows) {
      await client.query(`INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq,payee,biller_id)
        VALUES($1,$2,$3,$4,$5,$6,'completed',$7,$8,$9,$9,$9,nextval('settlement_sequence'),$10,$11)`, [randomUUID(),accounts[key],type,description,cents,counterparty,reference,internal,date(days),payee,type === 'bill' ? payee : null]);
    }
    await client.query("UPDATE accounts a SET balance_cents=(SELECT COALESCE(sum(t.amount_cents),0) FROM transactions t WHERE t.account_id=a.id AND t.status='completed')");
    await client.query("INSERT INTO audit_log(event_type,metadata) VALUES('operator.demo_seeded','{\"sampleFunds\":true}')");
    return { seeded: true };
  });
}
module.exports = { seedDemo };
if (require.main === module) (async () => { const db = createDatabase(); try { await db.migrate(); console.log(await seedDemo(db)); } finally { await db.close(); } })().catch(error => { console.error(error.message); process.exitCode=1; });
