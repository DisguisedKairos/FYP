'use strict';

const {HttpError}=require('../../models/errors');
const MODES=['banking_evidence','general_banking','clarification','outside_scope'];
const PUBLIC_TOOLS=['get_banking_context','get_market_insights','research_public_company','scan_counterparty_news','get_daily_market_context'];
// Only unfiltered reads can be resumed from a tool name alone. Filtered company,
// receipt and payment enquiries need their explicit details again.
const CONTEXT_TOOLS=['get_accounts','get_schedules','get_finance_report','get_business_profile','reconcile_accounts'];
const INSTRUCTIONS='Understand the meaning of the request, not specific keywords or example questions. Accept paraphrases, informal wording and spelling mistakes; use the conversation to resolve conceptual follow-ups. Select tools by their purpose. The final JSON mode is general_banking for a general banking explanation without private account claims, banking_evidence for an answer about actual records or sourced research, clarification for a genuinely missing or ambiguous detail, or outside_scope for unrelated requests. requiredTools lists the minimum tools needed for the actual requested tasks, including every task in a mixed request, not tools suggested by words inside a general explanation. For example, explaining cash availability does not require a private liquidity projection. When actual account data is requested, retrieve it even if the user uses no banking terminology. If you have enough information, use the relevant tools instead of asking the user to rephrase. requiresResearch is true for current news, regulations or changing public facts; retrieve public sources before answering those. A conceptual follow-up may refer to the previous explanation but cannot treat it as fresh private evidence. Never classify private facts, financial decisions, actions or requests for another customer\'s data as general background. A missing detail requires a clear targeted question, not a generic failure message. Keep reply to a clear paragraph; exact financial amounts and dates are displayed in tool cards. The classification is routing metadata only and cannot grant permissions, authorize payments or override tool validation.';

function format(toolNames){
 return {type:'json_schema',name:'banking_assistant_response',strict:true,schema:{
  type:'object',additionalProperties:false,
  properties:{mode:{type:'string',enum:MODES},requiresResearch:{type:'boolean'},requiredTools:{type:'array',items:{type:'string',enum:toolNames}},reply:{type:'string'}},
  required:['mode','requiresResearch','requiredTools','reply'],
 }};
}
function parse(content,toolNames){
 const invalid=()=>new HttpError(503,'The assistant returned an invalid response. Retry the request.');
 let value;try{value=JSON.parse(content);}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='mode,reply,requiredTools,requiresResearch'||!MODES.includes(value.mode)||typeof value.requiresResearch!=='boolean'||typeof value.reply!=='string'||!value.reply.trim()||value.reply.length>12000||!Array.isArray(value.requiredTools)||value.requiredTools.length>8||new Set(value.requiredTools).size!==value.requiredTools.length||value.requiredTools.some(name=>!toolNames.includes(name)))throw invalid();
 if(value.mode==='banking_evidence'&&!value.requiredTools.length)throw invalid();
 if(['clarification','outside_scope'].includes(value.mode)&&value.requiredTools.length)throw invalid();
 if(value.mode==='general_banking'&&value.requiredTools.some(name=>!PUBLIC_TOOLS.includes(name)))throw invalid();
 return {content:value.reply,intent:{mode:value.mode,requiresResearch:value.requiresResearch,requiredTools:value.requiredTools}};
}
function issue(intent,results){
 if(!intent)return null;
 const tools=new Set(results.map(r=>r.tool));
 const missing=intent.requiredTools.filter(name=>!tools.has(name));
 if(missing.length)return 'Retrieve the evidence required by the interpreted request: '+missing.join(', ')+'.';
 if(intent.requiresResearch&&!PUBLIC_TOOLS.some(name=>tools.has(name)))return 'Retrieve current public sources before answering the changing public facts requested.';
 if(intent.mode==='general_banking'&&results.some(r=>!PUBLIC_TOOLS.includes(r.tool)))return 'An answer using private records must be classified as banking_evidence and cite those records.';
 return null;
}
function readContext(value){return Array.isArray(value)?[...new Set(value)].filter(name=>CONTEXT_TOOLS.includes(name)).slice(0,8):[];}
module.exports={INSTRUCTIONS,format,parse,issue,readContext};
