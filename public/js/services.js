import { app, modal, state, ui, api, esc, icon, money, fullDate, sameId, accountById, accountOptions, amountDecimal, parseAmount, dialog, closeDialog, formBusy, formError, toast, recoverSession, statusPill, statusLabel, authorizationField } from './core.js';
import { heading } from './views.js';
const inflight = new Map();
const backgroundReads = new Set();
async function backgroundGet(path) {
  const controller = new AbortController();
  backgroundReads.add(controller);
  try { return await api(path, undefined, 'GET', { signal: controller.signal }); }
  finally { backgroundReads.delete(controller); }
}
export function stopBackgroundReads() { for (const controller of backgroundReads) controller.abort(); backgroundReads.clear(); }
const unread = notification => !(notification.isRead || notification.readAt || notification.read);
let scheduleDraft = {}, pendingSchedule = null;

export function remoteContent(page, content) {
  const remote = state.remote[page];
  if (!remote || remote.loading) return `<div class="panel loading-state" role="status">${icon('leaf')}<p>Getting things ready…</p></div>`;
  if (remote.error) return `<div class="panel empty-state"><h2>We could not load this page.</h2><p>${esc(remote.error)}</p><button type="button" class="button" data-action="reload-page">Try again</button></div>`;
  return content(remote.data);
}
export async function loadNotifications({ renderPage = false } = {}) {
  if (!state.user || state.signingOut) return;
  const userId = state.user.id;
  try {
    const result = await backgroundGet('/notifications');
    if (!state.user || !sameId(state.user.id,userId)) return;
    state.notifications = result.notifications || [];
    state.unreadCount = result.unreadCount ?? state.notifications.filter(unread).length;
    state.remote.notifications = { data: result };
    const bell = app.querySelector('.notification-button');
    if (bell) {
      bell.classList.toggle('has-unread', state.unreadCount > 0);
      bell.setAttribute('aria-label', `Notifications${state.unreadCount ? `, ${state.unreadCount} unread` : ''}`);
      bell.innerHTML = icon('bell') + (state.unreadCount ? `<span class="notification-count">${Math.min(state.unreadCount,99)}</span>` : '');
    }
    const nav = app.querySelector('[data-nav="notifications"].nav-item');
    nav?.querySelector('.nav-count')?.remove();
    if (nav && state.unreadCount) nav.insertAdjacentHTML('beforeend', `<span class="nav-count">${state.unreadCount}</span>`);
    if (renderPage && state.route.page === 'notifications') ui.render();
  } catch (error) {
    if (error.status === -1 || !state.user || state.signingOut || !sameId(state.user.id,userId)) return;
    if (await recoverSession(error)) return;
    state.remote.notifications = { error: error.message };
    if (renderPage && state.route.page === 'notifications') ui.render();
  }
}
export async function loadExtras(page, { force = false } = {}) {
  if (!state.user || state.signingOut) return;
  if (page !== 'notifications') loadNotifications();
  if (page === 'notifications') return loadNotifications({ renderPage: true });
  if (page === 'activity') return ui.loadHistory?.();
  if (page === 'accounts' && state.route.account) return ui.loadAccountRecent?.(state.route.account);
  if (page === 'rules') ui.loadRuleAudit?.();
  const endpoints = { schedules: '/scheduled-payments', fraud: '/fraud/reviews', rules: '/fraud/rules' };
  if (!endpoints[page] || (['fraud','rules'].includes(page) && state.user.role !== 'admin')) return;
  const userId = state.user.id;
  const requestKey = `${userId}:${page}`;
  if (inflight.has(requestKey)) return inflight.get(requestKey);
  if (!state.remote[page]?.data || force) {
    state.remote[page] = { loading: true };
    if (state.route.page === page) ui.render();
  }
  const pending = (async () => {
    try {
      const result = await backgroundGet(endpoints[page]);
      if (!state.user || !sameId(state.user.id,userId)) return;
      state.remote[page] = { data: result };
      if (page === 'fraud') {
        try { const result = await backgroundGet('/fraud/model'); state.remote.model = { data: result.model || result }; }
        catch (error) { state.remote.model = { error: error.message }; }
      }
      if (state.route.page === page && !modal.open) ui.render();
    } catch (error) {
      if (error.status === -1 || !state.user || state.signingOut || !sameId(state.user.id,userId)) return;
      if (await recoverSession(error)) return;
      state.remote[page] = { error: error.message };
      if (state.route.page === page) ui.render();
    } finally { inflight.delete(requestKey); }
  })();
  inflight.set(requestKey,pending);
  return pending;
}
export function notificationsPage() {
  return heading('A little peace of mind.', 'Account updates and payment decisions, kept in one place.', `<button type="button" class="button secondary" data-action="notifications-read-all" ${state.unreadCount ? '' : 'disabled'}>${icon('check')}<span>Mark all as read</span></button>`) + remoteContent('notifications', () => {
    const notifications = state.notifications;
    return `<section class="panel notification-list" aria-label="Notifications">${notifications.length ? notifications.map(n => `<article class="notification-item ${unread(n) ? 'unread' : ''}"><span class="quick-action-icon">${icon(n.type?.includes('fraud') || n.type?.includes('review') ? 'shield' : 'bell')}</span><div><h2>${esc(n.title || 'Account update')}</h2><p>${esc(n.message || n.body)}</p><time datetime="${esc(n.createdAt)}">${fullDate(n.createdAt)}</time><div class="notification-actions">${n.type === 'review.requested' && state.user.role === 'admin' ? `<button type="button" class="text-button" data-nav="fraud">Review request ${icon('arrow')}</button>` : n.transactionId || n.data?.transactionId ? `<button type="button" class="text-button" data-notification-transaction="${esc(n.transactionId || n.data.transactionId)}">View transaction ${icon('arrow')}</button>` : ''}${unread(n) ? `<button type="button" class="text-button" data-read-notification="${esc(n.id)}">Mark as read</button>` : '<span class="read-label">Read</span>'}</div></div></article>`).join('') : `<div class="empty-state">${icon('bell')}<h2>All quiet for now.</h2><p>Payment confirmations and security updates will appear here.</p></div>`}</section>`;
  });
}
export async function markNotification(id) {
  await api(`/notifications/${encodeURIComponent(id)}`, { read: true }, 'PATCH');
  await loadNotifications({ renderPage: true });
}
export function schedulesPage() {
  return heading('A little planning ahead.', 'Set a future transfer or bill payment and keep track of its progress.', `<button type="button" class="button" data-action="new-schedule">${icon('plus')}<span>Schedule payment</span></button>`) + `<div class="notice schedule-notice">Scheduled requests do not move or reserve money now. On the due date, available funds and fraud checks determine whether they complete, await review or fail.</div>` + remoteContent('schedules', result => {
    const schedules = result.schedules || [];
    return `<section class="panel schedules-panel"><div class="section-heading"><h2>Your scheduled payments</h2><button type="button" class="text-button" data-action="reload-page">Refresh ${icon('arrow')}</button></div>${schedules.length ? `<div class="schedule-list">${schedules.map(s => `<article class="schedule-card"><div class="schedule-card-heading"><span class="quick-action-icon">${icon(s.type === 'bill' ? 'bill' : 'transfer')}</span><div><h3>${esc(s.type === 'bill' ? s.billerName || 'Bill payment' : s.description || 'Scheduled transfer')}</h3><p>${esc(s.fromAccountName || accountById(s.fromAccountId)?.name || 'Savings account')} ${s.toAccountNumber ? `→ ${esc(s.toAccountNumber)}` : ''}</p></div>${statusPill(s.status)}</div><div class="schedule-card-body"><strong>${money(s.amountCents)}</strong><span>${esc(s.frequency === 'once' ? 'One time' : s.frequency === 'weekly' ? 'Every week' : 'Every month')}</span><span>${s.status === 'active' ? 'Next (SGT): ' : 'Scheduled (SGT): '}${fullDate(s.nextRunAt || s.scheduledAt)}</span></div>${s.lastRunAt ? `<p class="schedule-last-run">Last run (SGT): ${fullDate(s.lastRunAt)} · ${s.lastStatus ? esc(statusLabel(s.lastStatus)) : ''}${s.lastError ? ` · ${esc(s.lastError)}` : ''}</p>` : ''}<div class="schedule-card-actions"><button type="button" class="text-button" data-schedule-detail="${esc(s.id)}">View details ${icon('arrow')}</button>${s.status === 'active' ? `<button type="button" class="text-button danger-text" data-cancel-schedule="${esc(s.id)}">Cancel schedule</button>` : ''}</div></article>`).join('')}</div>` : `<div class="empty-state">${icon('calendar')}<h2>Make room for tomorrow.</h2><p>You have no scheduled payments yet.</p><button type="button" class="button" data-action="new-schedule">Schedule a payment</button></div>`}</section>`;
  });
}
function localDateTime(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`; }
export function scheduleDialog({ reset = true } = {}) {
  if (reset) scheduleDraft = {};
  const bill = scheduleDraft.type === 'bill', tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); tomorrow.setHours(9,0,0,0);
  dialog('Plan a payment.', `<p class="modal-intro">Times are shown in your browser’s local timezone (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}). The server stores the due time in UTC.</p><form id="schedule-form"><div class="field"><label for="schedule-type">Payment type</label><select id="schedule-type" name="type"><option value="transfer" ${bill ? '' : 'selected'}>Internal transfer</option><option value="bill" ${bill ? 'selected' : ''}>Bill payment</option></select></div><div class="field"><label for="schedule-from">From account</label><select id="schedule-from" name="fromAccountId" required>${accountOptions(scheduleDraft.fromAccountId)}</select></div>${bill ? `<div class="field"><label for="schedule-biller">Biller</label><select id="schedule-biller" name="billerId" required><option value="">Choose a biller</option>${state.data.billers.map(b => `<option value="${esc(b.id)}" ${b.id === scheduleDraft.billerId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div><div class="field"><label for="schedule-reference">Bill reference</label><input id="schedule-reference" name="reference" value="${esc(scheduleDraft.reference)}" minlength="3" maxlength="64" required></div>` : `<div class="field"><label for="schedule-recipient">Recipient account number</label><input id="schedule-recipient" name="toAccountNumber" value="${esc(scheduleDraft.toAccountNumber)}" placeholder="10-digit Greenlink account number" inputmode="numeric" maxlength="20" required></div>`}<div class="field"><label for="schedule-amount">Amount (SGD)</label><input id="schedule-amount" name="amount" value="${esc(scheduleDraft.amount)}" placeholder="0.00" inputmode="decimal" maxlength="15" required></div><div class="field"><label for="schedule-date">First payment date and time</label><input id="schedule-date" name="scheduledAt" type="datetime-local" value="${esc(scheduleDraft.scheduledAt || localDateTime(tomorrow))}" min="${localDateTime(new Date(Date.now()+60000))}" required></div><div class="field"><label for="schedule-frequency">Repeat</label><select id="schedule-frequency" name="frequency">${[['once','One time'],['weekly','Every week'],['monthly','Every month']].map(([key,label]) => `<option value="${key}" ${key === scheduleDraft.frequency ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label for="schedule-description">Description (optional)</label><input id="schedule-description" name="description" value="${esc(scheduleDraft.description)}" maxlength="100"></div><div class="error-message" role="alert"></div><button type="submit" class="button full">Review schedule ${icon('arrow')}</button></form>`);
  if (bill) modal.querySelector("#schedule-description").closest(".field").remove();
}
export function changeScheduleType(form) { scheduleDraft = Object.fromEntries(new FormData(form)); scheduleDialog({ reset: false }); modal.querySelector('#schedule-type').focus(); }
export function reviewSchedule(form) {
  const values = Object.fromEntries(new FormData(form)), cents = parseAmount(values.amount), source = accountById(values.fromAccountId);
  if (!source) throw new Error('Choose an active savings account.');
  const due = new Date(values.scheduledAt);
  if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) throw new Error('Choose a future date and time.');
  const bill = values.type === 'bill';
  values.description = String(values.description || '').trim();
  if (!bill && values.description.length > 100) throw new Error('Use a transfer note of 100 characters or fewer.');
  if (bill) {
    values.reference = String(values.reference || '').trim();
    if (values.reference.length < 3 || values.reference.length > 64) throw new Error('Enter a bill reference of 3?64 characters.');
  }
  if (!bill) {
    values.toAccountNumber = String(values.toAccountNumber).replace(/[\s-]/g,'');
    if (!/^\d{10}$/.test(values.toAccountNumber)) throw new Error('Enter a 10-digit Greenlink account number.');
    if (values.toAccountNumber === source.number) throw new Error('Choose a different destination account.');
  }
  const biller = state.data.billers.find(b => b.id === values.billerId);
  if (bill && !biller) throw new Error('Choose a valid biller.');
  scheduleDraft = values;
  const payload = { ...values, amount: amountDecimal(cents), scheduledAt: due.toISOString() };
  const signature = JSON.stringify(payload), previous = pendingSchedule;
  pendingSchedule = { signature, payload: { ...payload, requestId: previous?.signature === signature ? previous.payload.requestId : crypto.randomUUID() } };
  dialog('Review your scheduled payment.', `<p class="modal-intro">No money moves when you create this schedule.</p><dl class="review-list"><div><dt>From</dt><dd>${esc(source.name)}</dd></div><div><dt>To</dt><dd>${esc(bill ? biller.name : values.toAccountNumber)}</dd></div><div><dt>Amount</dt><dd class="review-amount">${money(cents)}</dd></div><div><dt>First payment (SGT)</dt><dd>${fullDate(due.toISOString())}</dd></div><div><dt>Repeat</dt><dd>${esc(values.frequency === 'once' ? 'One time' : values.frequency === 'weekly' ? 'Every week' : 'Every month')}</dd></div></dl><form id="confirm-schedule-form"><div class="error-message" role="alert"></div>${authorizationField()}<div class="notice">Funds and security checks run at the due time. You can cancel future runs from Scheduled payments.</div><div class="modal-actions"><button type="button" class="button secondary" data-action="edit-schedule">Edit details</button><button type="submit" class="button">Create schedule ${icon('calendar')}</button></div></form>`);
}
export async function confirmSchedule(form) {
  if (state.modalBusy || !pendingSchedule) return;
  state.modalBusy = true; formBusy(form,true);
  try {
    await api('/scheduled-payments', { ...pendingSchedule.payload, authorizationPassword: form.elements.authorizationPassword.value });
    form.elements.authorizationPassword.value = '';
    pendingSchedule = null; scheduleDraft = {}; state.modalBusy = false; closeDialog();
    state.remote.schedules = undefined;
    if (state.route.page !== 'schedules') { state.route = { page: 'schedules', account: '' }; history.pushState({},'','/scheduled-payments'); }
    await loadExtras('schedules',{force:true});
    toast('Scheduled payment created. No funds have moved.');
    loadNotifications();
  } catch (error) {
    form.elements.authorizationPassword.value = '';
    if (!await recoverSession(error)) formError(form,error.status === 0 ? 'The response was interrupted. Retry this confirmation to check the same schedule safely.' : error.message);
  } finally { state.modalBusy = false; formBusy(form,false); }
}
export function scheduleDetails(id) {
  const s = state.remote.schedules?.data?.schedules.find(s => sameId(s.id,id));
  if (!s) return;
  dialog('Scheduled payment details', `<dl class="review-list"><div><dt>Status</dt><dd>${statusPill(s.status)}</dd></div><div><dt>From</dt><dd>${esc(s.fromAccountName)}</dd></div><div><dt>To</dt><dd>${esc(s.type === 'bill' ? s.billerName : s.toAccountNumber)}</dd></div><div><dt>Amount</dt><dd class="review-amount">${money(s.amountCents)}</dd></div><div><dt>Next payment (SGT)</dt><dd>${s.status === 'active' ? fullDate(s.nextRunAt || s.scheduledAt) : 'No future run'}</dd></div><div><dt>Repeat</dt><dd>${s.frequency === "once" ? "One time" : s.frequency === "weekly" ? "Every week" : "Every month"}</dd></div>${s.reference ? `<div><dt>Bill reference</dt><dd>${esc(s.reference)}</dd></div>` : ''}${s.description ? `<div><dt>Description</dt><dd>${esc(s.description)}</dd></div>` : ''}</dl><section class="schedule-runs"><h3>Run history</h3>${s.runs?.length ? `<ul>${s.runs.map(run => `<li><div><strong>${fullDate(run.dueAt)}</strong>${statusPill(run.status)}</div>${run.error ? `<p>${esc(run.error)}</p>` : ''}${run.transactionId ? `<button type="button" class="text-button" data-transaction="${esc(run.transactionId)}">View transaction</button>` : ''}</li>`).join('')}</ul>` : '<p>This schedule has not run yet.</p>'}</section><div class="notice">Only completed runs affect your balance. Scheduled or held requests do not reserve funds.</div><button type="button" class="button full" data-action="close-dialog">Done</button>`);
}
export function cancelScheduleDialog(id) {
  const schedule = state.remote.schedules?.data?.schedules.find(s => sameId(s.id,id));
  if (!schedule || schedule.status !== 'active') return;
  dialog('Cancel this scheduled payment?', `<p class="modal-intro">Future runs will be cancelled. Any request already processed remains in your transaction history.</p><dl class="review-list"><div><dt>Amount</dt><dd>${money(schedule.amountCents)}</dd></div><div><dt>Next payment (SGT)</dt><dd>${fullDate(schedule.nextRunAt || schedule.scheduledAt)}</dd></div></dl><form id="cancel-schedule-form" data-id="${esc(id)}"><div class="error-message" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-dialog">Keep schedule</button><button type="submit" class="button danger">Cancel schedule</button></div></form>`);
}
export async function cancelSchedule(form) {
  if (state.modalBusy) return;
  state.modalBusy = true; formBusy(form,true);
  try {
    await api(`/scheduled-payments/${encodeURIComponent(form.dataset.id)}`,{},'DELETE');
    state.modalBusy = false; closeDialog();
    await loadExtras('schedules',{force:true});
    toast('Future payments cancelled.'); loadNotifications();
  } catch (error) { if (!await recoverSession(error)) formError(form,error.message); }
  finally { state.modalBusy = false; formBusy(form,false); }
}
// Open an assistant-prepared schedule in the existing review/authorization flow.
export function openScheduleDraft(draft={}) {
  scheduleDraft={...draft,type:draft.type==='bill'?'bill':'transfer'};
  if(draft.scheduledAt){ const due=new Date(draft.scheduledAt); scheduleDraft.scheduledAt=Number.isFinite(due.getTime())?localDateTime(due):''; }
  if(!['once','weekly','monthly'].includes(scheduleDraft.frequency))scheduleDraft.frequency='once';
  scheduleDialog({reset:false});
}
