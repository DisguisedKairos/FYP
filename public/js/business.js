import {state,ui,api,esc,icon,modal,dialog,closeDialog,formBusy,formError,loadDashboard,recoverSession,toast,authorizationField} from './core.js';

export function businessFields(value={}) {
  return `<div class="field"><label for="business-legal-name">Registered business name</label><input id="business-legal-name" name="legalName" value="${esc(value.legalName)}" autocomplete="organization" maxlength="160" minlength="2" required></div>
    <div class="field"><label for="business-registration-number">Business registration number / UEN</label><input id="business-registration-number" name="registrationNumber" value="${esc(value.registrationNumber)}" maxlength="30" minlength="6" autocomplete="off" required><small>Use the identifier shown on the business registration record.</small></div>
    <div class="field"><label for="business-legal-form">Legal form</label><select id="business-legal-form" name="legalForm"><option value="company" ${value.legalForm==='company'?'selected':''}>Company</option><option value="partnership" ${value.legalForm==='partnership'?'selected':''}>Partnership</option><option value="institution" ${value.legalForm==='institution'?'selected':''}>Institution</option></select></div>
    <input type="hidden" name="country" value="SG"><div class="field"><label for="business-industry">Industry</label><input id="business-industry" name="industry" value="${esc(value.industry)}" maxlength="100" minlength="2" required></div>
    <div class="field"><label for="business-registered-address">Registered business address in Singapore</label><textarea id="business-registered-address" name="registeredAddress" autocomplete="street-address" rows="3" minlength="8" maxlength="300" required>${esc(value.registeredAddress)}</textarea></div>`;
}
export const profileFromForm=values=>Object.fromEntries(['legalName','registrationNumber','legalForm','country','industry','registeredAddress'].map(key=>[key,values[key]]));
export function businessNotice(){
  const business=state.data?.business;
  if(business?.status==='approved')return '';
  if(!business&&state.user?.role==='admin')return '';
  return `<div class="notice" role="status"><strong>${business?.status==='pending_review'?'Business onboarding awaiting bank review':business?.status==='rejected'?'Business application needs attention':'Complete your business profile'}</strong><p>Account changes and payments require an approved business. Your existing balances and transaction records remain available.</p><a class="text-button" href="/business" data-nav="business">${business?'View business application':'Set up business profile'} ${icon('arrow')}</a></div>`;
}
function details(business){return `<dl class="review-list"><div><dt>Legal account holder</dt><dd>${esc(business.legalName)}</dd></div><div><dt>Registration number</dt><dd>${esc(business.registrationNumber)}</dd></div><div><dt>Legal form</dt><dd>${esc(business.legalForm)}</dd></div><div><dt>Industry</dt><dd>${esc(business.industry)}</dd></div><div><dt>Registered address</dt><dd>${esc(business.registeredAddress)}</dd></div><div><dt>Jurisdiction</dt><dd>Singapore</dd></div><div><dt>Onboarding status</dt><dd>${esc(business.status.replace(/_/g,' '))}</dd></div></dl>`;}
export function businessPage(){
  const business=state.data?.business;
  return `<div class="page-heading"><div><h1 tabindex="-1">Business profile</h1><p>The registered business is the account holder. You are its authorized operator.</p></div></div><section class="panel service-form">${business?details(business):'<h2>Register your business details</h2><p>Wholesale banking access is for registered businesses and institutions.</p>'}
    ${business?.review?`<div class="notice"><strong>Bank review</strong><p>${esc(business.review.reason)}</p></div>`:''}
    ${business?.status==='approved'?'<div class="notice">Your business is approved for the project banking workflows. Changes to its legal identity require bank assistance.</div>':`<h2>${business?'Update business application':'Business application'}</h2><form id="business-profile-form" data-version="${esc(business?.version)}">${businessFields(business||{})}${authorizationField()}<div class="error-message" role="alert"></div><button class="button full" type="submit">Submit for bank review ${icon('arrow')}</button></form>`}</section>`;
}
export async function submitBusiness(form){
  if(state.modalBusy)return;state.modalBusy=true;formBusy(form,true);
  try{
    const values=Object.fromEntries(new FormData(form));
    await api('/business/profile',{business:profileFromForm(values),version:form.dataset.version?Number(form.dataset.version):undefined,authorizationPassword:values.authorizationPassword});
    await loadDashboard();toast('Business application submitted for bank review.');
  }catch(error){if(!await recoverSession(error))formError(form,error.message);}
  finally{if(form.elements.authorizationPassword)form.elements.authorizationPassword.value='';state.modalBusy=false;formBusy(form,false);}
}
export async function loadBusinessApplications(){
  if(state.user?.role!=='admin')return;
  const userId=state.user.id;state.remote.onboarding={loading:true};
  if(state.route.page==='onboarding')ui.render();
  try{const result=await api('/business/applications',undefined,'GET');if(state.user?.id!==userId||state.signingOut)return;state.remote.onboarding={data:result};}
  catch(error){if(state.user?.id!==userId||state.signingOut)return;if(await recoverSession(error))return;state.remote.onboarding={error:error.message};}
  if(state.route.page==='onboarding')ui.render();
}
export function onboardingPage(){
  const remote=state.remote.onboarding;
  const body=remote?.data?remote.data.applications.length?remote.data.applications.map(business=>`<article class="panel service-form"><h2>${esc(business.legalName)}</h2><p>${esc(business.registrationNumber)} · ${esc(business.contact.name)} · ${esc(business.contact.email)}</p>${details(business)}<button class="button secondary" type="button" data-review-business="${esc(business.id)}">Review business application ${icon('arrow')}</button></article>`).join(''):'<section class="panel empty-state"><h2>No applications awaiting review</h2><p>Submitted business profiles will appear here.</p></section>':remote?.error?`<div class="error-message" role="alert">${esc(remote.error)}</div>`:'<div class="loading-state" role="status">Loading business applications…</div>';
  return `<div class="page-heading"><div><h1 tabindex="-1">Business onboarding</h1><p>Review registered businesses before activating their account and payment access.</p></div><button type="button" class="button secondary" data-action="refresh-business-applications">Refresh queue</button></div>${body}`;
}
export function reviewBusinessDialog(id){
  const business=state.remote.onboarding?.data?.applications.find(row=>String(row.id)===String(id));if(!business)return;
  dialog('Review business onboarding',`${details(business)}<p>Authorized contact: ${esc(business.contact.name)} · ${esc(business.contact.email)}</p><form id="business-review-form" data-id="${esc(id)}" data-version="${business.version}"><div class="field"><label for="business-review-decision">Decision</label><select id="business-review-decision" name="decision"><option value="approve">Approve business banking access</option><option value="reject">Return for correction</option></select></div><div class="field"><label for="business-review-reason">Review reason</label><textarea id="business-review-reason" name="reason" rows="3" minlength="3" maxlength="500" required></textarea></div><label class="checkbox-field"><input id="business-verification-confirmed" type="checkbox" name="verificationConfirmed">I have completed the business verification checks required for this project review.</label>${authorizationField()}<div class="error-message" role="alert"></div><button type="submit" class="button full">Record onboarding decision ${icon('shield')}</button></form>`);
}
export async function submitBusinessReview(form){
  if(state.modalBusy)return;state.modalBusy=true;formBusy(form,true);
  try{const values=Object.fromEntries(new FormData(form));await api(`/business/applications/${encodeURIComponent(form.dataset.id)}/review`,{version:Number(form.dataset.version),decision:values.decision,reason:values.reason,verificationConfirmed:form.elements.verificationConfirmed.checked,authorizationPassword:values.authorizationPassword});state.modalBusy=false;closeDialog();await loadBusinessApplications();toast('Business onboarding decision recorded.');}
  catch(error){if(!await recoverSession(error))formError(form,error.message);}
  finally{if(form.elements.authorizationPassword)form.elements.authorizationPassword.value='';state.modalBusy=false;formBusy(form,false);}
}
