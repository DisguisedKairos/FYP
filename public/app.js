import { app, modal, state, ui, pages, api, esc, icon, money, sameId, accountById, transactionById, emptyFilters, formError, dialog, closeDialog, clearBankingState, toast, loadDashboard, recoverSession, routeFromLocation, routeUrl, navigate, mobileQuery } from './js/core.js';
import { auth, render, connectionError, extraViews, updateMobileNavigation, historyResults } from './js/views.js';
import { accountNameDialog, closeAccountDialog, authenticate, submitAccount, reviewMoney, transactionDetails, confirmMoney, updateHistoryFilters, exportActivity, statementDialog, generateStatement } from './js/workflows.js';
import { loadExtras, loadNotifications, stopBackgroundReads, notificationsPage, schedulesPage, markNotification, scheduleDialog, changeScheduleType, reviewSchedule, confirmSchedule, scheduleDetails, cancelScheduleDialog, cancelSchedule } from './js/services.js';
import { fraudPage, rulesPage, ruleDialog, saveRule, reviewDialog, submitReview } from './js/admin.js';

Object.assign(ui,{ render, auth, connectionError, loadExtras, loadNotifications });
Object.assign(extraViews,{ schedules: schedulesPage, notifications: notificationsPage, fraud: fraudPage, rules: rulesPage });
let searchTimer;

function switchAuth() {
  state.authMode = state.authMode === 'login' ? 'register' : 'login';
  state.authNotice = '';
  history.pushState({},'',state.authMode === 'register' ? '/register' : '/login');
  auth({focus:true});
}
async function signOut(control) {
  control.disabled = true;
  state.signingOut = true;
  stopBackgroundReads();
  try {
    await api('/auth/logout',{});
    clearBankingState();
    state.intendedRoute = null; state.authMode = 'login'; state.authNotice = 'You have signed out.';
    history.pushState({},'','/login');
    auth({focus:true});
  } finally {
    state.signingOut = false;
    if (state.user) loadExtras(state.route.page,{force:true});
  }
}
function helpDialog() {
  dialog('A little guidance.', `<div class="detail-section"><h3>Your savings</h3><p>Open an account, check its balance and history, or rename it to match a goal. Empty accounts can be closed while one stays open.</p></div><div class="detail-section"><h3>Move money and pay bills</h3><p>Review the recipient, amount and reference, then authorize with your current password. Fraud checks can complete, hold or reject a request. Only completed requests change balances.</p></div><div class="detail-section"><h3>Plan ahead</h3><p>Schedule a future transfer or bill. No money is reserved now. Due payments run while the local Node.js server is running and catch up when it restarts.</p></div><div class="detail-section"><h3>Keep a record</h3><p>Search activity by payee, account, status or date. Export matching transactions as CSV or print an account statement to PDF.</p></div><div class="notice">This is an educational project using sample funds. No real transfers or bill payments are made.</div>`);
}

// One delegated listener per event keeps rendered views free of inline handlers.
document.addEventListener('submit',async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'history-filters') return updateHistoryFilters(form);
  if (!form.reportValidity()) return;
  try {
    switch (form.id) {
      case 'auth-form': {
        const values = Object.fromEntries(new FormData(form));
        if (state.authMode === 'register') {
          if (values.password !== values.confirmPassword) throw new Error('The passwords do not match.');
          if (!/[A-Z]/.test(values.password) || !/[a-z]/.test(values.password) || !/\d/.test(values.password)) throw new Error('Use uppercase, lowercase and a number in your password.');
        }
        await authenticate(values); break;
      }
      case 'account-form': await submitAccount(form); break;
      case 'close-account-form': await submitAccount(form,true); break;
      case 'money-form': reviewMoney(form); break;
      case 'confirm-money-form': await confirmMoney(form); break;
      case 'statement-form': generateStatement(form); break;
      case 'schedule-form': reviewSchedule(form); break;
      case 'confirm-schedule-form': await confirmSchedule(form); break;
      case 'cancel-schedule-form': await cancelSchedule(form); break;
      case 'rule-form': await saveRule(form); break;
      case 'review-form': await submitReview(form); break;
    }
  } catch (error) { if (!await recoverSession(error)) formError(form,error.message); }
});

document.addEventListener('click',async event => {
  const control = event.target.closest('button, a[data-nav], a[data-account], [data-action]');
  if (!control || control.disabled) return;
  if (control.tagName === 'A' && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
  if (control.dataset.nav) { event.preventDefault(); return navigate(control.dataset.nav,{account:control.dataset.filterAccount || ''}); }
  if (control.dataset.account) { event.preventDefault(); return navigate('accounts',{account:control.dataset.account}); }
  if (control.dataset.transaction) { const transaction = transactionById(control.dataset.transaction); return transaction ? transactionDetails(transaction) : toast('This transaction is not in your account history.'); }
  if (control.dataset.biller) { state.moneyDraft.payments.billerId = control.dataset.biller; navigate('payments'); document.querySelector('#reference')?.focus(); return; }
  try {
    if (control.dataset.readNotification) { control.disabled = true; await markNotification(control.dataset.readNotification); return; }
    if (control.dataset.notificationTransaction) {
      const id = control.dataset.notificationTransaction;
      await loadDashboard({render:false});
      const transaction = transactionById(id);
      if (transaction) transactionDetails(transaction);
      else if (state.user?.role === 'admin') navigate('fraud');
      else toast('This transaction is unavailable. Refresh account activity to try again.');
      return;
    }
    if (control.dataset.scheduleDetail) return scheduleDetails(control.dataset.scheduleDetail);
    if (control.dataset.cancelSchedule) return cancelScheduleDialog(control.dataset.cancelSchedule);
    if (control.dataset.editRule) return ruleDialog(control.dataset.editRule);
    if (control.dataset.reviewTransaction) return reviewDialog(control.dataset.reviewTransaction);
    switch (control.dataset.action) {
      case 'auth-switch': switchAuth(); break;
      case 'password': {
        const input = document.getElementById(control.dataset.input), show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        control.setAttribute('aria-label',`${show ? 'Hide' : 'Show'} ${control.dataset.input === 'confirm-password' ? 'confirmation password' : 'password'}`);
        control.setAttribute('aria-pressed',String(show)); break;
      }
      case 'demo': await authenticate({email:'alex@evergreen.demo',password:'Evergreen123!'},true); break;
      case 'logout': await signOut(control); break;
      case 'balance': state.hiddenBalance = !state.hiddenBalance; render(); app.querySelector('[data-action="balance"]').focus(); break;
      case 'menu-open': state.menuOpen = true; updateMobileNavigation({focus:true}); break;
      case 'menu-close': state.menuOpen = false; updateMobileNavigation({focus:true}); break;
      case 'close-dialog': closeDialog(); break;
      case 'new-account': accountNameDialog(); break;
      case 'rename-account': accountNameDialog(control.dataset.id); break;
      case 'close-account-review': closeAccountDialog(control.dataset.id); break;
      case 'account-transfer': state.moneyDraft.transfers.fromAccountId = control.dataset.id; navigate('transfers'); break;
      case 'history-prev': state.historyPage = Math.max(1,state.historyPage-1); document.querySelector('#history-results').innerHTML = historyResults(); document.querySelector('[data-action="history-next"]')?.focus(); break;
      case 'history-next': state.historyPage += 1; document.querySelector('#history-results').innerHTML = historyResults(); document.querySelector('[data-action="history-prev"]')?.focus(); break;
      case 'clear-filters': state.filters = emptyFilters(); state.historyPage = 1; state.route.account = ''; history.replaceState({},'','/activity'); render(); document.querySelector('#transaction-search').focus(); break;
      case 'export': exportActivity(); break;
      case 'statement': statementDialog(); break;
      case 'print-statement': window.print(); break;
      case 'new-schedule': scheduleDialog(); break;
      case 'edit-schedule': scheduleDialog({reset:false}); break;
      case 'notifications-read-all': control.disabled = true; await markNotification('all'); break;
      case 'reload-page': control.disabled = true; await loadExtras(state.route.page,{force:true}); break;
      case 'refresh': if (!state.refreshing) { state.refreshing = true; control.disabled = true; await loadDashboard(); state.refreshing = false; } break;
      case 'reload': location.reload(); break;
      case 'profile': dialog('Your profile', `<div class="profile-card"><span class="avatar">${esc(state.user.name[0])}</span><div><h3>${esc(state.user.name)}</h3><p>${esc(state.user.email)}</p></div></div><dl class="review-list"><div><dt>Access</dt><dd>${state.user.role === 'admin' ? 'Banking administrator' : 'Personal banking customer'}</dd></div></dl><div class="notice">Accounts, payment requests and activity are saved in the application database.</div><button type="button" class="button full" data-action="close-dialog">Back to banking</button>`); break;
      case 'help': helpDialog(); break;
    }
  } catch (error) { if (!await recoverSession(error)) toast(error.message); if (control.isConnected) control.disabled = false; }
});

document.addEventListener('input',event => {
  const form = event.target.closest('form');
  if (form?.id === 'history-filters') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (form.isConnected) updateHistoryFilters(form); },event.target.type === 'search' ? 120 : 0);
  }
  if (form?.id === 'money-form') state.moneyDraft[form.dataset.type] = Object.fromEntries(new FormData(form));
});
document.addEventListener('change',event => {
  const form = event.target.closest('form');
  if (form?.id === 'history-filters') { clearTimeout(searchTimer); return updateHistoryFilters(form); }
  if (form?.id === 'schedule-form' && event.target.name === 'type') return changeScheduleType(form);
  if (form?.id !== 'money-form') return;
  state.moneyDraft[form.dataset.type] = Object.fromEntries(new FormData(form));
  if (event.target.name === 'recipientType' || (event.target.name === 'fromAccountId' && form.dataset.type === 'transfers')) {
    const name = event.target.name;
    render();
    if (name === 'recipientType') app.querySelector('input[name="recipientType"]:checked')?.focus();
    else app.querySelector('#fromAccountId')?.focus();
  } else if (event.target.name === 'fromAccountId') document.querySelector('#available-balance').textContent = `Available balance: ${money(accountById(event.target.value).balanceCents)}`;
});
document.addEventListener('keydown',event => {
  if (!state.menuOpen || !mobileQuery.matches) return;
  if (event.key === 'Escape') { event.preventDefault(); state.menuOpen = false; updateMobileNavigation({focus:true}); }
  if (event.key === 'Tab') {
    const controls = [...app.querySelectorAll('.sidebar a, .sidebar button')].filter(element => !element.disabled && element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
modal.addEventListener('cancel',event => { if (state.modalBusy) event.preventDefault(); });
modal.addEventListener('close',() => { if (state.modalOpener?.isConnected) state.modalOpener.focus(); else app.querySelector('h1')?.focus(); state.modalOpener = null; });
modal.addEventListener('click',event => {
  if (event.target !== modal || state.modalBusy) return;
  const bounds = modal.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
});
mobileQuery.addEventListener('change',() => { state.menuOpen = false; updateMobileNavigation(); });
window.addEventListener('popstate',() => {
  if (state.modalBusy) { history.replaceState({},'',routeUrl(state.route)); return; }
  closeDialog(); state.route = routeFromLocation(); state.menuOpen = false;
  if (state.data) {
    if (['/login','/register','/'].includes(location.pathname)) history.replaceState({},'','/dashboard');
    if (state.route.page === 'activity') state.filters.account = state.route.account;
    render({focus:true}); loadExtras(state.route.page);
  } else { state.authMode = location.pathname === '/register' ? 'register' : 'login'; auth({focus:true}); }
});
async function start() {
  try {
    const session = await api('/session'); state.user = session.user;
    if (session.user) {
      if (['/','/login','/register'].includes(location.pathname)) history.replaceState({},'','/dashboard');
      state.route = routeFromLocation();
      if (state.route.page === 'activity') state.filters.account = state.route.account;
      if (await loadDashboard()) loadExtras(state.route.page);
    } else { if (!['/','/login','/register'].includes(location.pathname)) state.intendedRoute = {...state.route}; auth(); }
  } catch (error) { connectionError(error.message); }
}
// Refresh operational updates while the browser is open, without interrupting forms.
setInterval(() => { if (state.user && !state.signingOut && !document.hidden && !state.modalBusy) loadNotifications({ renderPage: state.route.page === 'notifications' }); }, 30000);
window.addEventListener('focus', async () => {
  if (!state.user || state.modalBusy || state.signingOut) return;
  await loadDashboard({ render: false });
  if (state.data && ['overview', 'accounts', 'activity'].includes(state.route.page) && !modal.open && !document.activeElement?.matches('input,select,textarea')) render();
  if (state.user) loadExtras(state.route.page);
});
start();
