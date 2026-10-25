// Account history, exports and statements are read from the ledger API. The
// dashboard is only a recent-activity preview and is never a financial report.
import { modal, state, ui, api, esc, icon, brand, money, fullDate, singaporeDay, sameId, allAccounts, formBusy, formError, dialog, toast, recoverSession, statusLabel } from './core.js';
import { historyResults, accountRecentResults } from './views.js';

let historyController, accountController, detailController, exportController, historyTimer;
let historyGeneration = 0, accountGeneration = 0, detailGeneration = 0;
export function cancelHistoryReads() {
  clearTimeout(historyTimer); historyTimer = null;
  historyGeneration++; accountGeneration++; detailGeneration++;
  for (const controller of [historyController, accountController, detailController, exportController]) controller?.abort();
}
function validUser(id) { return state.user && !state.signingOut && sameId(state.user.id,id); }
export function historyQuery({ filters = state.filters, page = state.historyPage, paginated = true } = {}) {
  const params = new URLSearchParams();
  for (const [field, param] of [['search','q'],['account','accountId'],['type','type'],['status','status'],['from','from'],['to','to']]) {
    if (filters[field]) params.set(param,String(filters[field]).trim());
  }
  if (paginated) { params.set('page',String(page)); params.set('pageSize',String(state.pageSize)); }
  return params;
}
function validateFilters(filters) {
  if ((filters.search || '').length > 120) throw new Error('Use a search of 120 characters or fewer.');
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('The end date must be on or after the start date.');
}
function renderHistoryResults() {
  const target = document.querySelector('#history-results');
  if (!target || state.route.page !== 'activity') return;
  target.setAttribute('aria-busy',String(state.history.loading));
  target.innerHTML = historyResults();
}
export async function loadHistory() {
  if (!state.user || state.signingOut) return;
  clearTimeout(historyTimer); historyTimer = null;
  const generation = ++historyGeneration, userId = state.user.id;
  historyController?.abort(); historyController = new AbortController();
  try { validateFilters(state.filters); }
  catch (error) { state.history = { loading:false,error:error.message,transactions:[],pagination:null,totals:null }; renderHistoryResults(); return; }
  state.history = { ...state.history, loading:true,error:'' };
  renderHistoryResults();
  try {
    const result = await api(`/transactions?${historyQuery()}`,undefined,'GET',{signal:historyController.signal});
    if (generation !== historyGeneration || !validUser(userId)) return;
    if (result.pagination.totalPages > 0 && result.pagination.page > result.pagination.totalPages) {
      state.historyPage = result.pagination.totalPages;
      return loadHistory();
    }
    state.historyPage = result.pagination.total ? result.pagination.page : 1;
    state.history = { ...result, loading:false,error:'' };
    renderHistoryResults();
  } catch (error) {
    if (generation !== historyGeneration || error.status === -1 || !validUser(userId)) return;
    if (await recoverSession(error)) return;
    state.history = { loading:false,error:error.message,transactions:[],pagination:null,totals:null };
    renderHistoryResults();
  }
}
export function updateHistoryFilters(form,{debounce = false} = {}) {
  const filters = Object.fromEntries(new FormData(form));
  if (Object.entries(filters).every(([key,value]) => state.filters[key] === value)) {
    if (historyTimer && !debounce) { clearTimeout(historyTimer); historyTimer = null; loadHistory(); }
    return;
  }
  state.filters = filters; state.historyPage = 1;
  clearTimeout(historyTimer); historyTimer = null;
  historyController?.abort(); historyGeneration++;
  const invalid = filters.from && filters.to && filters.from > filters.to;
  document.querySelector('#filter-error').textContent = invalid ? 'The end date must be on or after the start date.' : '';
  if (invalid) {
    state.history = { loading:false,error:'Choose a valid date range to view activity.',transactions:[],pagination:null,totals:null };
    renderHistoryResults(); return;
  }
  state.history = { ...state.history, loading:true,error:'' };
  renderHistoryResults();
  if (debounce) historyTimer = setTimeout(() => { historyTimer = null; loadHistory(); },180);
  else loadHistory();
}
export async function loadAccountRecent(accountId) {
  if (!state.user || !accountId || state.signingOut) return;
  const generation = ++accountGeneration,userId = state.user.id;
  accountController?.abort(); accountController = new AbortController();
  state.accountActivity = { accountId:String(accountId),loading:true,error:'',transactions:[] };
  const render = () => {
    const target = document.querySelector('#account-recent-results');
    if (state.route.page === 'accounts' && sameId(state.route.account,accountId) && target) {
      target.setAttribute('aria-busy',String(state.accountActivity.loading));
      target.innerHTML = accountRecentResults(accountId);
    }
  };
  render();
  try {
    const result = await api(`/transactions?${new URLSearchParams({accountId:String(accountId),page:'1',pageSize:'5'})}`,undefined,'GET',{signal:accountController.signal});
    if (generation !== accountGeneration || !validUser(userId)) return;
    state.accountActivity = { ...result,accountId:String(accountId),loading:false,error:'' }; render();
  } catch (error) {
    if (generation !== accountGeneration || error.status === -1 || !validUser(userId)) return;
    if (await recoverSession(error)) return;
    state.accountActivity = { accountId:String(accountId),loading:false,error:error.message,transactions:[] }; render();
  }
}
export async function openTransaction(id,{adminFallback = false} = {}) {
  if (!state.user) return;
  const generation = ++detailGeneration,userId = state.user.id;
  detailController?.abort(); detailController = new AbortController();
  dialog('Transaction details','<div class="loading-state" role="status"><p>Loading transaction details…</p></div>');
  modal.dataset.detailRequest = String(generation);
  try {
    const result = await api(`/transactions/${encodeURIComponent(id)}`,undefined,'GET',{signal:detailController.signal});
    if (generation !== detailGeneration || !validUser(userId) || !modal.open || modal.dataset.detailRequest !== String(generation)) return;
    ui.transactionDetails(result.transaction);
  } catch (error) {
    if (generation !== detailGeneration || error.status === -1 || !validUser(userId) || !modal.open || modal.dataset.detailRequest !== String(generation)) return;
    if (await recoverSession(error)) return;
    if (adminFallback && state.user.role === 'admin' && [403,404].includes(error.status)) return ui.navigateFraud?.();
    dialog('Transaction unavailable.',`<p class="modal-intro">${esc(error.message)}</p><div class="modal-actions"><button type="button" class="button secondary" data-action="close-dialog">Done</button><button type="button" class="button" data-retry-transaction="${esc(id)}">Try again</button></div>`);
  }
}
export function cancelDetailRead() { detailController?.abort(); detailGeneration++; }
export async function exportActivity(control) {
  const filters = state.route.page === 'activity' ? state.filters : {};
  validateFilters(filters);
  if (control) control.disabled = true;
  const userId = state.user.id;
  exportController?.abort(); exportController = new AbortController();
  try {
    const result = await api(`/transactions/export?${historyQuery({filters,paginated:false})}`,undefined,'GET',{signal:exportController.signal,responseType:'blob'});
    if (!validUser(userId)) return;
    const filename = result.disposition.match(/filename="?([^";]+)"?/i)?.[1] || `greenlink-activity-${singaporeDay()}.csv`;
    const url = URL.createObjectURL(result.blob),link = document.createElement('a');
    Object.assign(link,{href:url,download:filename.replace(/[^a-zA-Z0-9._-]/g,'-')});
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000); toast('Your matching account activity has been exported.');
  } catch (error) {
    if (error.status !== -1 && validUser(userId) && !await recoverSession(error)) toast(error.message);
  } finally { if (control?.isConnected) control.disabled = false; }
}
export function statementDialog() {
  const today = singaporeDay(),first = `${today.slice(0,7)}-01`;
  dialog('Download an account statement.',`<p class="modal-intro">Choose an account and inclusive date range in Singapore time (SGT). Preview the saved ledger, then print or save as PDF.</p><form id="statement-form"><div class="field"><label for="statement-account">Account</label><select id="statement-account" name="account" required>${allAccounts().map(a => `<option value="${esc(a.id)}" ${sameId(a.id,state.filters.account) ? 'selected' : ''}>${esc(a.name)} · ${esc(a.number)}${a.status === 'closed' ? ' (closed)' : ''}</option>`).join('')}</select></div><div class="form-row"><div class="field"><label for="statement-from">From date (SGT)</label><input id="statement-from" name="from" type="date" value="${esc(state.filters.from || first)}" required></div><div class="field"><label for="statement-to">To date (SGT)</label><input id="statement-to" name="to" type="date" value="${esc(state.filters.to || today)}" max="${today}" required></div></div><div class="error-message" role="alert"></div><button type="submit" class="button full">Preview statement ${icon('statement')}</button></form>`);
}
export async function generateStatement(form) {
  if (state.modalBusy) return;
  const values = Object.fromEntries(new FormData(form));
  if (!values.account) return formError(form,'Choose a savings account.');
  if (!values.from || !values.to || values.from > values.to) return formError(form,'Choose a valid date range.');
  if (values.to > singaporeDay()) return formError(form,'The end date cannot be in the future.');
  state.modalBusy = true; formBusy(form,true);
  const userId = state.user.id;
  try {
    const result = await api(`/statements?${new URLSearchParams({accountId:values.account,from:values.from,to:values.to})}`);
    if (!validUser(userId)) return;
    const s = result.statement;
    const rows = s.transactions.map(t => `<tr><td>${new Date(t.createdAt).toLocaleDateString('en-SG',{timeZone:'Asia/Singapore'})}</td><td>${esc(t.description)}<small>${esc(t.reference)}</small></td><td>${esc(statusLabel(t.status))}</td><td>${money(t.amountCents)}</td><td>${money(t.runningBalanceCents)}</td></tr>`).join('');
    state.modalBusy = false;
    dialog('Your account statement.',`<section class="print-statement"><div class="statement-heading">${brand()}<div><h2>Account statement</h2><p>${esc(s.period.from)} to ${esc(s.period.to)} · SGT</p></div></div><dl class="statement-identity"><div><dt>Account holder</dt><dd>${esc(s.business?.legalName || "Business profile not yet linked")}</dd></div><div><dt>Business registration</dt><dd>${esc(s.business?.registrationNumber || "Pending")}</dd></div><div><dt>Authorized operator</dt><dd>${esc(s.user.name)}</dd></div><div><dt>Account</dt><dd>${esc(s.account?.name || 'All accounts')} ${s.account ? `· ${esc(s.account.number)}` : ''}</dd></div><div><dt>Currency</dt><dd>${esc(s.currency)}</dd></div><div><dt>Generated (SGT)</dt><dd>${fullDate(s.generatedAt)}</dd></div></dl><div class="statement-balances"><div><span>Opening balance</span><strong>${money(s.openingBalanceCents)}</strong></div><div><span>Closing balance</span><strong>${money(s.closingBalanceCents)}</strong></div></div><div class="table-scroll"><table class="statement-table"><thead><tr><th>Date (SGT)</th><th>Description / reference</th><th>Status</th><th>Amount</th><th>Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No transactions in this date range.</td></tr>'}</tbody></table></div><p class="statement-note">Dates use Asia/Singapore. Only completed transactions affect balances. Pending or rejected requests are shown for your records. Republic Polytechnic C300 FYP prototype. This statement uses sample funds.</p></section><div class="modal-actions no-print"><button type="button" class="button secondary" data-action="close-dialog">Done</button><button type="button" class="button" data-action="print-statement">Print / save PDF ${icon('statement')}</button></div>`,{wide:true});
  } catch (error) { if (validUser(userId) && !await recoverSession(error)) formError(form,error.message); }
  finally { state.modalBusy = false; formBusy(form,false); }
}
