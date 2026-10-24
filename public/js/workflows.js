import { app, modal, state, ui, api, esc, icon, brand, money, fullDate, sameId, allAccounts, accountById, amountDecimal, parseAmount, formBusy, formError, dialog, closeDialog, toast, loadDashboard, recoverSession, navigate, routeUrl, statusPill, statusLabel, authorizationField } from './core.js';

export function accountNameDialog(id = '') {
  const account = id ? accountById(id) : null;
  dialog(account ? 'Rename business savings account.' : 'Open a business savings account.', `<p class="modal-intro">${account ? `Account ${esc(account.number)} · SGD` : 'Name this account for its business purpose. It starts with a zero balance.'}</p><form id="account-form" data-id="${esc(id)}"><div class="field"><label for="account-name">Account name</label><input id="account-name" name="name" value="${esc(account?.name)}" placeholder="Operating funds" maxlength="40" minlength="2" required></div><div class="error-message" role="alert"></div><button type="submit" class="button full">${account ? 'Save account name' : 'Open business savings account'} ${icon(account ? 'check' : 'plus')}</button></form>`);
  modal.querySelector('input').focus();
}
export function closeAccountDialog(id) {
  const account = accountById(id);
  if (!account || account.balanceCents !== 0 || state.data.accounts.length < 2) return;
  dialog('Close this business savings account?', `<p class="modal-intro">The account will close immediately. Its past activity will still be available in your transaction history.</p><dl class="review-list"><div><dt>Account</dt><dd>${esc(account.name)}</dd></div><div><dt>Account number</dt><dd>${esc(account.number)}</dd></div><div><dt>Balance</dt><dd>${money(account.balanceCents)}</dd></div></dl><form id="close-account-form" data-id="${esc(id)}"><div class="error-message" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-dialog">Keep account</button><button type="submit" class="button danger">Close account</button></div></form>`);
}
export async function authenticate(values, demo = false) {
  if (state.authBusy) return;
  if (values.otp && values.recoveryCode) return formError(document.querySelector('#auth-form'), 'Enter either an authenticator code or a recovery code.');
  if (!values.otp) delete values.otp;
  if (!values.recoveryCode) delete values.recoveryCode;
  state.authBusy = true;
  const form = document.querySelector('#auth-form');
  app.querySelectorAll('.auth-form-wrap button').forEach(button => { button.disabled = true; });
  form.setAttribute('aria-busy', 'true');
  try {
    if (!state.csrf) await api('/session');
    const result = await api(`/auth/${demo ? 'login' : state.authMode}`, values);
    state.user = result.user;
    state.authNotice = '';
    const destination = state.intendedRoute || (['/login','/register','/'].includes(location.pathname) ? { page: 'overview', account: '' } : state.route);
    state.intendedRoute = null;
    state.route = destination;
    if (destination.page === 'activity') state.filters.account = destination.account;
    history.replaceState({}, '', routeUrl(destination));
    if (await loadDashboard()) ui.loadExtras?.(destination.page);
    app.querySelector('h1')?.focus();
  } catch (error) {
    if (error.mfaRequired) {
      if (demo) { form.elements.email.value = values.email; form.elements.password.value = values.password; }
      const details = form.querySelector('#auth-factor-details');
      if (details) details.open = true;
      const factor = values.recoveryCode ? form.elements.recoveryCode : form.elements.otp;
      if (factor) factor.value = '';
      formError(form, error.message);
      factor?.focus();
      return;
    }
    if (error.status === 403) {
      try { await api('/session'); error.message = 'Your session was refreshed. Please sign in again.'; } catch { /* Keep the transport error. */ }
    }
    formError(form, error.message);
  } finally {
    state.authBusy = false;
    if (form.isConnected) { form.setAttribute('aria-busy', 'false'); app.querySelectorAll('.auth-form-wrap button').forEach(button => { button.disabled = false; }); }
  }
}
export async function submitAccount(form, closing = false) {
  if (state.modalBusy) return;
  state.modalBusy = true;
  formBusy(form, true);
  const id = form.dataset.id;
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api(`/accounts${id ? `/${encodeURIComponent(id)}` : ''}`, closing ? {} : values, closing ? 'DELETE' : id ? 'PATCH' : 'POST');
    if (closing) {
      state.data.accounts = state.data.accounts.filter(a => !sameId(a.id, id));
      state.data.closedAccounts = [...(state.data.closedAccounts ?? []), result.account];
    } else if (id) state.data.accounts = state.data.accounts.map(a => sameId(a.id, id) ? result.account : a);
    else state.data.accounts.push(result.account);
    state.modalBusy = false;
    closeDialog();
    await loadDashboard({ render: false });
    if (state.data) navigate('accounts', { account: closing ? '' : result.account.id });
    toast(closing ? 'Savings account closed. Its history is still available.' : id ? 'Account name updated.' : 'Your new savings account is ready.');
  } catch (error) { if (!await recoverSession(error)) formError(form, error.message); }
  finally { state.modalBusy = false; formBusy(form, false); }
}
export function reviewMoney(form) {
  const type = form.dataset.type, bill = type === 'payments';
  const values = Object.fromEntries(new FormData(form));
  state.moneyDraft[type] = values;
  const source = accountById(values.fromAccountId);
  if (!source || source.status !== 'active') throw new Error('Choose an active savings account.');
  const cents = parseAmount(values.amount);
  if (cents > source.balanceCents) throw new Error('The amount exceeds your available balance.');
  values.amount = amountDecimal(cents);
  const biller = state.data.billers.find(item => sameId(item.id, values.billerId));
  let recipient;
  if (bill) {
    if (!biller) throw new Error('Choose a biller to continue.');
    values.reference = String(values.reference ?? '').trim();
    if (values.reference.length < 3 || values.reference.length > 64) throw new Error('Use a bill reference of 3–60 characters.');
    recipient = biller.name;
  } else {
    values.toAccountNumber = String(values.toAccountNumber ?? '').replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(values.toAccountNumber)) throw new Error('Enter a 10-digit GLDB business account number.');
    if (values.toAccountNumber === source.number) throw new Error('Choose a different destination account.');
    const own = state.data.accounts.find(a => a.number === values.toAccountNumber);
    recipient = own ? own.name : state.demoAvailable && values.toAccountNumber === '1020002001' ? 'Harbour Supplies Pte. Ltd. (demo)' : 'GLDB business account';
    values.description = String(values.description ?? '').trim();
    if (values.description.length > 100) throw new Error('Use a transfer note of 100 characters or fewer.');
  }
  const payload = bill ? { fromAccountId: values.fromAccountId, billerId: values.billerId, reference: values.reference, amount: values.amount } : { fromAccountId: values.fromAccountId, toAccountNumber: values.toAccountNumber, amount: values.amount, description: values.description };
  const signature = JSON.stringify({ type, ...payload }), previous = state.pendingMoney;
  state.pendingMoney = { type, payload: { ...payload, requestId: previous?.signature === signature ? previous.payload.requestId : crypto.randomUUID() }, signature, cents, source: { ...source }, recipient };
  dialog('Take a moment to review.', `<p class="modal-intro">${bill ? 'Bill payment' : 'Internal transfer'} · Sample funds</p><dl class="review-list"><div><dt>From</dt><dd>${esc(source.name)}<small>${esc(source.number)}</small></dd></div><div><dt>To</dt><dd>${esc(recipient)}${!bill ? `<small>${esc(values.toAccountNumber)}</small>` : ''}</dd></div>${bill ? `<div><dt>Bill reference</dt><dd>${esc(values.reference)}</dd></div>` : values.description ? `<div><dt>Description</dt><dd>${esc(values.description)}</dd></div>` : ''}<div><dt>Amount</dt><dd class="review-amount">${money(cents)}</dd></div><div><dt>Fee</dt><dd>${money(0)}</dd></div><div><dt>Balance if completed</dt><dd>${money(source.balanceCents - cents)}</dd></div></dl><form id="confirm-money-form"><div class="error-message" role="alert"></div>${authorizationField()}<div class="notice">Fraud checks run when you confirm. A flagged request may be held for review or rejected; funds move only on completion.</div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-dialog">Edit details</button><button type="submit" class="button">Confirm ${bill ? 'payment' : 'transfer'} ${icon('arrow')}</button></div></form>`);
}
export function riskExplanation(risk, { admin = false } = {}) {
  if (!risk) return '';
  const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];
  return `<section class="risk-explanation"><h3>${admin ? 'Risk assessment' : 'Security check'}</h3>${admin ? `<div class="risk-score"><strong>${esc(risk.score)}</strong><span>risk score · ${esc(risk.decision)}</span></div>` : ''}${admin && risk.provider !== 'ollama' ? '<p class="notice">Archived assessment from the retired model. The original result is preserved for audit.</p>' : ''}${reasons.length ? `<ul>${reasons.map(reason => `<li>${esc(typeof reason === 'string' ? reason : reason.message)}${admin && risk.provider !== 'ollama' && reason.contribution !== undefined ? `<small>Contribution: ${esc(reason.contribution)}</small>` : ''}</li>`).join('')}</ul>` : '<p>No elevated risk signals were recorded.</p>'}${admin ? `<p class="model-version">Model ${esc(risk.modelVersion)} · Rules ${esc(risk.ruleVersion)}</p>` : ''}</section>`;
}
export function transactionDetails(transaction, receipt = null) {
  const source = accountById(transaction.accountId) || receipt?.source, complete = transaction.status === 'completed', held = transaction.status === 'pending_review';
  const bill = transaction.type === 'bill', noun = bill ? 'Bill payment' : 'Transfer';
  const title = receipt ? complete ? `${noun} complete.` : held ? `${noun} awaiting review.` : `${noun} rejected.` : 'Transaction details';
  const review = transaction.review || transaction.risk?.review;
  dialog(title, `${receipt ? `<div class="receipt-success ${complete ? '' : held ? 'held' : 'rejected'}">${icon(complete ? 'check' : 'shield')}<p>${complete ? 'Your request has completed.' : held ? 'No funds have moved. An independent reviewer will assess this request.' : 'No funds have moved. This request was not completed.'}</p></div>` : ''}<div class="receipt-amount ${transaction.amountCents > 0 ? 'incoming' : ''}">${transaction.amountCents > 0 ? '+' : ''}${money(transaction.amountCents)}</div><p class="receipt-description">${esc(transaction.description)}</p><dl class="review-list"><div><dt>Status</dt><dd>${statusPill(transaction.status)}</dd></div><div><dt>${transaction.amountCents > 0 ? 'Received into' : 'From account'}</dt><dd>${esc(transaction.accountName || source?.name || 'Savings account')}<small>${esc(transaction.accountNumber || source?.number || '')}</small></dd></div><div><dt>${transaction.amountCents > 0 ? 'From' : 'To'}</dt><dd>${esc(transaction.counterparty || receipt?.recipient || '—')}</dd></div><div><dt>Requested</dt><dd>${fullDate(transaction.requestedAt || transaction.createdAt)}</dd></div>${transaction.completedAt ? `<div><dt>Completed</dt><dd>${fullDate(transaction.completedAt)}</dd></div>` : ""}<div><dt>${bill ? 'Bill reference' : 'Reference'}</dt><dd class="reference-value">${esc(transaction.reference || '—')}</dd></div><div><dt>Transaction ID</dt><dd class="reference-value">${esc(transaction.id)}</dd></div>${transaction.authorization?.authorizedAt ? `<div><dt>Authorized</dt><dd>${fullDate(transaction.authorization.authorizedAt)}<small>Current password verified</small></dd></div>` : ''}${review ? `<div><dt>Review decision</dt><dd>${esc(review.decision || "")}<small>${esc(review.reason || "")}</small>${review.reviewedBy ? `<small>Reviewed by ${esc(review.reviewedBy.name)}</small>` : ""}${review.reviewedAt ? `<small>${fullDate(review.reviewedAt)}</small>` : ""}</dd></div>` : ''}</dl>${riskExplanation(transaction.risk, { admin: state.user.role === 'admin' })}${!complete ? '<div class="notice">This request has not changed the account balance.</div>' : ''}<div class="modal-actions"><button type="button" class="button secondary" data-action="close-dialog">Done</button>${receipt ? `<button type="button" class="button" data-nav="activity">View activity ${icon('arrow')}</button>` : ''}</div>`);
}
export async function confirmMoney(form) {
  if (state.modalBusy || !state.pendingMoney) return;
  state.modalBusy = true;
  formBusy(form, true);
  const pending = state.pendingMoney, password = form.elements.authorizationPassword.value;
  try {
    const result = await api(pending.type === 'payments' ? '/payments' : '/transfers', { ...pending.payload, authorizationPassword: password }, 'POST', {timeoutMs:75000});
    form.elements.authorizationPassword.value = '';
    state.moneyDraft[pending.type] = {};
    state.pendingMoney = null;
    const synced = await loadDashboard({ render: false });
    state.modalBusy = false;
    if (!state.data) return;
    if (!synced) state.refreshError = 'Your request was recorded. Refresh balances to see the latest activity.';
    ui.render();
    transactionDetails(result.transaction, pending);
    ui.loadNotifications?.();
  } catch (error) {
    form.elements.authorizationPassword.value = '';
    if (!await recoverSession(error)) formError(form, error.status === 0 ? 'Confirmation was interrupted. Retry this confirmation to check the same transaction safely; it will not be charged twice.' : error.message);
  } finally { state.modalBusy = false; formBusy(form, false); }
}
export { updateHistoryFilters, exportActivity, statementDialog, generateStatement } from './history.js';
