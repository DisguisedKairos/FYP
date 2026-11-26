import { state, esc, icon } from './core.js';

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
  return `<div class="notice" role="status"><strong>Business banking access restricted</strong><p>Contact bank support about this business profile before making account or payment changes. Existing balances and transaction records remain available.</p><a class="text-button" href="/business" data-nav="business">View business profile ${icon('arrow')}</a></div>`;
}
function details(business){return `<dl class="review-list"><div><dt>Legal account holder</dt><dd>${esc(business.legalName)}</dd></div><div><dt>Registration number</dt><dd>${esc(business.registrationNumber)}</dd></div><div><dt>Legal form</dt><dd>${esc(business.legalForm)}</dd></div><div><dt>Industry</dt><dd>${esc(business.industry)}</dd></div><div><dt>Registered address</dt><dd>${esc(business.registeredAddress)}</dd></div><div><dt>Jurisdiction</dt><dd>Singapore</dd></div><div><dt>Banking access</dt><dd>${business.status==='approved'?'Active':'Restricted'}</dd></div></dl>`;}
export function businessPage(){
  const business=state.data?.business;
  return `<div class="page-heading"><div><h1 tabindex="-1">Business profile</h1><p>The registered business is the account holder. You are its authorized operator.</p></div></div><section class="panel service-form">${business?details(business):'<h2>No business profile is linked</h2><p>Contact bank support about access to an existing business account.</p>'}
    ${business?'<div class="notice">Changes to the registered legal identity require bank assistance.</div>':''}</section>${business?'<section class="panel service-form"><h2>News for your business</h2><p>Tailor current industry news to your operating markets, activities and priorities. The assistant explains potential effects and suggests practical checks for your company.</p><button class="button secondary" type="button" data-action="business-advisory">Customize industry news</button> <button class="button" type="button" data-action="business-news">Ask for an industry briefing</button></section>':''}`;
}
