import {counterpartyRiskHtml} from './counterparty-risk.js';
import {publicResearchHtml} from './public-research.js';
import {paymentReadinessHtml} from './payment-planning.js';
import {fundingWarningsHtml,renderAutomaticFunding} from './funding.js';
import {financeReportHtml,cancelFinanceReports} from './finance-reports.js';
import {dashboardHtml,savedDashboardsHtml,hydrateDashboardCharts,cancelAssistantDashboards} from './assistant-dashboards.js';
import {bindAssistantWindow,renderAssistantWindow,stopAssistantResize} from './assistant-window.js';
// Raw messages stay in browser memory. Reports, tool evidence and draft context
// are retained privately; financial actions only open the ordinary banking forms.
import { state, api, esc, icon, money, sameId, pages, allAccounts, emptyFilters, statusLabel, shortDate, navigate, toast, recoverSession } from './core.js';
import { openScheduleDraft } from './services.js';
let controller,generation=0,nextMessageId=0;
let requestedOpen=new URLSearchParams(location.search).get('chat')==='open';
const SAFE_SECURITY_HELP = /^(?:(?:how (?:do|can) i|where can i) (?:change|reset) my password|how (?:do|can) i (?:enable|disable) (?:mfa|two-factor authentication)|how (?:do|can) i use recovery codes|test mfa\/recovery and password change\/session revocation through profile & security)[.!?]*$/i;
function credentialText(message){
  // Keep this scanner-only normalization aligned with the server. Send the
  // original chart request; any other PIN or credential marker still blocks it.
  return message.replace(/\bpin\b/gi,(word,offset,text)=>{
    if(/\b(?:my|your|our|the|a)\s*$/i.test(text.slice(0,offset)))return word;
    const rest=text.slice(offset+word.length);
    const target=rest.match(/^\s+(?:(?:this|that|the|my|our|a|an|current|displayed|selected|latest|new|bar|line|monthly|weekly)\s+){0,4}(?:chart|dashboard|graph|visuali[sz]ation|view|report|summary)\b/i)||rest.match(/^\s+(?:it|this|that)\b/i);
    if(!target||/^\s*(?:(?:is|was|are|were|equals?|reads?|code|number|value)\b|['\u2019]s\b|[:=]|\d)/i.test(rest.slice(target[0].length)))return word;
    return 'bookmark';
  });
}
const starters=['What is my balance?','Show my recent transactions','Check my transactions for fraud using daily market trends','Generate a downloadable finance report'];
const messageTimeFormat=new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function thread() { return state.assistant || (state.assistant={messages:[],input:'',busy:false,error:'',retryMessage:'',previousRunId:null,open:false,unread:false}); }
function messageTimeHtml(message) {
  if(typeof message.createdAt!=='string')return '';
  const date=new Date(message.createdAt);
  if(!Number.isFinite(date.getTime()))return '';
  const label=messageTimeFormat.format(date)+' SGT';
  return '<time class="assistant-message-time" datetime="'+date.toISOString()+'" aria-label="'+(message.role==='user'?'Sent ':'Received ')+esc(label)+'">'+esc(label)+'</time>';
}
function itemContent(item) {
  if(typeof item==='string')return '<li>'+esc(item)+'</li>';
  if(!item || typeof item!=='object')return '';
  const label=item.label || item.title || item.name || item.description || '';
  const value=item.value ?? (typeof item.balanceCents==='number' ? money(item.balanceCents) : typeof item.amountCents==='number' ? money(item.amountCents) : '');
  const detail=[item.detail || item.subtitle || item.meta || '',item.accountNumber || '',item.status ? statusLabel(item.status) : '',item.date ? shortDate(item.date)+' SGT' : '',typeof item.score==='number'?'Risk score '+item.score:''].filter(Boolean).join(' · ');
  return '<li><div><strong>'+esc(label)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+(Array.isArray(item.reasons)?'<ul>'+item.reasons.map(reason=>'<li>'+esc(reason)+'</li>').join('')+'</ul>':'')+'</div>'+(value!==''?'<span>'+esc(value)+'</span>':'')+'</li>';
}
function requestedEvidenceDisplay(text) {
  const target='(?:(?:the|my|your|supporting)\\s+)*evidence(?:\\s+(?:tab|section|panel|details))?';
  const directives=new RegExp("\\b(?:(do not|don't|dont|never|not)\\s+)?(?:(collapse|minimize|minimise|hide|expand|show|open|include)\\s+(?:me\\s+)?"+target+'|(?:keep|leave)\\s+'+target+'\\s+(open|expanded|visible|closed|collapsed|minimized|minimised|hidden))','gi');
  let expanded;
  for(const match of text.replace(/[\u2018\u2019]/g,"'").matchAll(directives)){
    expanded=!/^(?:collapse|minimize|minimise|hide|closed|collapsed|minimized|minimised|hidden)$/i.test(match[2]||match[3]);
    if(match[1])expanded=!expanded;
  }
  return expanded;
}
function evidenceHtml(message) {
  const labels=(message.evidenceReferences||[]).map(reference=>reference?.label).filter(label=>typeof label==='string'&&label.trim());
  if(!labels.length)return '';
  return '<details class="assistant-evidence"'+(message.evidenceExpanded?' open':'')+'><summary>Evidence</summary><ul>'+labels.map(label=>'<li>'+esc(label)+'</li>').join('')+'</ul></details>';
}
function messageHtml(message) {
  const dashboard=message.role==='assistant'?publicResearchHtml(message)+counterpartyRiskHtml(message)+savedDashboardsHtml(message)+dashboardHtml(message)+financeReportHtml(message)+paymentReadinessHtml(message):'';
  return '<article data-message-id="'+message.id+'" class="assistant-message '+(message.role==='user'?'from-user':'from-assistant')+'" aria-label="'+(message.role==='user'?'You':'GLDB Assistant')+'"><div class="assistant-message-header"><div class="assistant-message-author">'+(message.role==='user'?'You':icon('chat')+' GLDB Assistant')+'</div>'+messageTimeHtml(message)+'</div><'+(message.role==='assistant'?'p':'div')+' class="assistant-message-text">'+esc(message.text)+'</'+(message.role==='assistant'?'p':'div')+'>'+(message.items?.length?'<ul class="assistant-items">'+message.items.map(itemContent).join('')+'</ul>':'')+(message.paymentReadiness?'':fundingWarningsHtml(message.fundingWarnings||[]))+dashboard+(message.actions?.length?'<div class="assistant-actions">'+message.actions.map((action,index)=>'<button type="button" class="button secondary" data-assistant-action="'+message.id+':'+index+'">'+esc(action.label || 'Open banking form')+' '+icon('arrow')+'</button>').join('')+'</div>':'')+evidenceHtml(message)+(message.auditRunId && state.user?.role==='admin'?'<button type="button" class="text-button" data-ai-audit-kind="agent" data-ai-audit-id="'+esc(message.auditRunId)+'">View AI audit</button>':'')+'</article>';
}
function suggestionHtml() {
  const messages=thread().messages;
  const last=[...messages].reverse().find(message=>message.role==='assistant');
  const suggestions=last?.suggestions?.length?last.suggestions:messages.length?[]:starters;
  return suggestions.slice(0,4).map(text=>'<button type="button" class="assistant-suggestion" data-assistant-suggestion="'+esc(text)+'">'+esc(text)+'</button>').join('');
}
function welcomeHtml() {
  return '<div class="assistant-welcome">'+icon('chat')+'<h3>How can I help your business?</h3><p>Check balances, summarize company activity, save dashboards, get industry news advice and advisory flags, check counterparty compliance sources, download finance reports or prepare a payment draft. You stay in control of every payment.</p></div>';
}
function popupContent() {
  const t=thread();
  return '<button type="button" class="assistant-resize-handle" aria-label="Resize GLDB Assistant" aria-describedby="assistant-resize-help" title="Drag to resize"><span aria-hidden="true"></span></button><span id="assistant-resize-help" class="sr-only">Drag this corner to resize. Or use arrow keys: left to widen, right to narrow, up to increase height, down to decrease height. Hold Shift for larger steps.</span><header class="assistant-panel-heading"><div><h2 id="assistant-title">GLDB Assistant</h2><p>Your business banking assistant</p></div><div class="assistant-window-actions"><button type="button" class="text-button" data-action="assistant-settings">Settings</button><button type="button" class="text-button" data-action="assistant-clear" aria-label="Clear conversation">Clear</button><button type="button" class="icon-button" data-action="assistant-expand" aria-label="Expand GLDB Assistant" aria-pressed="false">'+icon('expand')+'</button><button type="button" class="icon-button" data-action="assistant-close" aria-label="Minimize GLDB Assistant">'+icon('close')+'</button></div></header><p class="assistant-disclosure">Uses OpenAI. Your message and permitted banking evidence are sent for analysis. Never share passwords or security codes.</p><div id="assistant-thread" class="assistant-thread" role="log" aria-label="Conversation with GLDB Assistant" aria-live="polite" aria-relevant="additions text">'+(t.messages.length?t.messages.map(messageHtml).join(''):welcomeHtml())+'</div><div id="assistant-response-status" class="assistant-response-status" role="status"></div><div id="assistant-error" class="error-message assistant-error" role="alert"></div><div id="assistant-suggestions" class="assistant-suggestions">'+suggestionHtml()+'</div><form id="assistant-form" class="assistant-form" aria-busy="'+t.busy+'"><label for="assistant-message">Your message</label><div class="assistant-composer"><textarea id="assistant-message" name="message" rows="2" maxlength="1000" required placeholder="How can I help?" aria-describedby="assistant-privacy">'+esc(t.input)+'</textarea><button type="submit" class="button" aria-label="Send message" '+(t.busy?'disabled':'')+'>Send '+icon('arrow')+'</button></div><small id="assistant-privacy">Drafts need your review and password in the banking form. Chat never sends money.</small></form>';
}
export function renderAssistant() {
  const root=document.querySelector('#assistant-root');
  if(!root)return;
  if(!state.user || !state.data || state.signingOut){stopAssistantResize();root.replaceChildren();return;}
  const t=thread();
  if(requestedOpen){
    t.open=true;requestedOpen=false;
    const url=new URL(location.href);url.searchParams.delete('chat');history.replaceState({},'',url.pathname+url.search+url.hash);
  }
  if(!root.querySelector('#assistant-popup')){
    root.innerHTML='<div id="funding-announcement" class="sr-only" role="status" aria-live="polite"></div><div class="assistant-funding-preview" hidden></div><button type="button" class="assistant-launcher" data-action="assistant-toggle" aria-label="Open GLDB Assistant" aria-controls="assistant-popup" aria-expanded="false">'+icon('chat')+'<span>Ask GLDB</span><span class="assistant-unread" hidden>New reply</span></button><section id="assistant-popup" class="assistant-popup" role="dialog" aria-modal="false" aria-labelledby="assistant-title" hidden></section>';
    bindAssistantWindow(root.querySelector('#assistant-popup'));
    root.querySelector('#assistant-popup').addEventListener('toggle',event=>{
      if(!event.target.matches('details.assistant-evidence,details.news-insights,details.news-insight'))return;
      const id=event.target.closest('[data-message-id]')?.dataset.messageId;
      const message=state.assistant?.messages.find(message=>String(message.id)===id);
      if(!message)return;
      if(event.target.matches('.assistant-evidence'))message.evidenceExpanded=event.target.open;
      else if(event.target.matches('.news-insights'))message.newsExpanded=event.target.open;
      else (message.newsFlagsExpanded||={})[event.target.dataset.newsIndex]=event.target.open;
    },true);
  }
  root.classList.toggle('assistant-open',t.open);
  root.classList.toggle('assistant-has-dashboard',t.messages.some(message=>message.dashboard));
  const popup=root.querySelector('#assistant-popup');popup.hidden=!t.open;
  if(t.open && !popup.querySelector('#assistant-form'))popup.innerHTML=popupContent();
  else if(!t.open)popup.replaceChildren();
  renderAssistantWindow(popup);
  const launcher=root.querySelector('.assistant-launcher');
  launcher.setAttribute('aria-expanded',String(t.open));
  launcher.setAttribute('aria-label',t.open?'Minimize GLDB Assistant':'Open GLDB Assistant'+(t.unread?', new reply':''));
  launcher.querySelector('.assistant-unread').hidden=!t.unread;
  renderThread();
  renderAutomaticFunding();
}
export function toggleAssistant() {
  if(!state.user || !state.data || state.signingOut)return;
  if(thread().open)return closeAssistant();
  thread().open=true;thread().unread=false;
  renderAssistant();
  const target=document.querySelector('#assistant-thread');target.scrollTop=target.scrollHeight;
  document.querySelector('#assistant-message')?.focus();
}
export function closeAssistant({focus=true}={}) {
  if(!state.assistant?.open)return;
  const hadFocus=Boolean(document.activeElement?.closest('#assistant-root'));
  stopAssistantResize();state.assistant.open=false;renderAssistant();
  if(focus)document.querySelector('.assistant-launcher')?.focus();
  else if(hadFocus)document.querySelector('#main-content')?.focus();
}
export function resetAssistant() {
  requestedOpen=false;cancelAssistant();state.assistant=null;renderAssistant();
}
function renderThread() {
  if(!state.user || state.signingOut)return;
  const target=document.querySelector('#assistant-thread');
  if(!target)return;
  const t=thread(),atBottom=target.scrollHeight-target.scrollTop-target.clientHeight<48;let added=false;
  if(!target.querySelector('#automatic-funding'))target.insertAdjacentHTML('afterbegin','<section id="automatic-funding" class="automatic-funding" tabindex="-1" aria-label="Automatic funding check" aria-live="off" hidden></section>');
  if(!t.messages.length)target.querySelectorAll('[data-message-id]').forEach(message=>message.remove());
  if(!t.messages.length && !target.querySelector('.assistant-welcome'))target.insertAdjacentHTML('beforeend',welcomeHtml());
  if(t.messages.length){
    target.querySelector('.assistant-welcome')?.remove();
    for(const message of t.messages){
      const existing=target.querySelector('[data-message-id="'+message.id+'"]');
      if(!existing){target.insertAdjacentHTML('beforeend',messageHtml(message));added=true;}
      else if(existing.querySelector('.assistant-message-text').textContent!==message.text)existing.querySelector('.assistant-message-text').textContent=message.text;
    }
  }
  document.querySelector('#assistant-response-status').textContent=t.busy?(/\b(?:public|market|news|research|sanctions?|compliance|regulatory)\b/i.test(t.retryMessage)?'Checking the requested public sources...':/\b(?:company|business) profile\b/i.test(t.retryMessage)?'Analyzing your company profile and permitted activity...':'Looking at your account information...'):'';
  document.querySelector('#assistant-error').innerHTML=t.error?esc(t.error)+(t.retryMessage?' <button type="button" class="text-button" data-action="assistant-retry">Try again</button>':''):'';
  document.querySelector('#assistant-suggestions').innerHTML=suggestionHtml();
  const form=document.querySelector('#assistant-form');
  form.setAttribute('aria-busy',String(t.busy)); form.querySelector('button[type="submit"]').disabled=t.busy;
  hydrateDashboardCharts(target);
  if(added && atBottom){
    const latest=t.messages.at(-1),message=target.querySelector('[data-message-id="'+latest?.id+'"]');
    if((latest?.dashboard || latest?.paymentReadiness || latest?.newsInsights) && message)target.scrollTop+=message.getBoundingClientRect().top-target.getBoundingClientRect().top-12;
    else target.scrollTop=target.scrollHeight;
  }
}
export function cancelAssistant() { stopAssistantResize(); cancelFinanceReports(); cancelAssistantDashboards(); generation++; controller?.abort(); if(state.assistant)state.assistant.busy=false; }
export function clearAssistant() {
  const {open=false,windowSize,expanded}=state.assistant||{};cancelAssistant();state.assistant=null;Object.assign(thread(),{open,windowSize,expanded});
  const input=document.querySelector('#assistant-message');if(input)input.value='';
  renderAssistant();if(open)input?.focus();
}
export async function sendAssistant(message,{retry=false}={}) {
  const t=thread();
  if(t.busy || !state.user || state.signingOut)return;
  const text=String(message ?? '').trim();
  if(!text)return;
  if(text.length>1000){t.retryMessage='';t.error='Keep your message to 1,000 characters or fewer.';renderThread();return;}
  // Never collect a current password or an authorization field through chat.
  if(/\b(password|passcode|otp|pin|cvv|secret|api[ -]?key|access[ -]?token)\b|\b[A-Za-z]{5,40}123!|\bsk-[A-Za-z0-9_-]{8,}/i.test(credentialText(text)) && !SAFE_SECURITY_HELP.test(text)) {
    t.input='';const input=document.querySelector('#assistant-message');if(input)input.value='';
    t.retryMessage='';t.error='Please keep passwords and security codes out of chat. Enter your password only in the payment review form.';renderThread();return;
  }
  if(t.dashboardSelectionPending){t.retryMessage='';t.error='Wait for the selected dashboard to finish loading before sending your message.';renderThread();return;}
  const request=++generation,userId=state.user.id,selectionVersion=t.dashboardSelectionVersion||0;
  const evidenceDisplay=requestedEvidenceDisplay(text);
  if(evidenceDisplay!==undefined)t.evidenceExpanded=evidenceDisplay;
  controller?.abort(); controller=new AbortController();
  if(!retry)t.messages.push({id:++nextMessageId,role:'user',text,createdAt:new Date().toISOString()});
  t.busy=true;t.error='';t.retryMessage=text;
  if(!retry){t.input='';const input=document.querySelector('#assistant-message');if(input)input.value='';}
  renderThread();
  try {
    const result=await api('/agents/assistant',{message:text,...(t.previousRunId?{previousRunId:t.previousRunId}:{}),...(t.activeDashboardDefinition?{dashboardDefinition:t.activeDashboardDefinition}:{})},'POST',{signal:controller.signal,timeoutMs:90000});
    if(request!==generation || state.assistant!==t || !state.user || state.signingOut || !sameId(state.user.id,userId))return;
    if(result.sensitiveInput){const submitted=[...t.messages].reverse().find(message=>message.role==='user');if(submitted)submitted.text='[Sensitive message removed]';}
    t.previousRunId=result.runId || null;
    if((t.dashboardSelectionVersion||0)===selectionVersion){if(result.companyDashboard)t.activeDashboardDefinition=result.companyDashboard.definition||null;t.dashboardSelectionVersion=selectionVersion+1;t.dashboardSelectionPending=false;}
    t.messages.push({id:++nextMessageId,role:'assistant',createdAt:new Date().toISOString(),auditRunId:result.runId,evidenceReferences:Array.isArray(result.evidenceReferences)?result.evidenceReferences:[],evidenceExpanded:t.evidenceExpanded===true,publicResearch:result.publicResearch||null,newsInsights:result.newsInsights||null,counterpartyScan:result.counterpartyScan||null,counterpartyRisk:result.counterpartyRisk||null,paymentReadiness:result.paymentReadiness||null,financeReport:result.financeReport||null,fundingWarnings:Array.isArray(result.fundingWarnings)?result.fundingWarnings:[],dashboard:result.companyDashboard || null,savedDashboards:Array.isArray(result.savedDashboards)?result.savedDashboards:null,text:String(result.reply || 'Please choose one of the suggested banking tasks.').replace(/[ \t]*\[E\d+\]/g,'').trim(),items:[...(Array.isArray(result.items)?result.items:[]),...(result.engine && !result.companyDashboard && !Array.isArray(result.savedDashboards)?[{title:result.engine==='openai'?'OpenAI assistant':'Historical AI assistant',subtitle:result.answerContext==='general_banking'?'General banking explanation; no account records checked.':result.clarification?'Help only; no banking records retrieved.':(result.steps || []).map(s=>s.tool.replace(/_/g,' ')).join(' > ')}]:[])],actions:Array.isArray(result.actions)?result.actions.filter(action=>['navigate','draft_transfer','draft_payment','draft_schedule'].includes(action.type)):[],suggestions:Array.isArray(result.suggestions)?result.suggestions.filter(value=>typeof value==='string'):[]});
    t.retryMessage='';
    if(!t.open)t.unread=true;
  } catch(error) {
    if(request!==generation || error.status===-1 || state.assistant!==t || !state.user || state.signingOut || !sameId(state.user.id,userId))return;
    if(await recoverSession(error))return;
    if(error.code==='ASSISTANT_CONTEXT_EXPIRED'){
      t.previousRunId=null;
      t.error='This conversation expired. Try again to start a fresh request; previous draft details will not be reused.';
    }else t.error=error.message;
  } finally {
    if(request===generation && state.assistant===t){t.busy=false;renderAssistant();}
  }
}
export function rememberAssistantInput(value) { thread().input=String(value); }
export function retryAssistant() { const t=thread(); if(t.retryMessage)return sendAssistant(t.retryMessage,{retry:true}); }
function safeDraft(raw,type) {
  const source=raw && typeof raw==='object'?raw:{};
  const result={};
  const fields=type==='transfer'?['fromAccountId','toAccountNumber','amount','description']:type==='payment'?['fromAccountId','billerId','reference','amount']:['type','fromAccountId','toAccountNumber','billerId','reference','amount','description','scheduledAt','frequency'];
  for(const key of fields)if(['string','number'].includes(typeof source[key]))result[key]=String(source[key]);
  if(result.fromAccountId && !state.data.accounts.some(a=>sameId(a.id,result.fromAccountId)))delete result.fromAccountId;
  if(result.description)result.description=result.description.slice(0,100);
  if(result.reference)result.reference=result.reference.slice(0,64);
  if(result.billerId && !state.data.billers.some(b=>sameId(b.id,result.billerId)))delete result.billerId;
  return result;
}
export function assistantAction(reference) {
  if(!state.user || state.signingOut)return;
  const [messageId,index]=String(reference).split(':'),message=thread().messages.find(m=>String(m.id)===messageId),action=message?.actions?.[Number(index)];
  if(!action)return;
  applyBankingAction(action);
}
export function applyBankingAction(action) {
  if(!state.user || state.signingOut)return;
  if(action.type==='navigate') {
    const aliases={dashboard:'overview',transactions:'activity','scheduled-payments':'schedules','bill-payments':'payments','fraud-monitoring':'fraud','fraud-rules':'rules'};
    const page=aliases[action.page] || action.page;
    if(page==='activity' && action.filters){
      const f=action.filters;state.filters={...emptyFilters(),search:typeof f.q==='string'?f.q.slice(0,120):'',from:/^\d{4}-\d{2}-\d{2}$/.test(f.from||'')?f.from:'',to:/^\d{4}-\d{2}-\d{2}$/.test(f.to||'')?f.to:'',account:allAccounts().some(a=>sameId(a.id,f.accountId))?String(f.accountId):'',status:['completed','pending_review','rejected'].includes(f.status)?f.status:'',type:['transfer','bill','incoming','outgoing'].includes(f.type)?f.type:''};state.historyPage=1;
    }
    if(pages[page]){
      closeAssistant({focus:false});navigate(page,{account:page==='activity'?state.filters.account:''});
    }
    return;
  }
  if(action.type==='draft_transfer') {
    const draft=safeDraft(action.draft,'transfer');
    const own=state.data.accounts.some(a=>a.number===draft.toAccountNumber);
    state.moneyDraft.transfers={...draft,recipientType:own?'own':'other'};closeAssistant({focus:false});navigate('transfers');
  } else if(action.type==='draft_payment') { state.moneyDraft.payments=safeDraft(action.draft,'payment');closeAssistant({focus:false});navigate('payments'); }
  else if(action.type==='draft_schedule'){closeAssistant({focus:false});navigate('schedules');openScheduleDraft(safeDraft(action.draft,'schedule'));}
  else return;
  toast('Draft ready. Review the details before authorizing in the banking form.');
}
