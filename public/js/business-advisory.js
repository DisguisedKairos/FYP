import {state,modal,captureSession,api,esc,dialog,closeDialog,formBusy,formError,recoverSession,toast} from './core.js';
let generation=0,controller;
export function cancelBusinessAdvisory(){generation++;controller?.abort();controller=undefined;}
function choices(title,key,options,selected){
 return '<fieldset class="field"><legend>'+esc(title)+'</legend>'+Object.entries(options).map(([code,label])=>'<label class="checkbox-field"><input type="checkbox" name="'+esc(key)+'" value="'+esc(code)+'"'+(selected.includes(code)?' checked':'')+'> '+esc(label)+'</label>').join('')+'</fieldset>';
}
export async function openBusinessAdvisory(){
 const sessionActive=captureSession();if(!sessionActive()||!state.data?.business)return;
 cancelBusinessAdvisory();const request=generation,abort=new AbortController();controller=abort;
 dialog('Industry news preferences','<p role="status" data-business-advisory-loading="'+request+'">Loading business preferences...</p>');
 const active=()=>sessionActive()&&request===generation&&state.route.page==='business'&&modal.open&&modal.querySelector('[data-business-advisory-loading="'+request+'"]');
 try{
  const profile=await api('/business/advisory-profile',undefined,'GET',{signal:abort.signal});
  if(!active())return;
  if(!profile.available)throw new Error('Complete your registered business profile first.');
  const fields=choices('Operating markets','markets',profile.options.markets,profile.settings.markets)+choices('Business activities','operations',profile.options.operations,profile.settings.operations)+choices('Planning priorities','priorities',profile.options.priorities,profile.settings.priorities);
  dialog('Industry news preferences','<p><strong>'+esc(profile.companyName)+'</strong> &middot; '+esc(profile.label)+'</p><p>Choose the activities, markets and priorities that apply to this business. These planning preferences do not change its registered identity or banking permissions.</p>'+(profile.configured?'':'<p class="notice">Industry defaults are selected. Confirm which assumptions apply to your company.</p>')+'<form id="business-advisory-form" data-version="'+profile.version+'" data-profile="'+esc(profile.profileKey)+'">'+fields+'<div class="error-message" role="alert"></div><button class="button full" type="submit">Save business preferences</button></form>');
 }catch(error){if(active()&&!await recoverSession(error))dialog('Industry news preferences','<p class="error-message" role="alert">'+esc(error.message)+'</p><button class="button secondary" data-action="business-advisory">Try again</button>');}
 finally{if(controller===abort)controller=undefined;}
}
export async function submitBusinessAdvisory(form){
 const active=captureSession();if(!active()||state.modalBusy)return;
 state.modalBusy=true;formBusy(form,true);
 try{
  const values=new FormData(form),settings={};
  for(const key of ['markets','operations','priorities']){
   settings[key]=values.getAll(key);if(!settings[key].length)throw new Error('Choose at least one option for '+key+'.');
  }
  await api('/business/advisory-profile',{profileKey:form.dataset.profile,version:Number(form.dataset.version),settings});
  if(active()){state.modalBusy=false;closeDialog();toast('Industry news preferences saved for your business.');}
 }catch(error){if(active()&&!await recoverSession(error))formError(form,error.message);}
 finally{if(active()){state.modalBusy=false;formBusy(form,false);}}
}
