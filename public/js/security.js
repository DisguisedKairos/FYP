import { modal, state, ui, api, esc, icon, dialog, formBusy, formError, toast, recoverSession } from './core.js';

let profileGeneration=0,profileController;
const passwordField = (id, name, label, { fresh = false } = {}) => `<div class="field"><label for="${id}">${label}</label><div class="password-wrap"><input id="${id}" name="${name}" type="password" autocomplete="${fresh ? 'new-password' : 'current-password'}" maxlength="128" ${fresh ? 'minlength="8" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,128}"' : ''} required><button type="button" class="password-toggle" data-action="password" data-input="${id}" aria-label="Show password" aria-pressed="false">${icon('eye')}</button></div>${fresh ? '<small>8–128 characters, with uppercase, lowercase and a number.</small>' : ''}</div>`;
const otpField = () => '<div class="field"><label for="security-otp">Authenticator code</label><input id="security-otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required><small>Use a current six-digit code. Each code can be used only once.</small></div>';
const submit = label => `<div class="error-message" role="alert"></div><button type="submit" class="button full">${label} ${icon('shield')}</button>`;

export function clearSecuritySecrets() {
  profileGeneration++;profileController?.abort();
  if (modal.dataset.securitySecret === 'true') {
    delete modal.dataset.securitySecret;
    modal.innerHTML = '';
  }
}

function securityDialog(title, body, { secret = false } = {}) {
  delete modal.dataset.securitySecret;
  dialog(title, body);
  if (secret) modal.dataset.securitySecret = 'true';
}

export async function profileDialog({ refresh = true } = {}) {
  const userId = state.user?.id;
  if (!userId || state.signingOut) return;
  const route=state.route,request=++profileGeneration;profileController?.abort();
  if (refresh) {
    profileController=new AbortController();
    securityDialog('Your profile and security','<div class="loading-state" role="status"><p>Loading profile security...</p></div>');
    const token='profile:'+request;modal.dataset.detailRequest=token;
    const active=()=>request===profileGeneration && state.route===route && state.user?.id===userId && !state.signingOut && modal.open && modal.dataset.detailRequest===token;
    try{
      const result = await api('/auth/security',undefined,'GET',{signal:profileController.signal});
      if(!active())return;
      state.user.mfaEnabled = Boolean(result.security.mfaEnabled);
    }catch(error){
      if(active() && error.status!==-1 && !await recoverSession(error))securityDialog('Profile unavailable.','<p>'+esc(error.message)+'</p><button type="button" class="button secondary" data-action="close-dialog">Done</button>');
      return;
    }
  }
  securityDialog('Your profile and security', `<div class="profile-card"><span class="avatar">${esc(state.user.name[0])}</span><div><h3>${esc(state.user.name)}</h3><p>${esc(state.user.email)}</p></div></div><dl class="review-list"><div><dt>Access</dt><dd>${state.user.role === 'admin' ? 'Bank operations administrator' : 'Authorized business operator'}</dd></div><div><dt>Authenticator</dt><dd>${state.user.mfaEnabled ? 'Enabled' : 'Not enabled'}</dd></div><div><dt>Session lifetime</dt><dd>30 minutes inactive<small>24 hours maximum</small></dd></div></dl><div class="detail-section"><h3>Keep your account secure</h3><p>Update your password or sign out every active device. An authenticator adds a code to your sign-in password.</p><div class="modal-actions"><button type="button" class="button secondary" data-action="security-password">Change password</button><button type="button" class="button secondary" data-action="security-revoke">Sign out all devices</button></div><button type="button" class="button full secondary" data-action="${state.user.mfaEnabled ? 'security-mfa-disable' : 'security-mfa-setup'}">${state.user.mfaEnabled ? 'Disable authenticator' : 'Set up authenticator'} ${icon('shield')}</button></div>`);
}

export function passwordDialog() {
  securityDialog('Change your password', `<p class="modal-intro">This signs out your other devices and refreshes the current session.</p><form id="security-password-form">${passwordField('security-current-password', 'currentPassword', 'Current password')}${passwordField('security-new-password', 'newPassword', 'New password', { fresh: true })}${passwordField('security-confirm-password', 'confirmPassword', 'Confirm new password', { fresh: true })}${submit('Update password')}</form>`);
}

export function revokeDialog() {
  securityDialog('Sign out all devices?', `<p class="modal-intro">Every active session, including this one, will end. Your accounts and payment instructions stay saved.</p><form id="security-revoke-form">${passwordField('security-revoke-password', 'currentPassword', 'Current password')}${submit('Sign out all devices')}</form>`);
}

export function mfaSetupDialog() {
  securityDialog('Set up an authenticator', `<p class="modal-intro">Use an authenticator app to generate a code when you sign in. Keep the recovery codes somewhere private.</p><form id="security-mfa-setup-form">${passwordField('security-setup-password', 'currentPassword', 'Current password')}${submit('Start authenticator setup')}</form>`);
}

function mfaConfirmDialog(result) {
  securityDialog('Connect your authenticator', `<p class="modal-intro">Add a new account manually in your authenticator app using this setup key. Enter its six-digit code to finish. This setup expires in ten minutes.</p><div class="field"><label for="authenticator-secret">Private setup key</label><textarea id="authenticator-secret" rows="2" readonly spellcheck="false" autocomplete="off">${esc(result.secret)}</textarea></div><p>Account: ${esc(state.user.email)}<br>Issuer: Green Link Digital Bank</p><form id="security-mfa-confirm-form">${otpField()}${submit('Enable authenticator')}</form>`, { secret: true });
}

export function mfaDisableDialog() {
  securityDialog('Disable your authenticator?', `<p class="modal-intro">Confirm with your password and a new authenticator code. Other devices will be signed out and your existing recovery codes will stop working.</p><form id="security-mfa-disable-form">${passwordField('security-disable-password', 'currentPassword', 'Current password')}${otpField()}${submit('Disable authenticator')}</form>`);
}

function recoveryDialog(codes) {
  securityDialog('Save your recovery codes', `<div class="notice" role="status">Your authenticator is enabled. These codes are shown once. Each code can replace an authenticator code for one sign-in.</div><div class="field"><label for="mfa-recovery-codes">Private recovery codes</label><textarea id="mfa-recovery-codes" rows="10" readonly spellcheck="false" autocomplete="off">${esc(codes.join('\n'))}</textarea></div><p>Save them in a password manager or another private place. Never share them in chat.</p><div class="modal-actions"><button type="button" class="button secondary" data-action="security-copy-recovery">Copy codes</button><button type="button" class="button" data-action="close-dialog">I have saved my codes</button></div>`, { secret: true });
}

export async function copyRecoveryCodes() {
  const input = modal.querySelector('#mfa-recovery-codes');
  if (!input) return;
  input.focus(); input.select();
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(input.value); toast('Recovery codes copied. Store them privately.'); return; }
    catch { /* Keep the selected text available for manual copy. */ }
  }
  toast('Codes selected. Use your device’s copy command.');
}

export async function submitSecurity(form) {
  if (state.modalBusy) return;
  const values = Object.fromEntries(new FormData(form));
  if (form.id === 'security-password-form' && values.newPassword !== values.confirmPassword) return formError(form, 'The passwords do not match.');
  const endpoints = {
    'security-password-form': '/auth/password', 'security-revoke-form': '/auth/revoke-sessions',
    'security-mfa-setup-form': '/auth/mfa/setup', 'security-mfa-confirm-form': '/auth/mfa/confirm', 'security-mfa-disable-form': '/auth/mfa/disable',
  };
  const endpoint = endpoints[form.id];
  if (!endpoint) return;
  state.modalBusy = true; formBusy(form, true);
  try {
    const result = await api(endpoint, values);
    state.modalBusy = false;
    if (form.id === 'security-revoke-form') return ui.endSession('All devices have been signed out. Sign in again to continue.');
    if (result.user) { state.user = result.user; if (state.data) state.data.user = result.user; }
    if (form.id === 'security-mfa-setup-form') return mfaConfirmDialog(result);
    ui.render();
    if (form.id === 'security-mfa-confirm-form') return recoveryDialog(result.recoveryCodes);
    await profileDialog({ refresh: false });
    toast(form.id === 'security-password-form' ? 'Password updated. Other devices have been signed out.' : 'Authenticator disabled. Other devices have been signed out.');
  } catch (error) { if (!await recoverSession(error)) formError(form, error.message); }
  finally {
    for (const input of form.querySelectorAll('input[type=password],input[name=otp]')) input.value = '';
    state.modalBusy = false; formBusy(form, false);
  }
}
