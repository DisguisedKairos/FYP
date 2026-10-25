import { auditPanel } from './audit.js';
import { modelActivityPanel } from './model-activity.js';
import { fraudCasesPanel } from './fraud-cases.js';
﻿import { modal, state, captureSession, ui, api, esc, icon, money, fullDate, sameId, dialog, closeDialog, formBusy, formError, toast, recoverSession, statusPill, authorizationField, loadDashboard } from './core.js';
import { heading } from './views.js';
import { remoteContent, loadExtras, loadNotifications } from './services.js';
import { riskExplanation, transactionDetails } from './workflows.js';

function modelCard() {
  const remote = state.remote.model;
  if (!remote) return '<section class="panel model-card"><h2>Local fraud scoring model</h2><p>Loading model information…</p></section>';
  if (remote.error) return `<section class="panel model-card"><h2>Scoring model</h2><p>${esc(remote.error)}</p></section>`;
  const m=remote.data;
  return '<section class="panel model-card"><div class="section-heading"><h2>Local Ollama fraud scoring</h2><span class="tag">'+esc(m.modelName)+'</span></div><p>'+esc(m.scoreMeaning)+'</p><p>Every new AI score requires inference from this installed local model. No trained baseline or simulated score is substituted.</p><ul>'+m.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><details><summary>Local model provenance</summary><pre class="metadata-json">'+esc(JSON.stringify(m,null,2))+'</pre></details></section>';
}
export function fraudPage() {
  if (state.user?.role !== 'admin') return '';
  return heading('A clearer view of risk.', 'Review flagged requests with explanations and a separate decision maker.', `<button type="button" class="button secondary" data-action="reload-page">${icon('activity')}<span>Refresh queue</span></button>`) + `<div class="notice">An administrator can review another user’s request. You cannot approve or reject your own payment. No funds move while a request awaits review.</div>` + remoteContent('fraud', result => {
    const reviews = result.reviews || [];
    return `${fraudCasesPanel()}<div class="risk-layout"><section class="panel review-queue"><div class="section-heading"><h2>Awaiting independent review</h2><span class="tag">${reviews.length} request${reviews.length === 1 ? '' : 's'}</span></div>${reviews.length ? `<div class="review-queue-list">${reviews.map(t => `<article class="review-queue-item"><div class="review-queue-heading"><span class="quick-action-icon">${icon('shield')}</span><div><h3>${esc(t.description)}</h3><p>${esc(t.maker?.name || 'Account holder')} · ${esc(t.maker?.email || '')}</p></div><strong>${money(Math.abs(t.amountCents))}</strong></div><div class="review-queue-meta"><span>${fullDate(t.createdAt)}</span><span>Risk score ${esc(t.risk?.score ?? '—')}</span>${statusPill(t.status)}</div><button type="button" class="button secondary" data-review-transaction="${esc(t.id)}" ${sameId(t.maker?.id,state.user.id) ? 'disabled' : ''}>Review request ${icon('arrow')}</button><button type="button" class="text-button" data-investigate-transaction="${esc(t.id)}">Investigate evidence ${icon('activity')}</button></article>`).join('')}</div>` : `<div class="empty-state">${icon('shield')}<h3>The review queue is clear.</h3><p>Requests from other users that need a decision will appear here.</p></div>`}</section>${modelCard()}</div>${modelActivityPanel(state.remote.modelActivity)}`;
  });
}
export function rulesPage() {
  if (state.user?.role !== 'admin') return '';
  return heading('Clear rules. Considered decisions.', 'Configure the deterministic checks that work alongside the scoring model.', `<button type="button" class="button secondary" data-action="reload-page">${icon('activity')}<span>Refresh rules</span></button>`) + remoteContent('rules', result => `<div class="rule-policy panel"><div><span>Review score threshold</span><strong>${esc(result.reviewThreshold)}</strong></div><div><span>Block score threshold</span><strong>${esc(result.blockThreshold)}</strong></div><div><span>Rule version</span><strong>${esc(result.version)}</strong></div></div><p class="rules-intro">Each rule checks a measurable signal. Enabled rules can hold or block a request even when the model score is lower. Changes apply to new assessments; existing decisions retain their recorded rule version.</p><section class="rules-grid" aria-label="Fraud rules">${(result.rules || []).map(rule => `<article class="panel rule-card"><div class="section-heading"><h2>${esc(rule.name)}</h2><span class="tag ${rule.enabled ? '' : 'tag-muted'}">${rule.enabled ? 'Enabled' : 'Disabled'}</span></div><p>${esc(rule.description)}</p><dl class="review-list"><div><dt>Threshold</dt><dd>${esc(rule.threshold)} ${esc(rule.unit || '')}</dd></div><div><dt>Action when matched</dt><dd>${rule.action === 'block' ? 'Block request' : 'Hold for review'}</dd></div></dl><button type="button" class="button secondary" data-edit-rule="${esc(rule.id)}">${icon('sliders')} Edit rule</button></article>`).join('')}</section>${auditPanel(result.rules || [])}`);
}
export function ruleDialog(id) {
  if (state.user?.role !== 'admin') return;
  const result = state.remote.rules?.data, rule = result?.rules.find(rule => sameId(rule.id,id));
  if (!rule) return;
  dialog('Edit fraud rule.', `<p class="modal-intro">${esc(rule.name)}<br>${esc(rule.description)}</p><form id="rule-form" data-id="${esc(id)}" data-version="${esc(result.version)}"><label class="checkbox-field"><input type="checkbox" name="enabled" ${rule.enabled ? 'checked' : ''}>Enable this rule</label><div class="field"><label for="rule-threshold">Threshold${rule.unit ? ` (${esc(rule.unit)})` : ''}</label><input id="rule-threshold" name="threshold" type="number" min="${rule.id === "velocity" ? "1" : "0.01"}" max="${rule.id === "balance_utilization" ? "100" : rule.id === "velocity" ? "1000" : "10000000"}" step="${rule.id === "velocity" ? "1" : "0.01"}" value="${esc(rule.threshold)}" required></div><div class="field"><label for="rule-action">Action when matched</label><select id="rule-action" name="action"><option value="review" ${rule.action === 'review' ? 'selected' : ''}>Hold for independent review</option><option value="block" ${rule.action === 'block' ? 'selected' : ''}>Block request</option></select></div>${authorizationField()}<div class="error-message" role="alert"></div><div class="notice">This changes how future requests are assessed. Every change is saved with a new rule version.</div><button type="submit" class="button full">Save rule ${icon('check')}</button></form>`);
}
export async function saveRule(form) {
  const active=captureSession();if(!active())return;
  if (state.modalBusy || state.user?.role !== 'admin') return;
  const threshold = Number(form.elements.threshold.value);
  if (!Number.isFinite(threshold) || threshold <= 0) return formError(form,'Enter a positive threshold.');
  state.modalBusy = true; formBusy(form,true);
  try {
    const currentVersion = Number.isFinite(Number(form.dataset.version)) ? Number(form.dataset.version) : form.dataset.version;
    await api(`/fraud/rules/${encodeURIComponent(form.dataset.id)}`, { enabled: form.elements.enabled.checked, threshold, action: form.elements.action.value, version: currentVersion, authorizationPassword: form.elements.authorizationPassword.value }, 'PATCH');
    if(!active())return;
    state.modalBusy = false; closeDialog();
    if (state.ruleAudit) state.ruleAudit.page=1;
    await loadExtras('rules',{force:true});
    if(!active())return;
    toast('Fraud rule updated for future assessments.');
  } catch (error) { if (active() && !await recoverSession(error)) formError(form,error.status === 409 ? `${error.message} Close this dialog and refresh the rules before editing again.` : error.message); }
  finally { if (form.elements.authorizationPassword) form.elements.authorizationPassword.value = ''; if(active()){state.modalBusy=false;formBusy(form,false);} }
}
export function reviewDialog(id) {
  if (state.user?.role !== 'admin') return;
  const t = state.remote.fraud?.data?.reviews.find(t => sameId(t.id,id));
  if (!t || sameId(t.maker?.id,state.user.id)) return toast('A different administrator must review this request.');
  dialog('Review a flagged request.', `<p class="modal-intro">Your decision is recorded with your identity and reason. Approval attempts the payment using the current available balance.</p><dl class="review-list"><div><dt>Requested by</dt><dd>${esc(t.maker?.name)}<small>${esc(t.maker?.email)}</small></dd></div><div><dt>From account</dt><dd>${esc(t.accountName)}<small>${esc(t.accountNumber)}</small></dd></div><div><dt>To</dt><dd>${esc(t.counterparty)}</dd></div><div><dt>Amount</dt><dd class="review-amount">${money(Math.abs(t.amountCents))}</dd></div><div><dt>Requested</dt><dd>${fullDate(t.createdAt)}</dd></div><div><dt>Reference</dt><dd>${esc(t.reference)}</dd></div></dl>${riskExplanation(t.risk,{admin:true})}${t.risk?.context ? `<details class="review-context"><summary>Historical context</summary><dl class="review-list"><div><dt>Past transactions</dt><dd>${esc(t.risk.context.historicalTransactions)}</dd></div><div><dt>Average outgoing amount</dt><dd>${money(t.risk.context.averageOutgoingCents || 0)}</dd></div><div><dt>Requests in 10 minutes</dt><dd>${esc(t.risk.context.outgoingCount10m)}</dd></div><div><dt>Outgoing today</dt><dd>${money(t.risk.context.dailyOutgoingCents || 0)}</dd></div><div><dt>Known payee</dt><dd>${t.risk.context.knownPayee ? 'Yes' : 'No'}</dd></div></dl></details>` : ''}<form id="review-form" data-id="${esc(t.id)}"><div class="field"><label for="review-decision">Decision</label><select id="review-decision" name="decision" required><option value="">Choose a decision</option><option value="approve">Approve and attempt payment</option><option value="reject">Reject request</option></select></div><div class="field"><label for="review-reason">Reason for your decision</label><textarea id="review-reason" name="reason" rows="3" minlength="3" maxlength="500" required placeholder="Explain why this request should be approved or rejected"></textarea></div>${authorizationField()}<div class="error-message" role="alert"></div><button type="submit" class="button full">Record review decision ${icon('shield')}</button></form>`);
}
export async function submitReview(form) {
  const active=captureSession();if(!active())return;
  if (state.modalBusy || state.user?.role !== 'admin') return;
  state.modalBusy = true; formBusy(form,true);
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api(`/fraud/reviews/${encodeURIComponent(form.dataset.id)}`,values);
    if(!active())return;
    form.elements.authorizationPassword.value = '';
    state.modalBusy = false; closeDialog();
    await Promise.all([loadExtras('fraud',{force:true}),loadDashboard({render:false})]);
    if(!active())return;
    ui.render();
    transactionDetails(result.transaction);
    loadNotifications();
    toast(result.transaction.status === 'completed' ? 'Request approved and payment completed.' : 'Review decision recorded.');
  } catch (error) {
    form.elements.authorizationPassword.value = '';
    if (active() && !await recoverSession(error)) formError(form,error.message);
  } finally { if(active()){state.modalBusy=false;formBusy(form,false);} }
}
