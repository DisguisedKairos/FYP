'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createOpenAIModel}=require('../banking/agents/openai');
const {identity,validProvenance}=require('../banking/ai-provider');
const {fixture,modelStub}=require('./dft-helpers');
async function financialSnapshot(db){return {accounts:(await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT id,status,amount_cents FROM transactions ORDER BY id')).rows};}
const MODEL='gpt-6-luna',KEY='test-only-openai-key-not-a-real-secret';
const response=output=>({id:'resp_controlled',status:'completed',model:MODEL,output});
const text=value=>({type:'message',role:'assistant',content:[{type:'output_text',text:value}]});
const tool={type:'function',function:{name:'search_transactions',parameters:{type:'object',properties:{q:{type:'string'}},required:[],additionalProperties:false}}};
function adapter(work){return createOpenAIModel({model:MODEL,apiKey:KEY,fetchImpl:async(url,options)=>{
  assert.equal(url.origin,'https://api.openai.com');assert.equal(options.headers.Authorization,'Bearer '+KEY);assert.equal(options.redirect,'error');
  return new Response(JSON.stringify(await work(url,options)));
}});}
test('OpenAI key remains server-only; missing credentials never make a network request',async()=>{
 let calls=0;const model=createOpenAIModel({apiKey:'',fetchImpl:async()=>{calls++;throw new Error('unexpected');}});
 assert.equal((await model.inspect()).configured,false);await assert.rejects(model.chat([],[]),error=>error.status===503);assert.equal(calls,0);
});
test('Responses tools use strict nullable arguments, bounded output and disabled storage',async()=>{
 const model=adapter(async(url,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.parallel_tool_calls,false);assert.equal(body.tools[0].strict,true);assert.deepEqual(body.tools[0].parameters.properties.q.type,['string','null']);assert.equal(JSON.stringify(body).includes(KEY),false);
  return response([{type:'function_call',name:'search_transactions',call_id:'call_lookup',arguments:'{"q":null}'}]);
 });
 const result=await model.chat([{role:'user',content:'Find activity'}],[tool]);assert.deepEqual(result.tool_calls[0].function.arguments,{});assert.equal(result.tool_calls[0].id,'call_lookup');
});
test('Responses preserves original call IDs and reasoning items between tool rounds',async()=>{
 const model=adapter(async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.input[0].type,'reasoning');assert.equal(body.input[1].call_id,'call_original');assert.equal(body.input[2].call_id,'call_original');return response([text('See the supplied evidence [E1].')]);});
 const output=[{type:'reasoning',id:'rs_controlled',summary:[],encrypted_content:'encrypted-test-state'},{type:'function_call',name:'search_transactions',call_id:'call_original',arguments:'{}'}];
 const result=await model.chat([{role:'assistant',content:'',responseItems:output,tool_calls:[{id:'call_original',function:{name:'search_transactions',arguments:{}}}]},{role:'tool',tool_call_id:'call_original',tool_name:'search_transactions',content:'{"evidenceId":"E1"}'}],[tool]);assert.match(result.content,/supplied evidence/);
});
test('OpenAI refuses incomplete output, refusals, mismatched models, unsupported tools and excessive bodies',async()=>{
 for(const value of [{...response([text('partial')]),status:'incomplete'},{...response([text('wrong')]),model:'other-model'},response([{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Cannot answer'}]}]),response([{type:'function_call',name:'execute_payment',call_id:'call_bad',arguments:'{}'}]),response([text('x'.repeat(260000))])]){
  const model=adapter(async()=>value);await assert.rejects(model.chat([{role:'user',content:'test'}],[tool]),error=>error.status===503);
 }
});
test('API failures never echo upstream errors or API keys',async()=>{
 const model=createOpenAIModel({apiKey:KEY,fetchImpl:async()=>new Response(JSON.stringify({error:{message:KEY}}),{status:401})});
 await assert.rejects(model.chat([],[]),error=>error.status===503 && !error.message.includes(KEY));assert.equal((await model.inspect()).available,false);
});
test('OpenAI provenance records provider identity without claiming a weights digest',()=>{
 const record={provider:'openai',modelName:MODEL,modelIdentitySha256:identity(MODEL),promptSha256:'b'.repeat(64)};
 assert.equal(validProvenance(record),true);assert.equal(validProvenance({...record,provider:'ollama'}),false);assert.equal(validProvenance({...record,modelIdentitySha256:'a'.repeat(64)}),false);assert.equal(validProvenance({...record,modelSha256:'a'.repeat(64)}),false);
});
test('OpenAI assistant reads owned evidence and records the configured provider without moving funds',async t=>{
 const agentModel=adapter(async(url,options)=>{
  if(url.pathname.includes('/models/'))return {id:MODEL};
  const body=JSON.parse(options.body);
  return body.input.some(item=>item.type==='function_call_output')?response([text('Review the account balances in the supplied evidence [E1].')]):response([{type:'function_call',name:'get_accounts',call_id:'call_accounts',arguments:'{}'}]);
 });
 const f=await fixture(t,{agentModel}),client=f.client();await client.login();const before=await financialSnapshot(f.db);
 const result=await client.request('/api/assistant/messages',{method:'POST',body:{message:'What is my balance?'}});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.engine,'openai');assert.equal(result.data.privacy.externalServices,true);assert.ok(result.data.items.length);
 const run=(await f.db.query('SELECT engine,report_json FROM agent_runs WHERE id=$1',[result.data.runId])).rows[0];assert.equal(run.engine,'openai');assert.equal(run.report_json.aiAudit.provider,'openai');
 const calls=(await f.db.query("SELECT metadata FROM audit_log WHERE event_type='ai.model_call'")).rows.map(r=>r.metadata);assert.ok(calls.length>=2);assert.ok(calls.every(c=>c.provider==='openai' && c.localOnly===false));assert.equal(JSON.stringify(calls).includes(KEY),false);assert.deepEqual(await financialSnapshot(f.db),before);
});

test('OpenAI payment assessments retain integer-cent settlement and independent review',async t=>{
 const assessModel=async input=>({...await modelStub()(input),provider:'openai',modelName:MODEL,modelVersion:'openai:'+MODEL+':fraud-openai-v1',modelSha256:undefined,modelIdentitySha256:identity(MODEL),identityKind:'provider_model_id'});
 const f=await fixture(t,{assessModel}),client=f.client();await client.login();const dash=await client.dashboard();const source=dash.accounts.find(a=>a.name==='Operating savings');
 const result=await client.request('/api/transfers',{method:'POST',body:{fromAccountId:source.id,toAccountNumber:'1020002001',amount:'1.00',requestId:require('node:crypto').randomUUID(),authorizationPassword:'Greenlink123!'}});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.transaction.risk.provider,'openai');assert.equal(result.data.transaction.status,'completed');assert.equal(result.data.transaction.risk.modelIdentitySha256,identity(MODEL));assert.equal(result.data.transaction.risk.modelSha256,undefined);
 const after=await client.dashboard();assert.equal(after.accounts.find(a=>a.id===source.id).balanceCents,source.balanceCents-100);
});
