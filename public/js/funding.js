// Automatic notices use current account and schedule facts; they never submit a
// payment or call the language model. Private state lives only in this session.
import {state,api,captureSession,esc,icon,money,visibleMoney,fullDate,recoverSession} from './core.js';

let pending=null,generation=0;
export function cancelFunding(){
  generation++;
  pending?.controller.abort();
  pending=null;
}
export function loadFunding({force=false}={}){
  if(!state.user || !state.data || state.signingOut || (state.user.role==='admin' && !state.data.business))return Promise.resolve(false);
  if(pending && !force)return pending.promise;
  pending?.controller.abort();
  const current=captureSession(),version=++generation,task={controller:new AbortController()};
  const active=()=>version===generation && current();
  pending=task;
  task.promise=(async()=>{
    try{
      const result=await api('/funding-check',undefined,'GET',{signal:task.controller.signal});
      if(!active())return false;
      state.funding={check:result.fundingCheck,error:''};
      renderAutomaticFunding();
      return true;
    }catch(error){
      if(error.status===-1 || !active())return false;
      if(await recoverSession(error) || !active())return false;
      // Keep the last warning visible when refreshing fails; never turn a
      // missing check into an assertion that the next payments are covered.
      state.funding={check:state.funding?.check||null,error:error.message};
      renderAutomaticFunding();
      return false;
    }finally{
      if(pending===task)pending=null;
    }
  })();
  return task.promise;
}
export function fundingWarningsHtml(warnings,{automatic=false}={}){
  const cash=automatic?visibleMoney:money;
  return warnings.map(warning=>'<section class="assistant-funding-warning" role="'+(automatic?'group':'status')+'" aria-label="Funding warning"><h4>'+esc(warning.title)+'</h4>'+(warning.accountName?'<p><strong>'+esc(warning.accountName)+'</strong></p>':'')+'<p>'+esc(warning.message)+'</p><dl>'+[['Available now',warning.availableCents],['Requested amount',warning.requiredCents],[warning.code==='scheduled_shortfall'?'Largest projected shortfall':'Funding shortfall',warning.shortageCents]].filter(([,value])=>Number.isSafeInteger(value)).map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+cash(value)+'</dd></div>').join('')+(warning.dueAt?'<div><dt>First projected shortfall (SGT)</dt><dd>'+esc(fullDate(warning.dueAt))+'</dd></div>':'')+(warning.days?'<div><dt>Planning period</dt><dd>'+esc(warning.days)+' days</dd></div>':'')+'</dl><small>Checked '+esc(fullDate(warning.checkedAt))+' SGT</small></section>').join('');
}
export function renderAutomaticFunding(){
  const root=document.querySelector('#assistant-root');
  if(!root || !state.user || !state.data || state.signingOut)return;
  const check=state.funding?.check,error=state.funding?.error,warnings=check?.warnings||[],show=Boolean(warnings.length||error);
  const announcement=root.querySelector('#funding-announcement');
  const signature=JSON.stringify([warnings.map(w=>[w.code,w.accountId,w.shortageCents,w.dueAt]),Boolean(error)]);
  if(announcement && announcement.dataset.signature!==signature){
    const hadWarning=Boolean(announcement.textContent);
    announcement.dataset.signature=signature;
    announcement.textContent=show?(error?'Automatic funding check could not refresh. Review the current warnings.':'Automatic funding check needs attention. Open the assistant for details.'):(hadWarning?'The latest check cleared the scheduled funding warning.':'');
  }
  const preview=root.querySelector('.assistant-funding-preview');
  if(preview){
    preview.hidden=!show;
    if(show){
      const gaps=warnings.filter(w=>w.code==='scheduled_shortfall').length;
      const title=gaps?'Scheduled payments may need funding':'Funding check unavailable';
      let description=gaps?gaps+' account'+(gaps===1?' has':'s have')+' a projected shortfall in the next '+check.days+' days.':'Scheduled funding could not be checked completely.';
      if(error && gaps)description+=' This notice may be out of date because the check could not refresh.';
      const content='<div><strong>'+icon('bell')+title+'</strong><p>'+description+'</p></div><button type="button" class="text-button" data-action="funding-open">View funding warnings '+icon('arrow')+'</button>';
      // Timestamp-only refreshes do not repeatedly announce the same notice.
      if(preview.innerHTML!==content)preview.innerHTML=content;
    }else preview.replaceChildren();
  }
  const panel=root.querySelector('#automatic-funding');
  if(!panel)return;
  panel.hidden=!show;
  if(!show){
    if(panel.contains(document.activeElement))root.querySelector('#assistant-message')?.focus();
    panel.replaceChildren();
    return;
  }
  const content='<h3>Automatic funding check</h3><p>Based on current balances and active scheduled payments over the next '+(check?.days||30)+' days, including overdue payments. Unentered bills and unscheduled income are not included. Pending payments do not reserve funds.</p>'+(error?'<div class="funding-refresh-error"><p>'+(check?'Funding warnings may be out of date. ':'Scheduled funding could not be checked. ')+esc(error)+'</p><button type="button" class="text-button" data-action="funding-refresh">Retry funding check</button></div>':'')+fundingWarningsHtml(warnings,{automatic:true});
  if(panel.innerHTML!==content)panel.innerHTML=content;
}
