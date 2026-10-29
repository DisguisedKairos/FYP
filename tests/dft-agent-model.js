'use strict';

// Controlled tool-selection double for functional/security tests only.
// Production uses the OpenAI adapter. Real inference is
// exercised separately by demo:agents; this double is not an AI benchmark.
function createTestAgentModel(){
  return {mode:'openai',model:'controlled-test-model',inspect:async()=>({mode:'openai',model:'controlled-test-model',configured:true,available:true,localOnly:false}),chat:async(messages,tools)=>{
    const last=[...messages].reverse().find(m=>m.role==='tool');
    if(last){
      const value=JSON.parse(last.content),draft=last.tool_name==='prepare_payment_draft';
      return {role:'assistant',content:draft && value.data.missing?.length?`Please provide ${value.data.missing.join(', ')} [${value.evidenceId}].`:`Review the cited evidence before using the ordinary banking authorization screen [${value.evidenceId}].`};
    }
    if(!tools.length)return {role:'assistant',content:'Hello.'};
    const text=messages.find(m=>m.role==='user').content;
    const pending=messages.find(m=>m.role==='system' && m.content.startsWith('Existing draft context,'));
    let name,args={};
    if(/\bbalance\b/i.test(text))name='get_accounts';
    else if(/\b(?:history|recent transactions|search|find)\b/i.test(text))name='search_transactions';
    else if(/\b(?:liquidity|cash.?flow|afford|shortfall|cover|projection)\b/i.test(text))name='project_liquidity';
    else if(/^(?:please\s+)?(?:help me\s+)?(?:transfer|send|move|pay|schedule)\b/i.test(text) || pending){
      name='prepare_payment_draft';
      args.kind=/^schedule\b/i.test(text)?'schedule':/^pay\b/i.test(text)?'bill':pending?JSON.parse(pending.content.split('untrusted data: ')[1]).kind:'transfer';
    }else if(/\b(?:scheduled|upcoming)\b/i.test(text))name='get_schedules';
    else return {role:'assistant',content:'Please choose a banking task.'};
    return {role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]};
  }};
}
module.exports={createTestAgentModel};
