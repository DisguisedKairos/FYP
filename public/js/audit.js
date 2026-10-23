// Administrative rule changes are read from the service's persisted audit trail.
import { state, api, esc, icon, fullDate, sameId, recoverSession } from './core.js';
let controller,generation=0;
export function cancelRuleAudit() { generation++; controller?.abort(); }
function current() { return state.ruleAudit || (state.ruleAudit={page:1,ruleId:'',loading:true,error:'',data:null}); }
function actionLabel(action) { return action === 'block' ? 'Block request' : 'Hold for review'; }
export function auditResults() {
  const audit=current();
  if (audit.loading) return '<div class="loading-state" role="status"><p>Loading rule changes…</p></div>';
  if (audit.error) return '<div class="error-message" role="alert"><p>'+esc(audit.error)+'</p><button type="button" class="text-button" data-action="audit-retry">Try again</button></div>';
  const {entries=[],pagination={page:1,pageSize:10,total:0,totalPages:1}}=audit.data || {};
  const cards=entries.map(entry => {
    const before=entry.before || {},after=entry.after || {};
    const actor=entry.actor?.name || (entry.actor?.id ? 'User '+entry.actor.id : 'Administrator');
    const rows=[['Enabled',before.enabled?'Yes':'No',after.enabled?'Yes':'No'],['Threshold',String(before.threshold ?? '')+' '+(before.unit || ''),String(after.threshold ?? '')+' '+(after.unit || '')],['Action',actionLabel(before.action),actionLabel(after.action)]];
    return '<article class="rule-audit-entry"><div class="audit-entry-heading"><div><h3>'+esc(after.name || before.name || entry.ruleId)+'</h3><p>'+esc(actor)+' · '+fullDate(entry.createdAt)+' SGT</p></div><span class="tag">Version '+esc(entry.version)+'</span></div><details><summary>View before and after</summary><table class="audit-change-table"><thead><tr><th scope="col">Setting</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((value,index)=>index===0?'<th scope="row">'+esc(value)+'</th>':'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></details></article>';
  }).join('');
  return (cards || '<div class="empty-state"><h3>No rule changes yet.</h3><p>Saved configuration changes will show who changed each rule and its previous values.</p></div>')+'<div class="table-footer audit-pagination"><span>'+pagination.total+' change'+(pagination.total===1?'':'s')+'</span><div class="pagination-controls"><button type="button" class="icon-button" data-action="audit-prev" aria-label="Previous rule audit page" '+(pagination.page<=1?'disabled':'')+'>'+icon('chevron')+'</button><span>Page '+pagination.page+' of '+Math.max(1,pagination.totalPages)+'</span><button type="button" class="icon-button" data-action="audit-next" aria-label="Next rule audit page" '+(pagination.page>=pagination.totalPages?'disabled':'')+'>'+icon('chevron')+'</button></div></div>';
}
export function auditPanel(rules) {
  const audit=current();
  return '<section class="panel rule-audit-panel" aria-labelledby="rule-audit-heading"><div class="section-heading"><div><h2 id="rule-audit-heading">Rule change history</h2><p>Saved administrative changes · Times in SGT</p></div><div class="audit-filter"><label for="rule-audit-filter">Filter by rule</label><select id="rule-audit-filter"><option value="">All rules</option>'+rules.map(rule=>'<option value="'+esc(rule.id)+'" '+(audit.ruleId===rule.id?'selected':'')+'>'+esc(rule.name)+'</option>').join('')+'</select></div></div><div id="rule-audit-results" aria-busy="'+audit.loading+'">'+auditResults()+'</div></section>';
}
export async function loadRuleAudit({page,ruleId}={}) {
  if (!state.user || state.user.role!=='admin' || state.signingOut) return;
  const audit=current(),userId=state.user.id,request=++generation;
  if (page!==undefined) audit.page=Math.max(1,page);
  if (ruleId!==undefined) { audit.ruleId=ruleId; audit.page=1; }
  controller?.abort(); controller=new AbortController(); audit.loading=true; audit.error='';
  const render=()=>{ const target=document.querySelector('#rule-audit-results'); if(target && state.route.page==='rules'){ target.setAttribute('aria-busy',String(current().loading)); target.innerHTML=auditResults(); } };
  render();
  try {
    const params=new URLSearchParams({page:String(audit.page),pageSize:'10'});
    if(audit.ruleId)params.set('ruleId',audit.ruleId);
    const result=await api('/fraud/rules/audit?'+params,undefined,'GET',{signal:controller.signal});
    if(request!==generation || !state.user || state.signingOut || !sameId(userId,state.user.id))return;
    state.ruleAudit={...audit,data:result,page:result.pagination.page,loading:false,error:''}; render();
  } catch(error) {
    if(request!==generation || error.status===-1 || !state.user || state.signingOut || !sameId(userId,state.user.id))return;
    if(await recoverSession(error))return;
    state.ruleAudit={...audit,loading:false,error:error.message}; render();
  }
}
