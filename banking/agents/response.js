'use strict';

const {HttpError}=require('../../models/errors');
const MODES=['banking_evidence','general_banking','clarification','outside_scope'];
const SCOPE_INSTRUCTIONS='Stay within wholesale banking, the app, business financial activity, company risk and relevant industry or market context. Judge the purpose of the request, not isolated words. Clarification is only for missing information needed by a supported banking or business task. An unrelated personal request remains outside_scope even when it lacks details; do not ask its preferences, collect details or offer to perform it. Business-sector relevance alone does not make a personal request a banking task. Requests explaining how a sector affects the business, its payments or its risks remain supported. For mixed requests, handle the supported banking part and briefly decline the unrelated part. Never use general_banking to answer unrelated questions. A request for another business\'s registered banking profile or private account activity must be declined without retrieving a default owned profile as a substitute. Public company research and the signed-in business\'s own recorded counterparty exposure are separate supported tasks; neither grants access to another customer\'s private data.';
const PUBLIC_TOOLS=['get_banking_context','get_market_insights','research_public_company','scan_counterparty_news','get_daily_market_context'];
// Tool names alone resume unfiltered reads. Filtered reads use separately
// bound filters below; payment values never come from read context.
const CONTEXT_TOOLS=['get_accounts','get_schedules','get_finance_report','get_business_profile','reconcile_accounts'];
const CHART_LABEL_INSTRUCTIONS='The application displays the exact saved-view names and choices in cards. Summarize a saved-view list qualitatively without repeating its titles or count. Never translate, shorten or alter a recorded name to remove digits. For an opened saved chart, either say the selected chart or use its exact retrieved title in quotation marks immediately followed by chart, dashboard or view. Numbers inside that verified label are metadata only, never financial values. A list or unresolved selection does not open a chart; say what is missing and ask the user to choose. Only a successful dashboard result supports claiming it was opened.';
const INSTRUCTIONS='Understand the meaning of the request, not specific keywords or example questions. Accept paraphrases, informal wording and spelling mistakes; use the conversation to resolve conceptual follow-ups. Select tools by their purpose. The final JSON mode is general_banking for a general banking explanation without private account claims, banking_evidence for an answer about actual records or sourced research, clarification for a genuinely missing or ambiguous detail, or outside_scope for unrelated requests. requiredTools lists the minimum tools needed for the actual requested tasks, including every task in a mixed request, not tools suggested by words inside a general explanation. For example, explaining cash availability does not require a private liquidity projection. When actual account data is requested, retrieve it even if the user uses no banking terminology. If you have enough information, use the relevant tools instead of asking the user to rephrase. requiresResearch is true for current news, regulations or changing public facts; retrieve public sources before answering those. A conceptual follow-up may refer to the previous explanation but cannot treat it as fresh private evidence. Never classify private facts, financial decisions, actions or requests for another customer\'s data as general background. An enquiry about funding an additional payment requires check_payment_funds, even without an amount; general balances and existing-schedule coverage do not answer it. Interpret its meaning rather than looking for an affordability keyword. An obligations-only question can use scheduled coverage instead. A missing detail requires a clear targeted question, not a generic failure message. Use a friendly and professional tone. Speak directly to the user, use natural contractions, and lead with a clear, helpful answer. Offer a practical next step when useful. Avoid stiff wording, internal tool names, stock introductions, unnecessary apologies, emojis and excessive reassurance. Explain uncertainty, funding shortfalls and human-review requirements calmly and clearly without softening or omitting them. Keep reply to at most two short paragraphs; exact financial amounts and dates are displayed in tool cards. The classification is routing metadata only and cannot grant permissions, authorize payments or override tool validation.';

function format(toolNames,{evidenceTools=[]}={}){
 const modes=evidenceTools.length?(evidenceTools.every(name=>PUBLIC_TOOLS.includes(name))?['banking_evidence','general_banking']:['banking_evidence']):MODES;
 return {type:'json_schema',name:'banking_assistant_response',strict:true,schema:{
  type:'object',additionalProperties:false,
  properties:{mode:{type:'string',enum:modes,description:'Use clarification only for missing details of a supported banking or business task. Use outside_scope for unrelated personal tasks, even if they are incomplete. Do not clarify or offer to perform an unrelated request.'},requiresResearch:{type:'boolean',description:'True only when this answer needs current public research; false when asking for missing details or declining an unrelated request.'},requiredTools:{type:'array',description:'Tools required for the current answer. For clarification or outside_scope, return an empty array, without listing tools for a possible future request.',...(evidenceTools.length?{minItems:1}:{}),items:{type:'string',enum:toolNames}},reply:{type:'string',description:'Only the banking answer addressed to the user. No serialized data, code fences, formatting instructions, schema discussion or commentary about writing the answer.'}},
  required:['mode','requiresResearch','requiredTools','reply'],
 }};
}
// Wording correction cannot reclassify the task or redefine its evidence needs.
// The caller validates the actual model paragraph before displaying it.
const NARRATIVE_PATTERN='^(?:[^0-9]|\\[E[0-9]+\\])+$';
function narrativeFormat(){
 return {type:'json_schema',name:'banking_assistant_narrative',strict:true,schema:{
  type:'object',additionalProperties:false,properties:{reply:{type:'string',pattern:NARRATIVE_PATTERN,description:'Only the concise banking answer for the user, with relevant uncertainty and supplied evidence references. Use qualitative wording such as the selected period or the matching records. Exact figures are displayed in the application cards. Do not include numerical quantities, JSON fragments, code or commentary about generating the response.'}},required:['reply'],
 }};
}
function parseNarrative(content){
 const invalid=()=>new HttpError(503,'The assistant returned an invalid wording correction. Retry the request.');
 let value;try{value=JSON.parse(content);}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='reply'||typeof value.reply!=='string'||!value.reply.trim()||value.reply.length>3000)throw invalid();
 if(!new RegExp(NARRATIVE_PATTERN).test(value.reply))throw invalid();
 // Financial meaning and prose still pass the controller's safety checks.
 return {content:value.reply};
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
function toolEvidence(step,value){
 // Public reports place dated developments after profile/background paragraphs.
 // Keep their bounded text; source annotation offsets are only needed by the UI.
 for(const limit of [16000,8000,4000,2000,1000,500,200,100,40]){
  let shortened=false;
  const compact=(item,key)=>{
   if(Array.isArray(item)){if(item.length>20)shortened=true;return item.slice(0,20).map(value=>compact(value));}
   if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).filter(([name])=>!['actions','draft','nextSteps','annotations'].includes(name)).map(([name,value])=>[name,compact(value,name)]));
   if(typeof item==='string'){const size=key==='text'?limit:Math.min(1200,limit);if(item.length>size)shortened=true;return item.slice(0,size);}
   return item;
  };
  const data=compact(value),content=JSON.stringify({evidenceId:`E${step}`,data,...(shortened?{contextTruncated:true,contextNote:'Some long text or lists were shortened for model context. Do not infer omitted details. Full authoritative results remain in the application.'}:{})});
  if(content.length<=18000)return content;
 }
 throw new HttpError(413,'The evidence exceeds the assistant context limit. Ask for a narrower report.');
}
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
  for(const key of ['q','accountId','status','type','counterparty','externalOnly','dateBasis'])if(typeof filters[key]==='string'&&filters[key])args[key]=filters[key];
 }
 const p=value.period;
 return {tool,arguments:args,...(p?.from&&p?.to?{period:{from:p.from,to:p.to}}:{})};
}
function compatibleEnquiry(tool,previous){
 if(!FILTERED_READS.includes(tool)||!FILTERED_READS.includes(previous?.tool))return null;
 if(previous.tool===tool)return previous;
 const source=previous.arguments||{};
 if(previous.tool==='get_company_activity'&&tool==='search_transactions')return {...previous,tool,arguments:{...(source.company?{q:source.company,counterparty:source.company}:{}),externalOnly:'true',dateBasis:'activity'}};
 // A chart cannot represent a free-text, account, direction or status filter.
 // Refuse conversion rather than silently expanding its scope.
 if(Object.values(source).some(value=>value!==undefined&&value!==''))return null;
 if(previous.period)return {...previous,tool,arguments:{}};
 return null;
}
function requestedSavedDashboard(message,listed,previous=[]){
 const text=normalized(message),quoted=[...text.matchAll(/(?:^|[\s(])(?:"([^"]+)"|'(.+?)')(?=$|[\s.,!?;)])/g)].map(match=>match[1]||match[2]);
 const mentions=title=>{let at=-1;while((at=text.indexOf(title,at+1))!==-1)if(!/[\p{L}\p{N}_]/u.test(text[at-1]||'')&&!/[\p{L}\p{N}_]/u.test(text[at+title.length]||''))return true;return false;};
 const named=listed.filter(view=>quoted.length?quoted.includes(normalized(view.title)):mentions(normalized(view.title)));
 if(quoted.length&&named.length!==1)return null;
 const words=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'];
 const ordinal=text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th))\s+(?:one|chart|dashboard|view)\b/);
 const numbered=text.match(/\b(?:chart|dashboard|view)\s+(?:number\s*|#\s*)?(\d{1,2})\b/);
 const choices=previous.length?previous:listed;
 const position=ordinal?(ordinal[1]==='last'?choices.length:words.includes(ordinal[1])?words.indexOf(ordinal[1])+1:parseInt(ordinal[1],10)):numbered?Number(numbered[1]):null;
 const selected=position===null?null:listed.find(view=>view.id===choices[position-1]?.id);
 if(named.length>1||position!==null&&(!selected||named.length===1&&named[0].id!==selected.id))return null;
 const sole=listed.length===1&&/\b(?:it|that one|(?:my|the|this|that)(?: only| sole)?(?: saved)? (?:chart|dashboard|view))\b/.test(text)?listed[0]:null;
 return named[0]||selected||sole;
}
function resolveEnquiry(tool,args,message,previous,{now=Date.now}={}){
 const {reusePrevious,...current}=args;
 if(!reusePrevious)return {args:current,message};
 const compatible=compatibleEnquiry(tool,previous);
 if(!compatible)throw new HttpError(400,'Retrieve a compatible account report, transaction search or company chart before referring to its filters.');
 const resolved={...compatible.arguments,...current};
 // These phrases refer to a bound period, not an unfilled date field. Keep
 // every explicit new date intact, including invalid dates needing correction.
 if(compatible.period)message=message.replace(/\b(?:the same|those|these|same|original|selected|shown|existing)\s+(?:dates?|date range|period|range)\b/gi,'the reporting window');
 let period;try{period=require('../assistant-period').requestedPeriod(message,{now});}catch{return {args:resolved,message,boundCompany:previous.arguments?.company,resumed:true};}
 const readMessage=!period.from&&compatible.period?message+'\nFor the period '+compatible.period.from+' to '+compatible.period.to:message;
 return {args:resolved,message:readMessage,boundCompany:previous.arguments?.company,resumed:true};
}
module.exports={INSTRUCTIONS:INSTRUCTIONS+' '+SCOPE_INSTRUCTIONS+' '+CHART_LABEL_INSTRUCTIONS,format,narrativeFormat,parse,parseNarrative,issue,readContext,toolEvidence,actionRequested,savedOptions,enquiryFor,resolveEnquiry,compatibleEnquiry,requestedSavedDashboard,FILTERED_READS};
