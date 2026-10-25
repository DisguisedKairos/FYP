import { state, ui, api, esc, icon, money, fullDate, sameId, recoverSession, navigate, modal } from './core.js';
import { heading } from './views.js';
import { applyBankingAction } from './assistant.js';

let generation=0,detailGeneration=0;
function workspace(){return state.agentWorkspace || (state.agentWorkspace={busy:false,error:'',run:null});}
const submit=(text)=>'<div class="error-message" role="alert"></div><button class="button" type="submit" '+(workspace().busy?'disabled':'')+'>'+text+' '+icon('arrow')+'</button>';
const list=items=>'<ul class="agent-findings">'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
function reportHtml(run){
  if(!run?.report)return '';
  const r=run.report;
  let body='';
  if(run.kind==='liquidity')body='<div class="agent-metrics"><div><span>Available now</span><strong>'+money(r.totalBalanceCents)+'</strong></div><div><span>Projected total</span><strong>'+money(r.projectedTotalCents)+'</strong></div><div><span>Accounts with shortfalls</span><strong>'+r.shortfalls.length+'</strong></div></div><div class="table-scroll"><table><thead><tr><th>Account</th><th>Now</th><th>Projected</th><th>Lowest projected</th></tr></thead><tbody>'+r.accounts.map(a=>'<tr><th scope="row">'+esc(a.name)+'</th><td>'+money(a.balanceCents)+'</td><td>'+money(a.projectedCents)+'</td><td>'+money(a.minimumProjectedCents)+'</td></tr>').join('')+'</tbody></table></div>'+list(r.shortfalls.map(s=>s.name+': shortfall '+money(s.shortageCents)+' at '+fullDate(s.dueAt)))+list(r.assumptions)+'<details><summary>'+r.occurrences.length+' projected scheduled occurrences</summary><pre class="metadata-json">'+esc(JSON.stringify(r.occurrences,null,2))+'</pre></details>';
  if(run.kind==='fraud_investigation')body='<dl class="review-list"><div><dt>Business</dt><dd>'+esc(r.transaction.business)+'</dd></div><div><dt>Payment</dt><dd>'+money(r.transaction.amountCents)+'</dd></div><div><dt>Model score (out of 100)</dt><dd>'+esc(r.assessment.modelScore ?? 'Unavailable')+'</dd></div><div><dt>Combined score (out of 100)</dt><dd>'+esc(r.assessment.combinedScore ?? 'Unavailable')+'</dd></div><div><dt>Previous completed outgoing payments</dt><dd>'+r.history.priorCompletedOutgoing+'</dd></div><div><dt>Previous average</dt><dd>'+money(r.history.averageCents)+'</dd></div></dl>'+list(r.findings)+list(r.nextSteps)+list(r.limitations);
  if(run.kind==='rule_simulation')body='<p>'+esc(r.interpretation)+'</p><div class="table-scroll"><table><thead><tr><th>Decision</th><th>Current rules</th><th>Proposed rules</th></tr></thead><tbody>'+['allow','review','block'].map(k=>'<tr><th scope="row">'+k+'</th><td>'+r.before[k]+'</td><td>'+r.after[k]+'</td></tr>').join('')+'</tbody></table></div><p>'+r.assessed+' assessed; '+r.skipped+' unavailable or retired model results; '+r.changed+' changed decisions.'+(r.truncated?' Sample limited to 1,000.':'')+'</p>'+list(r.limitations);
  if(run.kind==='reconciliation')body='<div class="agent-metrics"><div><span>Accounts checked</span><strong>'+r.accountsChecked+'</strong></div><div><span>Balance discrepancies</span><strong>'+r.discrepancies.length+'</strong></div><div><span>Schedule exceptions</span><strong>'+r.failedSchedules.length+'</strong></div></div>'+list(r.findings)+list(r.failedSchedules.map(s=>s.id+': '+s.reason))+list(r.nextSteps);
  if(run.kind==='assistant')body='<p class="assistant-message-text">'+esc(r.reply)+'</p>';
  if(r.interpretation && run.engine==='ollama' && run.kind!=='rule_simulation')body+='<h3>Local AI interpretation</h3><p class="assistant-message-text">'+esc(r.interpretation)+'</p>';
  const actions=(r.actions || []).map((a,i)=>'<button class="button secondary" type="button" data-agent-draft="'+i+'">'+esc(a.label)+'</button>').join('');
  return '<section class="panel agent-report" data-agent-report><div class="section-heading"><h2>'+esc(r.title)+'</h2><span class="tag">'+(run.engine==='ollama'?'Local AI + evidence':'Archived non-model report')+'</span></div><p>'+fullDate(run.completedAt)+' SGT</p>'+body+'<div class="assistant-actions">'+actions+'</div>'+(r.evidenceReferences?.length?'<h3>Interpretation evidence</h3>'+list(r.evidenceReferences.map(e=>'['+e.id+'] '+e.label+' (tool step '+e.step+')')):'')+(r.evidence?.length?'<h3>Evidence references</h3>'+list(r.evidence.map(e=>e.label+': '+e.id)):'')+'<details><summary>Tool activity and complete report</summary><pre class="metadata-json">'+esc(JSON.stringify({runId:run.id,report:r,steps:run.steps},null,2))+'</pre></details><button type="button" class="text-button" data-ai-audit-kind="agent" data-ai-audit-id="'+esc(run.id)+'">View AI audit</button></section>';
}
export function agentsPage(){
  const w=workspace(), data=state.remote.agents?.data, staff=state.user?.role==='admin';
  const model=data?.agent;
  const notice=model?.available?'Local model ready: '+model.model+'. Reports and prompts stay on this computer.':'Local model unavailable. Start Ollama with the configured model to run AI analysis.';
  const rules=data?.rules?.rules || [], selected=rules.find(r=>r.id==='high_value') || rules[0];
  return heading('Evidence for your next decision.','Investigate payments, plan business liquidity and inspect financial exceptions.','')+'<div class="notice" role="status" data-agent-status>'+esc(notice)+' Reports are saved privately to your signed-in account.</div>'+'<div class="agent-layout"><div class="agent-tools">'+
    (state.data.accounts.length?'<section class="panel service-form"><h2>Liquidity planning</h2><p>Project scheduled outflows and review suggested transfers between your accounts.</p><form id="agent-liquidity-form" data-agent-kind="liquidity"><div class="field"><label for="agent-days">Projection horizon (days)</label><input id="agent-days" name="days" type="number" min="1" max="90" value="30" required></div>'+submit('Project balances')+'</form></section>':'')+
    '<section class="panel service-form"><h2>Reconciliation investigator</h2><p>'+(staff?'Inspect bank-wide balance, schedule and notification exceptions.':'Inspect your business balances and payment exceptions.')+'</p><form id="agent-reconciliation-form" data-agent-kind="reconciliation">'+submit('Investigate exceptions')+'</form></section>'+
    (staff?'<section class="panel service-form"><h2>Fraud investigation</h2><p>Gather a payment\'s recorded risk evidence and historical comparison.</p><form id="agent-fraud-form" data-agent-kind="fraud_investigation"><div class="field"><label for="agent-transaction">Outgoing transaction ID</label><input id="agent-transaction" name="transactionId" maxlength="150" list="agent-review-options" required><datalist id="agent-review-options">'+(data?.reviews || []).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.description)+'</option>').join('')+'</datalist></div>'+submit('Investigate payment')+'</form></section><section class="panel service-form"><h2>Local AI rule impact analysis</h2><p>Compare historical decisions before proposing a live policy change.</p><form id="agent-simulation-form" data-agent-kind="rule_simulation"><div class="field"><label for="agent-rule">Rule</label><select id="agent-rule" name="ruleId">'+rules.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===selected?.id?'selected':'')+'>'+esc(r.name)+' ('+esc(r.unit)+')</option>').join('')+'</select></div><div class="field"><label for="agent-threshold">Proposed threshold</label><input id="agent-threshold" name="threshold" type="number" min="0.01" step="0.01" value="'+esc(selected?.threshold || 10000)+'" required></div><div class="field"><label for="agent-rule-action">Proposed action</label><select id="agent-rule-action" name="action"><option value="review" '+(selected?.action==='review'?'selected':'')+'>Hold for review</option><option value="block" '+(selected?.action==='block'?'selected':'')+'>Block</option></select></div><label class="checkbox-field"><input type="checkbox" name="enabled" '+(selected?.enabled?'checked':'')+'>Proposed enabled status</label><div class="field"><label for="agent-lookback">Historical window (days)</label><input id="agent-lookback" name="days" type="number" min="1" max="90" value="30" required></div>'+submit('Preview rule impact')+'</form></section>':'')+
    '</div><div class="agent-results"><div class="error-message" role="alert">'+esc(w.error)+'</div>'+(w.busy?'<section class="panel loading-state" role="status"><p>Gathering evidence. Local model analysis can take up to one minute.</p></section>':reportHtml(w.run) || '<section class="panel empty-state"><h2>Start an investigation.</h2><p>Choose a tool to generate an evidence report. Financial changes use the normal banking forms.</p></section>')+'<section class="panel service-form"><div class="section-heading"><h2>Your recent investigations</h2><button type="button" class="text-button" data-action="agents-refresh">Refresh</button></div>'+(data?.runs?.length?'<ul class="agent-run-list">'+data.runs.map(r=>'<li><button type="button" class="text-button" data-agent-run="'+esc(r.id)+'">'+esc(r.title)+'</button><small>'+esc(r.status)+' / '+esc(r.engine)+' / '+fullDate(r.createdAt)+'</small></li>').join('')+'</ul>':'<p>No saved investigations yet.</p>')+'</section></div></div>';
}
export async function loadAgents(){
  const token=++generation,userId=state.user?.id;if(!userId || state.signingOut)return;
  const w=workspace(),active=()=>token===generation && state.agentWorkspace===w && sameId(state.user?.id,userId) && !state.signingOut;
  const paint=()=>{if(state.route.page==='agents' && !w.busy && !modal.open && !document.activeElement?.closest('form[data-agent-kind]'))ui.render();};
  try{
    const requests=[api('/agents/status'),api('/agents/runs')];
    if(state.user.role==='admin')requests.push(api('/fraud/rules'),api('/fraud/reviews'));
    const [status,runs,rules,reviews]=await Promise.all(requests);
    if(!active())return;
    state.remote.agents={data:{agent:status.agent,runs:runs.runs,rules,reviews:reviews?.reviews || []}};
    paint();
  }catch(error){if(!active())return;if(await recoverSession(error))return;w.error=error.message;paint();}
}
export async function submitAgent(form){
  const w=workspace();if(w.busy)return;
  rememberAgentForm(form);detailGeneration++;
  const values=Object.fromEntries(new FormData(form)),kind=form.dataset.agentKind,userId=state.user.id;
  if(values.days)values.days=Number(values.days);
  if(kind==='rule_simulation'){values.threshold=Number(values.threshold);values.enabled=form.elements.enabled.checked;}
  w.busy=true;w.error='';ui.render();
  try{
    const result=await api('/agents/'+kind,values,'POST',{timeoutMs:90000});
    if(!sameId(state.user?.id,userId) || state.agentWorkspace!==w)return;
    w.run=result.run;
  }catch(error){if(!sameId(state.user?.id,userId))return;if(await recoverSession(error))return;w.error=error.message;}
  finally{if(state.agentWorkspace===w){w.busy=false;if(state.route.page==='agents')ui.render();loadAgents();}}
}
export async function showAgentRun(id){
  const userId=state.user.id,w=workspace(),request=++detailGeneration;
  try{const result=await api('/agents/runs/'+encodeURIComponent(id));if(request!==detailGeneration || state.agentWorkspace!==w || !sameId(state.user?.id,userId))return;w.run=result.run;w.error='';ui.render();}
  catch(error){if(request!==detailGeneration || state.agentWorkspace!==w || !sameId(state.user?.id,userId))return;if(!await recoverSession(error)){w.error=error.message;ui.render();}}
}
export function openAgentDraft(index){const action=workspace().run?.report?.actions?.[Number(index)];if(action)applyBankingAction(action);}
export function selectAgentRule(form){const rule=state.remote.agents?.data?.rules?.rules.find(r=>r.id===form.elements.ruleId.value);if(!rule)return;form.elements.threshold.value=rule.threshold;form.elements.action.value=rule.action;form.elements.enabled.checked=rule.enabled;rememberAgentForm(form);}
export function rememberAgentForm(form){
  if(!form?.dataset.agentKind)return;
  const w=workspace();w.forms ||= {};
  w.forms[form.dataset.agentKind]={...Object.fromEntries(new FormData(form)),...(form.elements.enabled?{enabled:form.elements.enabled.checked}:{})};
}
export function restoreAgentForms(){
  for(const form of document.querySelectorAll('form[data-agent-kind]')){
    const values=workspace().forms?.[form.dataset.agentKind];if(!values)continue;
    for(const [name,value] of Object.entries(values)){const input=form.elements.namedItem(name);if(!input)continue;if(input.type==='checkbox')input.checked=Boolean(value);else input.value=String(value);}
  }
}
export async function investigateFromQueue(id){
  if(state.user?.role!=='admin' || workspace().busy)return;
  navigate('agents');await loadAgents();
  const form=document.querySelector('#agent-fraud-form');
  if(!form || state.route.page!=='agents')return;
  form.elements.transactionId.value=id;await submitAgent(form);
}
