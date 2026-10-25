import { state, captureSession, ui, api, esc, money, fullDate, sameId, dialog, closeDialog, formBusy, formError, toast, recoverSession, authorizationField, modal } from './core.js';
let generation = 0, detailGeneration = 0, sessionGeneration = 0,detailController;
export function cancelFraudCaseDetail(){detailGeneration++;detailController?.abort();}
export function cancelFraudCases() { generation++; cancelFraudCaseDetail(); sessionGeneration++; state.fraudScanBusy=false; }
function filters() { return state.fraudCaseFilters || (state.fraudCaseFilters = { status: 'active', page: 1 }); }
const outcome = value => ({ confirmed_fraud: 'Confirmed fraud', legitimate: 'Legitimate activity', inconclusive: 'Inconclusive' }[value] || value);
export function fraudCasesPanel() {
  const remote = state.remote.fraudCases, data = remote?.data;
  const header = '<div class="section-heading"><h2>AI suspicious-activity queue</h2><button type="button" class="button secondary" data-action="fraud-scan" ' + (state.fraudScanBusy ? 'disabled' : '') + '>' + (state.fraudScanBusy ? 'Analysing payments...' : 'Run AI scan') + '</button></div><div class="field"><label for="fraud-scan-transaction">Outgoing transaction ID (optional)</label><input id="fraud-scan-transaction" maxlength="150" placeholder="Leave blank to scan the next batch"></div>';
  if (!data) return '<section class="panel fraud-cases-panel" data-fraud-cases>' + header + '<p role="'+(remote?.error?'alert':'status')+'">' + esc(remote?.error || 'Loading suspicious activity...') + '</p>'+(remote?.error?'<button type="button" class="button secondary" data-action="fraud-cases-retry">Retry case search</button>':'')+'</section>';
  const scan = data.monitor.summary, p = data.pagination;
  return '<section class="panel fraud-cases-panel" data-fraud-cases>' + header + '<p>' + esc(data.scope) + '</p><div class="notice">A flag is not proof of fraud. Check the evidence before recording a human decision. Payment authorization uses its separate review queue.</div>' +
    '<div class="agent-metrics"><div><span>Unclaimed flags</span><strong>' + data.counts.open + '</strong></div><div><span>Being reviewed</span><strong>' + data.counts.in_review + '</strong></div><div><span>Resolved cases</span><strong>' + data.counts.closed + '</strong></div></div>' +
    '<p data-fraud-scan-status>' + (data.monitor.lastError ? 'Monitoring could not finish. Unchecked payments will retry; existing cases remain available.' : data.monitor.lastCompletedAt ? 'Last scan: ' + fullDate(data.monitor.lastCompletedAt) + ' SGT. ' + (scan.checked ?? 0) + ' checked, ' + (scan.flagged ?? 0) + ' flagged, ' + (scan.remaining ?? 0) + ' remaining.' : 'Automatic monitoring starts with the running application. Run a scan to analyse existing payments now.') + '</p>' +
    '<div class="field"><label for="fraud-case-filter">Case status</label><select id="fraud-case-filter">' + [['active', 'Needs investigation'], ['open', 'Unclaimed'], ['in_review', 'Being reviewed'], ['closed', 'Resolved'], ['all', 'All cases']].map(([value, label]) => '<option value="' + value + '" ' + (filters().status === value ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></div>' +
    (data.cases.length ? '<div class="table-scroll"><table><thead><tr><th>Business / payment</th><th>Flag reasons</th><th>Priority score</th><th>Case</th><th>Action</th></tr></thead><tbody>' + data.cases.map(c => '<tr><td><strong>' + esc(c.transaction.business) + '</strong><small>' + esc(c.transaction.description) + '</small><small>' + money(c.transaction.amountCents) + ' / ' + esc(c.transaction.status.replaceAll('_', ' ')) + '</small></td><td>' + c.evidence.signals.map(s => '<p>' + esc(s.message) + '</p>').join('') + '</td><td>' + esc(c.score ?? 'Unavailable') + (c.score === null ? '' : ' / 100') + '</td><td>' + esc(c.status.replaceAll('_', ' ')) + '<small>' + esc(c.reviewerName || 'Unassigned') + '</small></td><td><button type="button" class="text-button" data-fraud-case="' + esc(c.id) + '">Inspect case</button></td></tr>').join('') + '</tbody></table></div>' : '<p>No cases match this filter. This does not establish that all activity is safe.</p>') +
    '<div class="pagination"><button type="button" class="button secondary" data-action="fraud-cases-prev" ' + (p.page <= 1 ? 'disabled' : '') + '>Previous</button><span>Page ' + p.page + ' of ' + Math.max(1, p.totalPages) + '</span><button type="button" class="button secondary" data-action="fraud-cases-next" ' + (p.page >= p.totalPages ? 'disabled' : '') + '>Next</button></div></section>';
}
export async function loadFraudCases({ status, direction = 0, render = true } = {}) {
  if (state.user?.role !== 'admin' || state.signingOut) return;
  const f = filters(); if (status) { f.status = status; f.page = 1; } else f.page = Math.max(1, f.page + direction);
  const userId = state.user.id, request = ++generation;
  state.remote.fraudCases={loading:true};
  if(render && state.route.page==='fraud')ui.render();
  try {
    const data = await api('/fraud/cases?' + new URLSearchParams(f));
    if (request !== generation || !sameId(state.user?.id, userId) || state.signingOut) return;
    f.page = data.pagination.page;
    state.remote.fraudCases = { data };
  } catch (error) {
    if (request !== generation || !sameId(state.user?.id, userId)) return;
    if (await recoverSession(error)) return;
    state.remote.fraudCases = { error: error.message };
  }
  if (render && state.route.page === 'fraud') ui.render();
}
export async function runFraudScan() {
  if (state.fraudScanBusy || state.user?.role !== 'admin') return;
  const userId = state.user.id, session = sessionGeneration, route=state.route, transactionId = document.querySelector('#fraud-scan-transaction')?.value.trim();
  state.fraudScanBusy = true; ui.render();
  try {
    const result = await api('/fraud/scan', { limit: 25, ...(transactionId ? {transactionId} : {}) }, 'POST', { timeoutMs: 90000 });
    if (session !== sessionGeneration || !sameId(state.user?.id, userId) || state.signingOut) return;
    toast(result.scan.checked + ' payments checked; ' + result.scan.created + ' new cases. ' + result.scan.remaining + ' payments remain for the next batch.');
    await loadFraudCases({ render: false });
    if(transactionId && state.route===route && state.route.page==='fraud' && session === sessionGeneration && sameId(state.user?.id,userId)){
      const {analysis}=await api('/fraud/analysis/'+encodeURIComponent(transactionId));
      if(session !== sessionGeneration || state.route!==route || !sameId(state.user?.id,userId))return;
      if(analysis.caseId)await openFraudCase(analysis.caseId);
      else dialog('Recorded AI transaction analysis.', '<p>No configured suspicious-activity signal was triggered. This does not establish that the payment is safe.</p><p>AI score: '+esc(analysis.evidence.model?.score ?? 'Unavailable')+' / 100.</p><ul class="agent-findings">'+(analysis.evidence.model?.reasons || []).map(r=>'<li>'+esc(r.message)+'</li>').join('')+'</ul><details><summary>Saved analysis evidence</summary><pre class="metadata-json">'+esc(JSON.stringify(analysis,null,2))+'</pre></details>');
    }
  } catch (error) { if (session === sessionGeneration && sameId(state.user?.id, userId) && !await recoverSession(error)) toast(error.message); }
  finally { if (session === sessionGeneration && sameId(state.user?.id, userId)) { state.fraudScanBusy = false; if (state.route.page === 'fraud') ui.render(); } }
}
export async function openFraudCase(id) {
  if (state.user?.role !== 'admin' || state.signingOut || state.route.page!=='fraud') return;
  const userId = state.user.id, request = ++detailGeneration,route=state.route;
  detailController?.abort();detailController=new AbortController();
  dialog('Suspicious activity investigation.','<div class="loading-state" role="status"><p>Loading saved case evidence...</p></div>');
  const token='fraud-case:'+request;modal.dataset.detailRequest=token;
  const active=()=>request===detailGeneration && state.route===route && sameId(state.user?.id,userId) && !state.signingOut && modal.open && modal.dataset.detailRequest===token;
  try {
    const { case: c } = await api('/fraud/cases/' + encodeURIComponent(id),undefined,'GET',{signal:detailController.signal});
    if(!active())return;
    const mine = sameId(c.assignedTo, userId), independent = !sameId(c.transaction.makerId, userId);
    dialog('Suspicious activity investigation.', '<p class="modal-intro">' + esc(c.transaction.business) + ' / ' + money(c.transaction.amountCents) + '. Payment status: ' + esc(c.transaction.status.replaceAll('_', ' ')) + '. Case status: ' + esc(c.status.replaceAll('_', ' ')) + '.</p><ul class="agent-findings">' + c.evidence.signals.map(s => '<li>' + esc(s.message) + '</li>').join('') + '</ul><dl class="review-list"><div><dt>AI score at this scan</dt><dd>' + esc(c.evidence.model?.score ?? 'Unavailable') + (c.evidence.model ? ' / 100' : '') + '</dd></div><div><dt>Case priority score</dt><dd>' + esc(c.score ?? 'Unavailable') + '</dd></div><div><dt>Reviewer</dt><dd>' + esc(c.reviewerName || 'Unassigned') + '</dd></div></dl>' +
      (c.evidence.model ? '<h3>AI signals</h3><ul class="agent-findings">' + c.evidence.model.reasons.map(r => '<li>' + esc(r.message) + '</li>').join('') + '</ul>' : '<div class="notice">AI analysis is unavailable because the historical input cannot be verified. Review the original record manually.</div>') +
      (c.status === 'closed' ? '<h3>' + esc(outcome(c.outcome)) + '</h3><p>' + esc(c.reviewReason) + '</p>' : !independent ? '<div class="notice">A different reviewer must investigate your own payment.</div>' : c.status === 'open' ? '<button type="button" class="button" data-claim-fraud-case="' + esc(c.id) + '" data-version="' + c.version + '">Claim investigation</button>' : mine ? '<form id="fraud-case-review-form" data-case-id="' + esc(c.id) + '" data-version="' + c.version + '"><div class="field"><label for="fraud-case-outcome">Investigation outcome</label><select id="fraud-case-outcome" name="outcome"><option value="inconclusive">Inconclusive / needs further action</option><option value="legitimate">Legitimate activity</option><option value="confirmed_fraud">Confirmed fraud</option></select></div><div class="field"><label for="fraud-case-reason">Evidence and decision reason</label><textarea id="fraud-case-reason" name="reason" minlength="10" maxlength="1000" required></textarea></div>' + authorizationField() + '<div class="error-message" role="alert"></div><button type="submit" class="button full">Record human decision</button></form>' : '<p>This case is being investigated by ' + esc(c.reviewerName) + '.</p>') +
      '<div class="notice">This investigation does not settle, reject, reverse or refund the payment. Held payment authorization uses its separate review queue.</div><details><summary>Evidence, assumptions and case history</summary><pre class="metadata-json">' + esc(JSON.stringify(c, null, 2)) + '</pre></details>');
  } catch (error) { if(active() && error.status!==-1 && !await recoverSession(error))dialog('Investigation unavailable.','<p>'+esc(error.message)+'</p><button type="button" class="button secondary" data-action="close-dialog">Done</button>'); }
}
export async function claimFraudCase(control) {
  const userId = state.user?.id, route=state.route, session=sessionGeneration,id = control.dataset.claimFraudCase; control.disabled = true;
  try { await api('/fraud/cases/' + encodeURIComponent(id) + '/review', { action: 'claim', version: Number(control.dataset.version) }, 'POST'); if (session!==sessionGeneration || !sameId(state.user?.id, userId)) return; await loadFraudCases({ render: false }); if(state.route===route && modal.open && control.isConnected && !state.signingOut)await openFraudCase(id); }
  catch (error) { if (sameId(state.user?.id, userId) && !await recoverSession(error)) toast(error.message); }
  finally { control.disabled = false; }
}
export async function submitFraudCaseReview(form) {
  const active=captureSession();if(!active())return;
  if (state.modalBusy) return;
  state.modalBusy = true; formBusy(form, true);
  try {
    await api('/fraud/cases/' + encodeURIComponent(form.dataset.caseId) + '/review', { action: 'close', version: Number(form.dataset.version), outcome: form.elements.outcome.value, reason: form.elements.reason.value, authorizationPassword: form.elements.authorizationPassword.value }, 'POST');
    if(!active())return;
    state.modalBusy = false; closeDialog(); toast('Human review recorded. Payment balances and status were unchanged.'); await loadFraudCases();
  } catch (error) { if (active() && !await recoverSession(error)) formError(form, error.message); }
  finally { if (form.elements.authorizationPassword) form.elements.authorizationPassword.value = ''; if(active()){state.modalBusy=false;formBusy(form,false);} }
}
