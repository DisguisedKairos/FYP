// Raw messages stay in browser memory. Reports, tool evidence and draft context
// are retained privately; financial actions only open the ordinary banking forms.
import { app, state, ui, api, esc, icon, money, sameId, pages, emptyFilters, statusLabel, shortDate, navigate, toast, recoverSession } from './core.js';
import { heading } from './views.js';
import { openScheduleDraft } from './services.js';
let controller,generation=0,nextMessageId=0;
const starters=['What is my balance?','Show my recent transactions','What payments are scheduled?','Help me transfer money'];
function thread() { return state.assistant || (state.assistant={messages:[],input:'',busy:false,error:'',retryMessage:'',previousRunId:null,engine:''}); }
function itemContent(item) {
  if(typeof item==='string')return '<li>'+esc(item)+'</li>';
  if(!item || typeof item!=='object')return '';
  const label=item.label || item.title || item.name || item.description || '';
  const value=item.value ?? (typeof item.balanceCents==='number' ? money(item.balanceCents) : typeof item.amountCents==='number' ? money(item.amountCents) : '');
  const detail=[item.detail || item.subtitle || item.meta || '',item.accountNumber || '',item.status ? statusLabel(item.status) : '',item.date ? shortDate(item.date)+' SGT' : '',typeof item.score==='number'?'Risk score '+item.score:''].filter(Boolean).join(' · ');
  return '<li><div><strong>'+esc(label)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+(Array.isArray(item.reasons)?'<ul>'+item.reasons.map(reason=>'<li>'+esc(reason)+'</li>').join('')+'</ul>':'')+'</div>'+(value!==''?'<span>'+esc(value)+'</span>':'')+'</li>';
}
function messageHtml(message) {
  return '<article data-message-id="'+message.id+'" class="assistant-message '+(message.role==='user'?'from-user':'from-assistant')+'" aria-label="'+(message.role==='user'?'You':'GLDB Assistant')+'"><div class="assistant-message-author">'+(message.role==='user'?'You':icon('chat')+' GLDB Assistant')+'</div><div class="assistant-message-text">'+esc(message.text)+'</div>'+(message.items?.length?'<ul class="assistant-items">'+message.items.map(itemContent).join('')+'</ul>':'')+(message.actions?.length?'<div class="assistant-actions">'+message.actions.map((action,index)=>'<button type="button" class="button secondary" data-assistant-action="'+message.id+':'+index+'">'+esc(action.label || 'Open banking form')+' '+icon('arrow')+'</button>').join('')+'</div>':'')+'</article>';
}
function suggestionHtml() {
  const messages=thread().messages;
  const last=[...messages].reverse().find(message=>message.role==='assistant');
  const suggestions=last?.suggestions?.length?last.suggestions:messages.length?[]:starters;
  return suggestions.slice(0,4).map(text=>'<button type="button" class="assistant-suggestion" data-assistant-suggestion="'+esc(text)+'">'+esc(text)+'</button>').join('');
}
function baseAssistantPage() {
  const t=thread();
  return heading('Your business banking assistant.', 'Ask about your accounts, find a payment or prepare a draft.', '<button type="button" class="button secondary" data-action="assistant-clear">'+icon('close')+'<span>Clear conversation</span></button>')+'<section class="panel assistant-panel" aria-labelledby="assistant-title"><div class="assistant-panel-heading"><span class="quick-action-icon">'+icon('chat')+'</span><div><h2 id="assistant-title">GLDB Assistant</h2><p>Uses only your signed-in accounts. Payments always require your review and password.</p></div><span class="tag">Private</span></div><div id="assistant-thread" class="assistant-thread" role="log" aria-label="Conversation with GLDB Assistant" aria-live="polite" aria-relevant="additions text">'+(t.messages.length?t.messages.map(messageHtml).join(''):'<div class="assistant-welcome">'+icon('chat')+'<h3>What would you like to take care of?</h3><p>I can explain balances, find activity and help prepare payment drafts. You stay in control of every payment.</p></div>')+'</div><div id="assistant-response-status" class="assistant-response-status" role="status">'+(t.busy?'Looking at your account information…':'')+'</div><div id="assistant-error" class="error-message assistant-error" role="alert">'+(t.error?esc(t.error)+' <button type="button" class="text-button" data-action="assistant-retry">Try again</button>':'')+'</div><div id="assistant-suggestions" class="assistant-suggestions">'+suggestionHtml()+'</div><form id="assistant-form" class="assistant-form" aria-busy="'+t.busy+'"><label for="assistant-message">Your message</label><div class="assistant-composer"><textarea id="assistant-message" name="message" rows="2" maxlength="1000" required placeholder="Ask about your balance, recent activity or a payment…" aria-describedby="assistant-privacy">'+esc(t.input)+'</textarea><button type="submit" class="button" aria-label="Send message" '+(t.busy?'disabled':'')+'>Send '+icon('arrow')+'</button></div><small id="assistant-privacy">Never send passwords in chat. Drafts open a banking form; chat does not authorize or send money.</small></form></section>';
}
export function assistantPage() {
  const t=thread();
  const modes='<div class="assistant-mode"><label for="assistant-engine">Assistant mode</label><select id="assistant-engine" '+(t.busy?'disabled':'')+'><option value="" '+(!t.engine?'selected':'')+'>Configured default</option><option value="workflow" '+(t.engine==='workflow'?'selected':'')+'>Offline evidence workflow</option><option value="ollama" '+(t.engine==='ollama'?'selected':'')+'>Local Ollama agent</option></select><small>Raw chat stays in browser memory. Reports and tool evidence are saved privately.</small></div>';
  return baseAssistantPage().replace('<section class="panel assistant-panel"',modes+'<section class="panel assistant-panel"');
}
export function setAssistantEngine(value) { if(!thread().busy && ['','workflow','ollama'].includes(value))thread().engine=value; }
function renderThread() {
  if(state.route.page!=='assistant')return;
  const target=document.querySelector('#assistant-thread');
  if(!target)return;
  const t=thread();
  if(t.messages.length){
    target.querySelector('.assistant-welcome')?.remove();
    for(const message of t.messages){
      const existing=target.querySelector('[data-message-id="'+message.id+'"]');
      if(!existing)target.insertAdjacentHTML('beforeend',messageHtml(message));
      else if(existing.querySelector('.assistant-message-text').textContent!==message.text)existing.querySelector('.assistant-message-text').textContent=message.text;
    }
  }
  document.querySelector('#assistant-response-status').textContent=t.busy?'Looking at your account information…':'';
  document.querySelector('#assistant-error').innerHTML=t.error?esc(t.error)+' <button type="button" class="text-button" data-action="assistant-retry">Try again</button>':'';
  document.querySelector('#assistant-suggestions').innerHTML=suggestionHtml();
  const form=document.querySelector('#assistant-form');
  form.setAttribute('aria-busy',String(t.busy)); form.querySelector('button[type="submit"]').disabled=t.busy;
  target.scrollTop=target.scrollHeight;
}
export function cancelAssistant() { generation++; controller?.abort(); if(state.assistant)state.assistant.busy=false; }
export function clearAssistant() {
  cancelAssistant(); state.assistant=null;
  if(state.route.page==='assistant'){ ui.render(); document.querySelector('#assistant-message')?.focus(); }
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
    const result=await api('/agents/assistant',{message:text,...(t.previousRunId?{previousRunId:t.previousRunId}:{}),...(t.engine?{engine:t.engine}:{})},'POST',{signal:controller.signal,timeoutMs:90000});
    if(request!==generation || state.assistant!==t || !state.user || state.signingOut || !sameId(state.user.id,userId))return;
    if(result.sensitiveInput){const submitted=[...t.messages].reverse().find(message=>message.role==='user');if(submitted)submitted.text='[Sensitive message removed]';}
    t.previousRunId=result.runId || null;
    t.messages.push({id:++nextMessageId,role:'assistant',text:result.reply || 'Please choose one of the suggested banking tasks.',items:[...(Array.isArray(result.items)?result.items:[]),...(result.engine?[{title:result.engine==='ollama'?'Local Ollama agent':'Offline evidence workflow',subtitle:(result.steps || []).map(s=>s.tool.replace(/_/g,' ')).join(' > ')}]:[])],actions:Array.isArray(result.actions)?result.actions.filter(action=>['navigate','draft_transfer','draft_payment','draft_schedule'].includes(action.type)):[],suggestions:Array.isArray(result.suggestions)?result.suggestions.filter(value=>typeof value==='string'):[]});
    t.retryMessage='';
  } catch(error) {
    if(request!==generation || error.status===-1 || state.assistant!==t || !state.user || state.signingOut || !sameId(state.user.id,userId))return;
    if(await recoverSession(error))return;
    t.error=error.message;
  } finally {
    if(request===generation && state.assistant===t){t.busy=false;renderThread();}
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
    if(pages[page])navigate(page);
    return;
  }
  if(action.type==='draft_transfer') {
    const draft=safeDraft(action.draft,'transfer');
    const own=state.data.accounts.some(a=>a.number===draft.toAccountNumber);
    state.moneyDraft.transfers={...draft,recipientType:own?'own':'other'};navigate('transfers');
  } else if(action.type==='draft_payment') { state.moneyDraft.payments=safeDraft(action.draft,'payment');navigate('payments'); }
  else if(action.type==='draft_schedule'){navigate('schedules');openScheduleDraft(safeDraft(action.draft,'schedule'));}
  else return;
  toast('Draft ready. Review the details before authorizing in the banking form.');
}
