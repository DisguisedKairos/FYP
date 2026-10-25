// Shared application state and transport. No user records are stored in browser storage.
export const app = document.querySelector('#app');
export const modal = document.querySelector('#modal');
export const mobileQuery = matchMedia('(max-width: 760px)');
export const ui = {};
export const pages = {
  overview: { path: '/dashboard', label: 'Overview', icon: 'grid' },
  business: { path: '/business', label: 'Business profile', icon: 'wallet' },
  assistant: { path: '/assistant', label: 'GLDB Assistant', icon: 'chat' },
  aiAudit: { path: '/ai-audit', label: 'AI audit log', icon: 'statement' },
  agents: { path: '/banking-insights', label: 'Banking insights', icon: 'activity' },
  accounts: { path: '/accounts', label: 'Business accounts', icon: 'wallet' },
  transfers: { path: '/transfers', label: 'Transfers', icon: 'transfer' },
  payments: { path: '/payments', label: 'Business bills', icon: 'bill' },
  schedules: { path: '/scheduled-payments', label: 'Scheduled payments', icon: 'calendar' },
  activity: { path: '/activity', label: 'Activity', icon: 'activity' },
  notifications: { path: '/notifications', label: 'Notifications', icon: 'bell' },
  onboarding: { path: '/business-onboarding', label: 'Business onboarding', icon: 'shield', admin: true },
  fraud: { path: '/fraud-monitoring', label: 'Fraud monitoring', icon: 'shield', admin: true },
  rules: { path: '/fraud-rules', label: 'Fraud rules', icon: 'sliders', admin: true },
};
export const emptyFilters = () => ({ search: '', type: '', account: '', status: '', from: '', to: '' });
export function routeFromLocation() {
  const url = new URL(location.href);
  const entry = Object.entries(pages).find(([, value]) => value.path === url.pathname);
  return { page: entry?.[0] ?? 'overview', account: url.searchParams.get('account') ?? '' };
}
export const state = {
  data: null, user: null, csrf: '', demoAvailable: false, route: routeFromLocation(), intendedRoute: null,
  authMode: location.pathname === '/register' ? 'register' : 'login', authNotice: '', authBusy: false, signingOut: false,
  hiddenBalance: false, refreshError: '', refreshing: false, filters: emptyFilters(), historyPage: 1, pageSize: 10,
  history: { loading: true, error: '', transactions: [], pagination: null, totals: null }, accountActivity: null,
  menuOpen: false, modalBusy: false, modalOpener: null, pendingMoney: null,
  moneyDraft: { transfers: {}, payments: {} }, remote: {}, notifications: [], unreadCount: 0,
};
export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
export const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const brand = () => `<div class="brand"><img class="brand-logo" src="/brand/gldb-logo.svg" width="217" height="59" alt="Green Link Digital Bank"><img class="brand-logo-inverse" src="/brand/gldb-logo-white.svg" width="307" height="83" alt="Green Link Digital Bank"></div>`;
const currency = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
export const money = cents => currency.format(cents / 100);
export const visibleMoney = cents => state.hiddenBalance ? '••••••' : money(cents);
export const shortDate = value => new Date(value).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short' });
export const fullDate = value => new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const singaporeDay = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export const sameId = (a, b) => String(a) === String(b);
export const allAccounts = () => [...(state.data?.accounts ?? []), ...(state.data?.closedAccounts ?? [])];
export const accountById = id => allAccounts().find(account => sameId(account.id, id));
export const transactionById = id => state.data?.transactions.find(transaction => sameId(transaction.id, id));
export const amountDecimal = cents => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
export function parseAmount(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter an amount with no more than two decimal places.');
  const [whole, fraction = ''] = raw.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents < 1n || cents > 9000000000000n) throw new Error('Enter a positive amount within the supported limit.');
  return Number(cents);
}
export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}
export async function api(path, body, method = 'POST', options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : method, credentials: 'same-origin', signal: controller.signal,
      headers: { Accept: options.responseType === 'blob' ? 'text/csv' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok && options.responseType === 'blob') return { blob: await response.blob(), disposition: response.headers.get('Content-Disposition') || '' };
    let result;
    try { result = await response.json(); }
    catch { if (options.signal?.aborted) throw new ApiError('Request cancelled.', -1); throw new ApiError('The server returned an unexpected response. Please try again.', response.status); }
    if (!response.ok) {
      const error = new ApiError(result.error || 'We could not complete the request.', response.status);
      error.code = result.code;
      error.mfaRequired = Boolean(result.mfaRequired || result.code === 'MFA_REQUIRED' || result.code === 'MFA_INVALID');
      throw error;
    }
    if (result.csrfToken) state.csrf = result.csrfToken;
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw new ApiError('Request cancelled.', -1);
    throw new ApiError('The connection was interrupted. Please check your connection and try again.');
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
let toastTimer;
export function toast(message) {
  const element = document.querySelector('#toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.add('visible');
  toastTimer = setTimeout(() => element.classList.remove('visible'), 5000);
}
export function formError(form, message) {
  const error = form?.querySelector('.error-message');
  if (!error) return toast(message);
  error.textContent = message;
  error.tabIndex = -1;
  error.focus();
}
export function formBusy(form, busy) {
  form?.setAttribute('aria-busy', String(busy));
  form?.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = busy; });
  modal.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = busy; });
}
export function dialog(title, content, { wide = false } = {}) {
  delete modal.dataset.detailRequest;
  if (!modal.open) state.modalOpener = document.activeElement;
  modal.classList.toggle('wide-dialog', wide);
  modal.innerHTML = `<div class="modal-heading"><h2 id="modal-title" tabindex="-1">${esc(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>${content}`;
  if (!modal.open) modal.showModal();
  modal.querySelector('h2').focus();
}
export function closeDialog(force = false) {
  if ((!state.modalBusy || force) && modal.open) {
    modal.close();
    if (modal.dataset.securitySecret === 'true') { delete modal.dataset.securitySecret; modal.replaceChildren(); }
  }
}
export function clearBankingState() {
  ui.cancelReads?.();
  closeDialog(true);
  modal.replaceChildren();
  Object.assign(state, { data: null, user: null, refreshError: '', filters: emptyFilters(), history: { loading: true, error: '', transactions: [], pagination: null, totals: null }, accountActivity: null, ruleAudit:null, aiAudit:null, assistant:null, agentWorkspace:null, fraudCaseFilters:null, fraudScanBusy:false, pendingMoney: null, moneyDraft: { transfers: {}, payments: {} }, remote: {}, notifications: [], unreadCount: 0, hiddenBalance: false, menuOpen: false });
  document.body.classList.remove('menu-open');
}
export async function recoverSession(error) {
  if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) return false;
  if (error.status === 403 && !/token|session.*expired|request.*verified/i.test(error.message)) return false;
  try {
    const session = await api('/session');
    if (session.user && state.user && sameId(session.user.id, state.user.id)) {
      if (error.status === 403) error.message = 'Your session was refreshed. Review your details and try again.';
      return false;
    }
    state.intendedRoute = { ...state.route };
    clearBankingState();
    state.authNotice = 'Your session has ended. Sign in again to continue.';
    state.authMode = 'login';
    history.replaceState({}, '', '/login');
    ui.auth();
    return true;
  } catch { error.message = 'We could not refresh your session. Reload the page and sign in again.'; return false; }
}
export async function loadDashboard({ render = true } = {}) {
  const userId = state.user?.id;
  if (state.signingOut) return false;
  try {
    const result = await api('/dashboard');
    if (!state.user || state.signingOut || !sameId(state.user.id, userId)) return false;
    state.data = result;
    state.user = result.user;
    state.refreshError = '';
    if (render) ui.render();
    return true;
  } catch (error) {
    if (!state.user || state.signingOut || !sameId(state.user.id, userId)) return false;
    if (await recoverSession(error)) return false;
    state.refreshError = error.message;
    if (render) state.data ? ui.render() : ui.connectionError(error.message);
    return false;
  }
}
export function routeUrl(route) { return (pages[route.page]?.path ?? '/dashboard') + (route.account ? `?account=${encodeURIComponent(route.account)}` : ''); }
export function navigate(page, { account = '', replace = false, focus = true } = {}) {
  if (!pages[page] || state.modalBusy || state.signingOut) return;
  if (pages[page].admin && state.user?.role !== 'admin') page = 'overview';
  state.route = { page, account: String(account) };
  state.menuOpen = false;
  document.body.classList.remove('menu-open');
  closeDialog();
  const target = routeUrl(state.route);
  if (location.pathname + location.search !== target) history[replace ? 'replaceState' : 'pushState']({}, '', target);
  if (page === 'activity') { state.filters.account = String(account); state.historyPage = 1; }
  ui.render({ focus });
  ui.loadExtras?.(page);
  scrollTo({ top: 0, behavior: 'instant' });
}
export function statusLabel(status) { return ({ completed: 'Completed', pending_review: 'Awaiting review', rejected: 'Rejected', blocked: 'Blocked', scheduled: 'Scheduled', active: 'Active', cancelled: 'Cancelled', failed: 'Failed', processing: 'Processing', awaiting_business_approval:'Awaiting business approval', approved:'Approved', retrying:'Retrying' })[status] || String(status || 'Unknown'); }
export function statusPill(status) { return `<span class="status-pill status-${esc(status)}">${esc(statusLabel(status))}</span>`; }
export function accountOptions(selected = '') { return state.data.accounts.map(a => `<option value="${esc(a.id)}" ${sameId(a.id, selected) ? 'selected' : ''}>${esc(a.name)} · ${money(a.balanceCents)}</option>`).join(''); }
export function authorizationField() { return `<div class="field authorization-field"><label for="authorizationPassword">Authorize with your password</label><input id="authorizationPassword" name="authorizationPassword" type="password" autocomplete="current-password" maxlength="128" required aria-describedby="authorization-help"><small id="authorization-help">Enter your current sign-in password to authorize this request.</small></div>`; }
