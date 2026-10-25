import {state,ui,api,esc,fullDate,sameId,dialog,recoverSession,toast} from './core.js';
import {heading} from './views.js';
let generation=0,detailGeneration=0,controller,detailController;
const labels={agent:'Assistant and insights',payment:'Payment risk',monitoring:'Fraud monitoring',failure:'Failed model request'};
function current(){return state.aiAudit || (state.aiAudit={page:1,filters:{type:'all',days:'30',q:''},loading:false,error:'',data:null,detail:null});}
export function cancelAiAudit(){generation++;detailGeneration++;controller?.abort();detailController?.abort();}
const list=items=>'<ul class="agent-findings">'+items.map(x=>'<li>'+esc(typeof x==='string'?x:x.message || JSON.stringify(x))+'</li>').join('')+'</ul>';
const json=value=>'<pre class="metadata-json">'+esc(JSON.stringify(value,null,2))+'</pre>';
export function aiAuditPage(){
  const w=current(),p=w.data?.pagination,staff=state.user?.role==='admin';
  const options=Object.entries(labels).filter(([key])=>staff || key!=='monitoring');
  return heading('AI audit log.','Inspect the evidence, evaluation outcomes and safety checks behind AI-assisted decisions.','')+
    '<div class="notice">This log shows recorded decision evidence and model request activity. Hidden model thoughts and raw chat prompts are not recorded. '+esc(w.data?.scope || 'Records are limited by your account permissions.')+'</div>'+
    '<section class="panel ai-audit-panel"><form id="ai-audit-filters" class="ai-audit-filters"><div class="field"><label for="ai-audit-query">Search record ID or task</label><input id="ai-audit-query" name="q" type="search" maxlength="150" value="'+esc(w.filters.q)+'" placeholder="Transaction ID, run ID or task name"></div><div class="field"><label for="ai-audit-type">Record type</label><select id="ai-audit-type" name="type"><option value="all">All records</option>'+options.map(([key,label])=>'<option value="'+key+'" '+(w.filters.type===key?'selected':'')+'>'+label+'</option>').join('')+'</select></div><div class="field"><label for="ai-audit-days">Period</label><select id="ai-audit-days" name="days">'+[7,30,90].map(days=>'<option value="'+days+'" '+(String(w.filters.days)===String(days)?'selected':'')+'>Last '+days+' days</option>').join('')+'</select></div><button type="submit" class="button">Search audit log</button></form><div role="alert" class="error-message">'+esc(w.error)+'</div>'+
    (w.loading?'<p role="status">Loading saved AI records...</p>':w.data?'<p data-ai-audit-count>'+p.total+' matching records. Times in SGT.</p>'+(w.data.entries.length?'<div class="table-scroll"><table class="ai-audit-table"><thead><tr><th>Time / record</th><th>Task</th><th>Outcome</th><th>Model</th><th>Evidence</th></tr></thead><tbody>'+w.data.entries.map(e=>'<tr><td>'+fullDate(e.createdAt)+'<small>'+esc(e.reference)+'</small></td><td>'+esc(labels[e.kind])+'<small>'+esc(e.title)+'</small></td><td>'+esc(e.decision || e.status)+(e.score!==null?'<small>AI score '+esc(e.score)+' / 100</small>':'')+'</td><td>'+esc(e.model || (e.provider==='ollama'?'Ollama; model name not recorded':'Historical / not recorded'))+'</td><td><button type="button" class="text-button" data-ai-audit-kind="'+e.kind+'" data-ai-audit-id="'+esc(e.id)+'">Inspect audit</button></td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state"><h2>No matching AI records.</h2><p>Use the assistant or submit an authorized payment to create recorded activity. Older entries may not contain request timing.</p></div>')+'<div class="pagination"><button type="button" class="button secondary" data-action="ai-audit-prev" '+(p.page<=1?'disabled':'')+'>Previous</button><span>Page '+p.page+' of '+Math.max(1,p.totalPages)+'</span><button type="button" class="button secondary" data-action="ai-audit-next" '+(p.page>=p.totalPages?'disabled':'')+'>Next</button></div>':'<p>Load the audit log to inspect saved evidence.</p>')+'</section>';
}
export async function loadAiAudit({form,page}={}){
  if(!state.user || state.signingOut)return;
  const w=current(),userId=state.user.id,request=++generation;
  if(form){w.filters=Object.fromEntries(new FormData(form));w.page=1;}
  if(page!==undefined)w.page=Math.max(1,page);
  controller?.abort();controller=new AbortController();w.loading=true;w.error='';
  if(state.route.page==='aiAudit')ui.render();
  try{
    const result=await api('/ai-audit?'+new URLSearchParams({...w.filters,page:String(w.page),pageSize:'20'}),undefined,'GET',{signal:controller.signal});
    if(request!==generation || state.aiAudit!==w || !sameId(state.user?.id,userId) || state.signingOut)return;
    w.data=result;
  }catch(error){if(request!==generation || error.status===-1 || state.aiAudit!==w || !sameId(state.user?.id,userId))return;if(await recoverSession(error))return;w.error=error.message;}
  finally{if(request===generation && state.aiAudit===w && sameId(state.user?.id,userId)){w.loading=false;if(state.route.page==='aiAudit')ui.render();}}
}
function detailHtml(d){
  const e=d.evidence,r=e.decisionSummary,a=e.analysis,calls=d.modelCalls;
  const callRows=calls.map(c=>'<li><strong>'+esc(c.phase?.replaceAll('_',' '))+' / '+esc(c.status)+'</strong><p>'+esc(c.model || 'Model name not recorded')+' / '+fullDate(c.startedAt || c.createdAt)+' SGT / '+esc(c.durationMs)+' ms / '+(c.executed?'Request attempt through local adapter':'Availability check; no inference')+'</p>'+(c.toolNames?.length?'<p>Proposed tools: '+esc(c.toolNames.join(', '))+'</p>':'')+(c.errorCode?'<p>Failure: '+esc(c.errorCode)+'</p>':'')+'</li>').join('');
  return '<div class="notice">'+esc(d.interpretation)+'</div><p>'+esc(labels[d.kind])+' / '+fullDate(d.createdAt)+' SGT</p><p class="reference-value">Record '+esc(d.id)+'</p><h3>Decision and safety checks</h3>'+json(e.guardrails || {})+
    (r?'<dl class="review-list"><div><dt>AI score</dt><dd>'+esc(r.aiScore)+' / 100</dd></div><div><dt>Combined score</dt><dd>'+esc(r.combinedScore)+' / 100</dd></div><div><dt>Recorded decision</dt><dd>'+esc(r.decision)+'</dd></div></dl><h3>AI-selected reasons</h3>'+list(r.aiReasons)+'<h3>Financial rules that matched</h3>'+(r.ruleMatches.length?list(r.ruleMatches):'<p>No financial rule match was recorded.</p>')+'<p>'+esc(e.scoreMeaning)+'</p>':'')+
    (a?'<h3>Suspicious-activity signals</h3>'+list(a.signals || [])+(a.model?'<h3>AI-selected reasons</h3>'+list(a.model.reasons || []):'<p>No validated model reassessment was available.</p>'):'')+
    (e.report?'<h3>Displayed interpretation</h3><p class="assistant-message-text">'+esc(e.report.interpretation || e.report.reply || e.report.title)+'</p>':'')+
    '<h3>Model request timeline</h3><p>'+esc(d.provenanceNote)+'</p>'+(calls.length?'<ol class="ai-audit-timeline">'+callRows+'</ol>':'')+(d.modelCallsTruncated?'<p>Only the first 100 request records are shown.</p>':'')+
    (e.tools?.length?'<h3>Tools and retrieved evidence</h3><ol class="ai-audit-timeline">'+e.tools.map(t=>'<li><strong>Step '+t.step+': '+esc(t.tool)+'</strong><details><summary>Inspect permitted arguments and saved result</summary>'+json({arguments:t.arguments,result:t.result})+'</details></li>').join('')+'</ol>':'')+
    (e.inputSnapshot?'<h3>Input and policy evidence</h3><p>'+esc(e.modelInput)+'</p><details><summary>Authoritative payment snapshot and policy</summary>'+json({input:e.inputSnapshot,policy:e.policySnapshot})+'</details>':'')+
    '<details><summary>Complete saved audit evidence</summary>'+json(d)+'</details><div class="modal-actions"><button type="button" class="button secondary" data-action="close-dialog">Done</button><button type="button" class="button" data-action="ai-audit-download">Download audit JSON</button></div>';
}
export async function showAiAudit(kind,id){
  if(!state.user || state.signingOut)return;
  const w=current(),userId=state.user.id,request=++detailGeneration;detailController?.abort();detailController=new AbortController();w.detail=null;
  try{
    const {record}=await api('/ai-audit/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id),undefined,'GET',{signal:detailController.signal});
    if(request!==detailGeneration || state.aiAudit!==w || !sameId(state.user?.id,userId) || state.signingOut || state.route.page!=='aiAudit')return;
    w.detail=record;dialog('AI evaluation audit.',detailHtml(record));
  }catch(error){if(request!==detailGeneration || error.status===-1 || !sameId(state.user?.id,userId))return;if(!await recoverSession(error))toast(error.message);}
}
export function downloadAiAudit(){
  const d=state.aiAudit?.detail;if(!d || !state.user || state.signingOut)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download='greenlink-ai-audit-'+d.kind+'-'+d.id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,60)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
