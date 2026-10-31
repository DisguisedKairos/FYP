// Raw messages stay in browser memory. Reports, tool evidence and draft context
// are retained privately; financial actions only open the ordinary banking forms.
import { state, api, esc, icon, money, sameId, pages, emptyFilters, statusLabel, shortDate, navigate, toast, recoverSession } from './core.js';
import { openScheduleDraft } from './services.js';
let controller,generation=0,nextMessageId=0;
let requestedOpen=new URLSearchParams(location.search).get('chat')==='open';
const starters=['What is my balance?','Show my recent transactions','Check my transactions for fraud using daily market trends','Help me transfer money'];
function thread() { return state.assistant || (state.assistant={messages:[],input:'',busy:false,error:'',retryMessage:'',previousRunId:null,open:false,unread:false}); }
function itemContent(item) {
  if(typeof item==='string')return '<li>'+esc(item)+'</li>';
  if(!item || typeof item!=='object')return '';
  const label=item.label || item.title || item.name || item.description || '';
  const value=item.value ?? (typeof item.balanceCents==='number' ? money(item.balanceCents) : typeof item.amountCents==='number' ? money(item.amountCents) : '');
  const detail=[item.detail || item.subtitle || item.meta || '',item.accountNumber || '',item.status ? statusLabel(item.status) : '',item.date ? shortDate(item.date)+' SGT' : '',typeof item.score==='number'?'Risk score '+item.score:''].filter(Boolean).join(' · ');
  return '<li><div><strong>'+esc(label)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+(Array.isArray(item.reasons)?'<ul>'+item.reasons.map(reason=>'<li>'+esc(reason)+'</li>').join('')+'</ul>':'')+'</div>'+(value!==''?'<span>'+esc(value)+'</span>':'')+'</li>';
}
function messageHtml(message) {
  return '<article data-message-id="'+message.id+'" class="assistant-message '+(message.role==='user'?'from-user':'from-assistant')+'" aria-label="'+(message.role==='user'?'You':'GLDB Assistant')+'"><div class="assistant-message-author">'+(message.role==='user'?'You':icon('chat')+' GLDB Assistant')+'</div><div class="assistant-message-text">'+esc(message.text)+'</div>'+(message.items?.length?'<ul class="assistant-items">'+message.items.map(itemContent).join('')+'</ul>':'')+(message.actions?.length?'<div class="assistant-actions">'+message.actions.map((action,index)=>'<button type="button" class="button secondary" data-assistant-action="'+message.id+':'+index+'">'+esc(action.label || 'Open banking form')+' '+icon('arrow')+'</button>').join('')+'</div>':'')+(message.auditRunId && state.user?.role==='admin'?'<button type="button" class="text-button" data-ai-audit-kind="agent" data-ai-audit-id="'+esc(message.auditRunId)+'">View AI audit</button>':'')+'</article>';
}
function suggestionHtml() {
  const messages=thread().messages;
  const last=[...messages].reverse().find(message=>message.role==='assistant');
  const suggestions=last?.suggestions?.length?last.suggestions:messages.length?[]:starters;
  return suggestions.slice(0,4).map(text=>'<button type="button" class="assistant-suggestion" data-assistant-suggestion="'+esc(text)+'">'+esc(text)+'</button>').join('');
}
function welcomeHtml() {
  return '<div class="assistant-welcome">'+icon('chat')+'<h3>How can I help your business?</h3><p>Check balances, summarize company activity, save dashboards or prepare a payment draft. You stay in control of every payment.</p></div>';
}
function popupContent() {
  const t=thread();
  return '<header class="assistant-panel-heading"><span class="quick-action-icon">'+icon('chat')+'</span><div><h2 id="assistant-title">GLDB Assistant</h2><p>Your business banking assistant</p></div><div class="assistant-window-actions"><button type="button" class="text-button" data-action="assistant-clear" aria-label="Clear conversation">Clear</button><button type="button" class="icon-button" data-action="assistant-close" aria-label="Minimize GLDB Assistant">'+icon('close')+'</button></div></header><p class="assistant-disclosure">Uses OpenAI. Your message and permitted banking evidence are sent for analysis. Never share passwords or security codes.</p><div id="assistant-thread" class="assistant-thread" role="log" aria-label="Conversation with GLDB Assistant" aria-live="polite" aria-relevant="additions text">'+(t.messages.length?t.messages.map(messageHtml).join(''):welcomeHtml())+'</div><div id="assistant-response-status" class="assistant-response-status" role="status"></div><div id="assistant-error" class="error-message assistant-error" role="alert"></div><div id="assistant-suggestions" class="assistant-suggestions">'+suggestionHtml()+'</div><form id="assistant-form" class="assistant-form" aria-busy="'+t.busy+'"><label for="assistant-message">Your message</label><div class="assistant-composer"><textarea id="assistant-message" name="message" rows="2" maxlength="1000" required placeholder="How can I help?" aria-describedby="assistant-privacy">'+esc(t.input)+'</textarea><button type="submit" class="button" aria-label="Send message" '+(t.busy?'disabled':'')+'>Send '+icon('arrow')+'</button></div><small id="assistant-privacy">Drafts need your review and password in the banking form. Chat never sends money.</small></form>';
}
export function renderAssistant() {
  const root=document.querySelector('#assistant-root');
  if(!root)return;
  if(!state.user || !state.data || state.signingOut){root.replaceChildren();return;}
  const t=thread();
  if(requestedOpen){
    t.open=true;requestedOpen=false;
    const url=new URL(location.href);url.searchParams.delete('chat');history.replaceState({},'',url.pathname+url.search+url.hash);
  }
  if(!root.querySelector('#assistant-popup'))root.innerHTML='<button type="button" class="assistant-launcher" data-action="assistant-toggle" aria-label="Open GLDB Assistant" aria-controls="assistant-popup" aria-expanded="false">'+icon('chat')+'<span>Ask GLDB</span><span class="assistant-unread" hidden>New reply</span></button><section id="assistant-popup" class="assistant-popup" role="dialog" aria-modal="false" aria-labelledby="assistant-title" hidden></section>';
  root.classList.toggle('assistant-open',t.open);
  const popup=root.querySelector('#assistant-popup');popup.hidden=!t.open;
  if(t.open && !popup.querySelector('#assistant-form'))popup.innerHTML=popupContent();
  else if(!t.open)popup.replaceChildren();
  const launcher=root.querySelector('.assistant-launcher');
  launcher.setAttribute('aria-expanded',String(t.open));
  launcher.setAttribute('aria-label',t.open?'Minimize GLDB Assistant':'Open GLDB Assistant'+(t.unread?', new reply':''));
  launcher.querySelector('.assistant-unread').hidden=!t.unread;
  renderThread();
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
  state.assistant.open=false;renderAssistant();
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
  if(!t.messages.length)target.innerHTML=welcomeHtml();
  if(t.messages.length){
    target.querySelector('.assistant-welcome')?.remove();
    for(const message of t.messages){
      const existing=target.querySelector('[data-message-id="'+message.id+'"]');
      if(!existing){target.insertAdjacentHTML('beforeend',messageHtml(message));added=true;}
      else if(existing.querySelector('.assistant-message-text').textContent!==message.text)existing.querySelector('.assistant-message-text').textContent=message.text;
    }
  }
  document.querySelector('#assistant-response-status').textContent=t.busy?'Looking at your account information…':'';
  document.querySelector('#assistant-error').innerHTML=t.error?esc(t.error)+' <button type="button" class="text-button" data-action="assistant-retry">Try again</button>':'';
  document.querySelector('#assistant-suggestions').innerHTML=suggestionHtml();
  const form=document.querySelector('#assistant-form');
  form.setAttribute('aria-busy',String(t.busy)); form.querySelector('button[type="submit"]').disabled=t.busy;
  if(added && atBottom)target.scrollTop=target.scrollHeight;
}
export function cancelAssistant() { generation++; controller?.abort(); if(state.assistant)state.assistant.busy=false; }
export function clearAssistant() {
  const open=Boolean(state.assistant?.open);cancelAssistant();state.assistant=null;thread().open=open;
  const input=document.querySelector('#assistant-message');if(input)input.value='';
  renderAssistant();if(open)input?.focus();
}
export async function sendAssistant(message,{retry=false}={}) {
  const t=thread();
  if(t.busy || !state.user || state.signingOut)return;
  const text=String(message ?? '').trim();
  if(!text)return;
  if(text.length>1000){t.error='Keep your message to 1,000 characters or fewer.';renderThread();return;}
  // Never collect a current password or an authorization field through chat.
  if(/\b(password|passcode|otp|pin|cvv|secret|api[ -]?key|access[ -]?token)\b|\b[A-Za-z]{5,40}123!|\bsk-[A-Za-z0-9_-]{8,}/i.test(text)) {
    t.input='';const input=document.querySelector('#assistant-message');if(input)input.value='';
    t.error='Please keep passwords and security codes out of chat. Enter your password only in the payment review form.';renderThread();return;
  }
  const request=++generation,userId=state.user.id;
  controller?.abort(); controller=new AbortController();
  if(!retry)t.messages.push({id:++nextMessageId,role:'user',text});
  t.busy=true;t.error='';t.retryMessage=text;t.input='';
  const input=document.querySelector('#assistant-message');if(input)input.value='';
  renderThread();
  try {
    const result=await api('/agents/assistant',{message:text,...(t.previousRunId?{previousRunId:t.previousRunId}:{})},'POST',{signal:controller.signal,timeoutMs:90000});
    if(request!==generation || state.assistant!==t || !state.user || state.signingOut || !sameId(state.user.id,userId))return;
    if(result.sensitiveInput){const submitted=[...t.messages].reverse().find(message=>message.role==='user');if(submitted)submitted.text='[Sensitive message removed]';}
    t.previousRunId=result.runId || null;
    t.messages.push({id:++nextMessageId,role:'assistant',auditRunId:result.runId,text:String(result.reply || 'Please choose one of the suggested banking tasks.').replace(/[ \t]*\[E\d+\]/g,'').trim(),items:[...(Array.isArray(result.items)?result.items:[]),...(result.engine?[{title:result.engine==='openai'?'OpenAI assistant':'Historical AI assistant',subtitle:result.clarification?'Help only; no banking records retrieved.':(result.steps || []).map(s=>s.tool.replace(/_/g,' ')).join(' > ')}]:[])],actions:Array.isArray(result.actions)?result.actions.filter(action=>['navigate','draft_transfer','draft_payment','draft_schedule'].includes(action.type)):[],suggestions:Array.isArray(result.suggestions)?result.suggestions.filter(value=>typeof value==='string'):[]});
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
    if(page==='activity' && typeof action.filters?.q==='string'){state.filters={...emptyFilters(),search:action.filters.q.slice(0,120)};state.historyPage=1;}
    if(pages[page]){
      const filters=page==='companyActivity'?Object.fromEntries(['company','scope','savedView','from','to'].map(key=>[key,typeof action.filters?.[key]==='string'?action.filters[key].slice(0,key==='company'?120:key==='savedView'?36:10):''])):{};
      closeAssistant({focus:false});navigate(page,filters);
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
