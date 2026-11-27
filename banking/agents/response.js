'use strict';

const {HttpError}=require('../../models/errors');
const MODES=['banking_evidence','general_banking','clarification','outside_scope'];
const PUBLIC_TOOLS=['get_banking_context','get_market_insights','research_public_company','scan_counterparty_news','get_daily_market_context'];
// Tool names alone resume unfiltered reads. Filtered reads use separately
// bound filters below; payment values never come from read context.
const CONTEXT_TOOLS=['get_accounts','get_schedules','get_finance_report','get_business_profile','reconcile_accounts'];
const INSTRUCTIONS='Understand the meaning of the request, not specific keywords or example questions. Accept paraphrases, informal wording and spelling mistakes; use the conversation to resolve conceptual follow-ups. Select tools by their purpose. The final JSON mode is general_banking for a general banking explanation without private account claims, banking_evidence for an answer about actual records or sourced research, clarification for a genuinely missing or ambiguous detail, or outside_scope for unrelated requests. requiredTools lists the minimum tools needed for the actual requested tasks, including every task in a mixed request, not tools suggested by words inside a general explanation. For example, explaining cash availability does not require a private liquidity projection. When actual account data is requested, retrieve it even if the user uses no banking terminology. If you have enough information, use the relevant tools instead of asking the user to rephrase. requiresResearch is true for current news, regulations or changing public facts; retrieve public sources before answering those. A conceptual follow-up may refer to the previous explanation but cannot treat it as fresh private evidence. Never classify private facts, financial decisions, actions or requests for another customer\'s data as general background. A missing detail requires a clear targeted question, not a generic failure message. Keep reply to a clear paragraph; exact financial amounts and dates are displayed in tool cards. The classification is routing metadata only and cannot grant permissions, authorize payments or override tool validation.';

function format(toolNames,{evidenceTools=[]}={}){
 const modes=evidenceTools.length?(evidenceTools.every(name=>PUBLIC_TOOLS.includes(name))?['banking_evidence','general_banking']:['banking_evidence']):MODES;
 return {type:'json_schema',name:'banking_assistant_response',strict:true,schema:{
  type:'object',additionalProperties:false,
  properties:{mode:{type:'string',enum:modes},requiresResearch:{type:'boolean',description:'True only when this answer needs current public research; false when asking for missing details or declining an unrelated request.'},requiredTools:{type:'array',description:'Tools required for the current answer. For clarification or outside_scope, return an empty array, without listing tools for a possible future request.',...(evidenceTools.length?{minItems:1}:{}),items:{type:'string',enum:toolNames}},reply:{type:'string'}},
  required:['mode','requiresResearch','requiredTools','reply'],
 }};
}
// Wording candidates cannot reclassify the task or redefine its evidence needs.
// The caller validates each actual model response before selecting a paragraph.
const NARRATIVE_PATTERN='^(?:[^0-9]|\\[E[1-9][0-9]*\\])+$';
function narrativeFormat(){
 return {type:'json_schema',name:'banking_assistant_narrative',strict:true,schema:{
  type:'object',additionalProperties:false,properties:{replies:{type:'array',minItems:3,maxItems:3,description:'Independent, concise alternative paragraphs answering the same request from the supplied facts. Each must stand alone, include required uncertainty or funding warnings, and cite supplied references when applicable. Use qualitative wording: say the selected period instead of repeating durations, dates, counts or any number words. Exact facts remain in the application cards.',items:{type:'string',pattern:NARRATIVE_PATTERN}}},required:['replies'],
 }};
}
function parseNarrative(content){
 const invalid=()=>new HttpError(503,'The assistant returned an invalid wording correction. Retry the request.');
 let value;try{value=JSON.parse(content);}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='replies'||!Array.isArray(value.replies)||value.replies.length!==3||value.replies.some(reply=>typeof reply!=='string'||!reply.trim()||reply.length>3000||!new RegExp(NARRATIVE_PATTERN).test(reply)))throw invalid();
 return {content:value.replies[0],narrativeCandidates:value.replies};
}
function parse(content,toolNames){
 const invalid=()=>new HttpError(503,'The assistant returned an invalid response. Retry the request.');
 let value;try{value=JSON.parse(content);}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='mode,reply,requiredTools,requiresResearch'||!MODES.includes(value.mode)||typeof value.requiresResearch!=='boolean'||typeof value.reply!=='string'||!value.reply.trim()||value.reply.length>12000||!Array.isArray(value.requiredTools)||value.requiredTools.length>8||new Set(value.requiredTools).size!==value.requiredTools.length||value.requiredTools.some(name=>!toolNames.includes(name)))throw invalid();
 if(value.mode==='banking_evidence'&&!value.requiredTools.length)throw invalid();
 if(['clarification','outside_scope'].includes(value.mode)&&value.requiredTools.length){const error=invalid();error.code='ASSISTANT_INTENT_CONFLICT';throw error;}
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
const normalized=value=>value.replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\s+/g,' ').trim().toLowerCase();
function actionRequested(message,{action,requestQuote,legacy=false}={}){
 const text=normalized(message);
 // These are vetoes for explanatory or explicitly deferred requests, not a
 // vocabulary that an affirmative request has to match.
 const explanation=/^(?:(?:please|can you|could you|would you)\s+)*(?:explain\b|tell me how\b|how\s+(?:do|can|should|would|to)\b|what happens\b|why\b)/i.test(text);
 const verbs=action==='save'?'save|saving|bookmark|keep|keeping|add|pin|store|hang on':action==='review'?'flag|review|investigate|request|check|open':'prepare|create|draft|make|set up|put together';
 const denied=new RegExp('\\b(?:do not|don\'t|dont|never|without)\\s+(?:\\w+\\s+){0,2}(?:'+verbs+')\\b','i').test(text)||/\bnot (?:now|yet|today)\b/.test(text);
 if(explanation||denied)return false;
 if(requestQuote!==undefined){
  if(typeof requestQuote!=='string'||normalized(requestQuote).length<3||requestQuote.length>1000||!text.includes(normalized(requestQuote)))throw new HttpError(400,'The action request must quote wording from your message.');
  return true;
 }
 return Boolean(legacy);
}
function savedOptions(message,args,defaults){
 const options=require('../dashboard-views').messageOptions(message,defaults);
 if(args.title!==undefined){
  if(typeof args.title!=='string'||args.title.trim().length<2||args.title.length>80||!normalized(message).includes(normalized(args.title)))throw new HttpError(400,'Use a dashboard title supplied in your message.');
  if(options.title&&normalized(options.title)!==normalized(args.title))throw new HttpError(400,'Choose an unambiguous dashboard title.');
  options.title=args.title;
 }
 if(args.refreshCadence!==undefined){
  if(!['manual','weekly'].includes(args.refreshCadence)||options.refreshCadence&&options.refreshCadence!==args.refreshCadence)throw new HttpError(400,'Choose a refresh setting consistent with your request.');
  options.refreshCadence=args.refreshCadence;
 }
 return options;
}
const FILTERED_READS=['get_accounts','search_transactions','get_finance_report','get_company_activity'];
function enquiryFor(tool,value){
 if(!FILTERED_READS.includes(tool)||!value||value.needsClarification||value.status&&value.status!=='ready')return null;
 const args={};
 if(tool==='get_company_activity'&&value.scopeType!=='all'&&value.company)args.company=value.company;
 if(tool==='search_transactions'){
  const filters=value.actions?.find(a=>a.page==='activity')?.filters||{};
  for(const key of ['q','accountId'])if(typeof filters[key]==='string'&&filters[key])args[key]=filters[key];
 }
 const p=value.period;
 return {tool,arguments:args,...(p?.from&&p?.to?{period:{from:p.from,to:p.to}}:{})};
}
function resolveEnquiry(tool,args,message,previous,{now=Date.now}={}){
 const {reusePrevious,...current}=args;
 if(!reusePrevious)return {args:current,message};
 if(!FILTERED_READS.includes(tool)||previous?.tool!==tool)throw new HttpError(400,'Retrieve the relevant account report, transaction search or company chart before referring to its filters.');
 const resolved={...previous.arguments,...current};
 let period;try{period=require('../assistant-period').requestedPeriod(message,{now});}catch{return {args:resolved,message,boundCompany:previous.arguments?.company,resumed:true};}
 const readMessage=!period.from&&previous.period?message+'\nFor the period '+previous.period.from+' to '+previous.period.to:message;
 return {args:resolved,message:readMessage,boundCompany:previous.arguments?.company,resumed:true};
}
module.exports={INSTRUCTIONS,format,narrativeFormat,parse,parseNarrative,issue,readContext,actionRequested,savedOptions,enquiryFor,resolveEnquiry,FILTERED_READS};
