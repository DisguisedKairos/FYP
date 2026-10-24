'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {extractDraft}=require('../banking/agents/drafts');
const accounts=[{id:'1',name:'Operating savings',number:'1088800101'},{id:'2',name:'Liquidity reserve',number:'1088800102'}];
const parse=(text,previous={})=>extractDraft(text,previous,accounts,[{id:'pub',name:'PUB'}],{now:()=>Date.parse('2026-10-24T08:00:00Z')});
test('Assistant preserves grouped currency amounts and refuses malformed decimal tokens',()=>{
  assert.equal(parse('Transfer SGD 1,000.50 to 1088800201').amount,'1000.50');
  assert.equal(parse('Pay 12,000 to PUB reference INV-1').amount,'12000');
  for(const token of ['10.005','1,00.50','1e3','-5','100.00.5'])assert.throws(()=>parse('Transfer '+token+' to 1088800201'),e=>e.status===400,token);
  assert.equal(parse('1088800201',{kind:'transfer',amount:'25.00'}).amount,'25.00');
});
test('Assistant never silently replaces an explicit unknown source with the first account',()=>{
  assert.throws(()=>parse('Transfer SGD 5 from Unknown account to 1088800201'),e=>e.status===400);
  assert.equal(parse('Transfer SGD 5 from Liquidity reserve to Operating savings').fromAccountId,'2');
  assert.equal(parse('Transfer SGD 5 from Liquidity reserve to Operating savings').toAccountNumber,'1088800101');
  assert.equal(parse('to Unknown business',{kind:'transfer',toAccountNumber:'1088800201'}).toAccountNumber,undefined);
});
test('Explicit tomorrow time is interpreted in Singapore and ambiguous dates are refused',()=>{
  assert.equal(parse('Schedule transfer SGD 5 to 1088800201 tomorrow at 15:30 once').scheduledAt,'2026-10-25T07:30:00.000Z');
  assert.equal(parse('Schedule transfer SGD 5 to 1088800201 tomorrow at 12 am once').scheduledAt,'2026-10-24T16:00:00.000Z');
  assert.throws(()=>parse('Schedule transfer SGD 5 tomorrow at 25:30 once'),e=>e.status===400);
  for(const time of ['9.30','15:300','9pmfoo','noon'])assert.throws(()=>parse('Schedule transfer SGD 5 tomorrow at '+time+' once'),e=>e.status===400,time);
  assert.throws(()=>parse('Schedule transfer SGD 5 tomorrow at 2030-01-01T01:00:00Z once'),e=>e.status===400);
});
