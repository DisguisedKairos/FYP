import {state,api,esc,icon,money,fullDate,singaporeDay,navigate,captureSession,recoverSession,statusPill,toast} from './core.js';
import {heading} from './views.js';
let controller,listController,generation=0,listGeneration=0;
const inputFilters=()=>Object.fromEntries(['company','scope','from','to'].map(key=>[key,state.route[key]||'']));
const filters=()=>Object.fromEntries(['company','scope','savedView','from','to'].map(key=>[key,state.route[key]||'']));
const keyFor=value=>JSON.stringify(value);
export function cancelCompanyActivity(){generation++;listGeneration++;controller?.abort();listController?.abort();state.companyActivity=null;state.dashboardViews=null;}
function renderResults(){
  if(state.route.page!=='companyActivity')return;
  const target=document.querySelector('#company-activity-results');
  if(!target)return;
  target.setAttribute('aria-busy',String(Boolean(state.companyActivity?.loading)));
  target.innerHTML=results();
  target.querySelectorAll('[data-chart-height]').forEach(bar=>{bar.style.height=Number(bar.dataset.chartHeight)+'%';});
}
export async function loadCompanyActivity({page=1}={}){
  if(!state.user || state.signingOut || state.route.page!=='companyActivity')return;
  const query=filters(),key=keyFor(query),request=++generation,session=captureSession();
  controller?.abort();controller=new AbortController();
  const active=()=>request===generation && session() && state.route.page==='companyActivity' && keyFor(filters())===key;
  state.companyActivity={loading:true,key};renderResults();
  try{
    const params=new URLSearchParams({...inputFilters(),page:String(Math.max(1,page)),pageSize:'10'});
    const path=query.savedView?'/dashboard-views/'+encodeURIComponent(query.savedView)+'?page='+Math.max(1,page):'/company-activity?'+params;
    const result=await api(path,undefined,'GET',{signal:controller.signal});
    if(!active())return;
    state.companyActivity={data:result.dashboard,saved:result.view,key,loading:false};
    if(query.savedView){const form=document.querySelector('#company-activity-filters');if(form){form.elements.company.value=result.dashboard.scopeType==='all'?'':result.dashboard.company||'';form.elements.scope.value=result.dashboard.scopeType==='all'?'all':'company';form.elements.from.value=result.dashboard.period.from;form.elements.to.value=result.dashboard.period.to;}}
    renderResults();
  }catch(error){
    if(!active() || error.status===-1)return;
    if(await recoverSession(error) || !active())return;
    state.companyActivity={error:error.message,key,loading:false};renderResults();
  }
}
export function submitCompanyActivity(form){const values=Object.fromEntries(new FormData(form));if(values.scope==='all')values.company='';navigate('companyActivity',values);}
export function chooseCompanyActivity(company){const data=state.companyActivity?.data;navigate('companyActivity',{company,scope:'company',from:data?.period.from||state.route.from||'',to:data?.period.to||state.route.to||''});}
export function companyActivityPage(){
  const values=filters(),today=singaporeDay();
  return heading('Company activity.','Explore transactions with a company or biller recorded in your account history.','<button type="button" class="button secondary" data-nav="dashboardViews">Saved dashboards</button>')+
    '<button type="button" class="text-button company-overview-link" data-action="company-all">Summarize all companies '+icon('arrow')+'</button><details class="company-filter-details" '+(values.savedView?'':'open')+'><summary>Company and date filters</summary><form id="company-activity-filters" class="panel company-filters"><div class="field"><label for="company-scope">View</label><select id="company-scope" name="scope"><option value="company" '+(values.scope!=='all'?'selected':'')+'>Specific company</option><option value="all" '+(values.scope==='all'?'selected':'')+'>All companies</option></select><label for="company-name">Company or biller</label><input id="company-name" name="company" type="search" value="'+esc(values.company)+'" placeholder="e.g. Harbour Supplies" minlength="2" maxlength="120" autocomplete="off"><small>Leave blank to choose from your recorded counterparties.</small></div><div class="field"><label for="company-from">From date (SGT)</label><input id="company-from" name="from" type="date" value="'+esc(values.from)+'" max="'+today+'"></div><div class="field"><label for="company-to">To date (SGT)</label><input id="company-to" name="to" type="date" value="'+esc(values.to)+'" max="'+today+'"><small>Defaults to the last 90 days.</small></div><button type="submit" class="button">Show dashboard '+icon('arrow')+'</button></form></details><div id="company-activity-results" aria-busy="'+Boolean(state.companyActivity?.loading)+'">'+results()+'</div>';
}
function results(){
  const current=state.companyActivity;
  if(!current || current.key!==keyFor(filters()) || current.loading)return '<div class="panel loading-state" role="status"><p>Loading company activity...</p></div>';
  if(current.error)return '<div class="panel empty-state" role="alert"><h2>Company activity unavailable.</h2><p>'+esc(current.error)+'</p><button class="button secondary" type="button" data-action="company-activity-retry">Try again</button></div>';
  const data=current.data,period='<p class="company-period">'+esc(data.period.from)+' to '+esc(data.period.to)+' &middot; Asia/Singapore &middot; SGD</p>',scope='<p class="chart-note">'+esc(data.scope)+'</p>';
  if(data.status!=='ready')return '<section class="panel company-choices"><h2>'+(data.status==='ambiguous'?'Choose a company.':data.status==='not_found'?'No matching counterparty.':'Choose a recorded counterparty.')+'</h2>'+period+'<p>'+(data.status==='not_found'?'No transactions on your accounts match that name. Try another recorded name.':data.status==='ambiguous'?'Several names match your search. Select the intended counterparty.':'Select a company or biller to see its dashboard.')+'</p><div class="company-choice-list">'+data.companies.map(name=>'<button class="button secondary" type="button" data-company-choice="'+esc(name)+'">'+esc(name)+' '+icon('arrow')+'</button>').join('')+'</div>'+(data.moreCompanies?'<p>More names are available. Narrow the company search.</p>':'')+scope+'</section>';
  const totals=data.totals,max=Math.max(1,...data.months.flatMap(m=>[m.incomeCents,m.outgoingCents]));
  const metric=(label,value)=>'<div><span>'+label+'</span><strong>'+esc(value)+'</strong></div>';
  const chart='<section class="panel company-chart"><h2>Monthly payment activity</h2><p>Completed payments only. <span class="company-legend"><span class="legend-dot"></span>Received <span class="legend-dot light"></span>Paid</span></p><div class="chart" role="img" aria-label="Monthly completed receipts and payments. Exact amounts are in the table below.">'+data.months.map(m=>'<div class="bar-group" title="'+esc(m.month+': '+money(m.incomeCents)+' received, '+money(m.outgoingCents)+' paid')+'"><span class="bar" data-chart-height="'+m.incomeCents/max*100+'"></span><span class="bar light" data-chart-height="'+m.outgoingCents/max*100+'"></span></div>').join('')+'</div><div class="chart-labels">'+data.months.map(m=>'<span>'+esc(m.month)+'</span>').join('')+'</div><details class="company-months"><summary>Monthly amounts</summary><div class="table-scroll"><table class="statement-table"><caption class="sr-only">Monthly completed activity with '+esc(data.company)+'</caption><thead><tr><th scope="col">Month (SGT)</th><th scope="col">Received</th><th scope="col">Paid</th></tr></thead><tbody>'+data.months.map(m=>'<tr><th scope="row">'+esc(m.month)+'</th><td>'+money(m.incomeCents)+'</td><td>'+money(m.outgoingCents)+'</td></tr>').join('')+'</tbody></table></div></details></section>';
  const paging=data.pagination;
  const transactions=data.scopeType==='all'?companyBreakdown(data):'<section class="panel company-transactions"><div class="section-heading"><h2>Matching transactions</h2><span>'+paging.total+' records</span></div>'+(data.transactions.length?'<div class="table-scroll"><table class="transaction-table"><caption class="sr-only">Transactions with '+esc(data.company)+'</caption><thead><tr><th scope="col">Transaction / reference</th><th scope="col">Activity date (SGT)</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead><tbody>'+data.transactions.map(t=>'<tr><td><button class="transaction-open" type="button" data-transaction="'+esc(t.id)+'"><span class="transaction-description"><strong>'+esc(t.description)+'</strong><span>'+esc(t.reference||t.counterparty)+'</span><span>'+esc(t.accountName)+'</span></span></button></td><td>'+fullDate(t.completedAt||t.requestedAt)+'</td><td>'+statusPill(t.status)+'</td><td><span class="transaction-amount '+(t.amountCents>0?'incoming':'')+'">'+(t.amountCents>0?'+':'')+money(t.amountCents)+'</span></td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state"><p>No activity with this company in the selected period.</p></div>')+'<div class="table-footer"><span>Page '+paging.page+' of '+Math.max(1,paging.totalPages)+'</span><div><button type="button" class="text-button" data-action="company-activity-prev" '+(paging.page<=1?'disabled':'')+'>Previous</button><button type="button" class="text-button" data-action="company-activity-next" '+(paging.page>=paging.totalPages?'disabled':'')+'>Next</button></div></div></section>';
  return '<div data-company-dashboard>'+savedControls(data,current)+'<section class="company-summary"><h2>'+esc(data.company)+'</h2>'+period+'<div class="agent-metrics company-metrics">'+metric('Received',money(totals.incomeCents))+metric('Paid',money(totals.outgoingCents))+metric('Net movement',money(totals.netCents))+metric('Completed',totals.completedCount)+metric('Awaiting review',totals.pendingCount)+metric('Rejected',totals.rejectedCount)+(data.scopeType==='all'?metric('Companies',totals.companyCount):'')+'</div><p class="chart-note">Only completed payments affect monetary totals. '+esc(data.period.dateBasis)+'</p></section>'+chart+transactions+scope+'</div>';
}

function currentDefinition(data){
 const query=filters();
 return state.companyActivity?.saved?.definition || {scope:data.scopeType==='all'?'all':'company',company:data.scopeType==='all'?'':data.company,period:!query.from&&!query.to?{kind:'rolling',days:90}:{kind:'fixed',from:data.period.from,to:data.period.to}};
}
function savedControls(data,current){
 if(current.saved)return '<div class="notice saved-view-notice"><strong>Saved view: '+esc(current.saved.title)+'</strong><p>'+esc(periodLabel(current.saved.definition))+' &middot; Figures refresh from your ledger when opened.</p><button class="text-button" type="button" data-nav="dashboardViews">All saved dashboards '+icon('arrow')+'</button></div>';
 return '<form id="save-dashboard-form" class="panel save-dashboard-form"><div class="field"><label for="dashboard-title">Save this dashboard for later</label><input id="dashboard-title" name="title" value="'+esc(current.saveTitle||(data.scopeType==='all'?'Transactions with all companies':'Activity with '+data.company).slice(0,80))+'" minlength="2" maxlength="80" required><small>'+esc(periodLabel(currentDefinition(data)))+'. Only you can open this view.</small></div><button type="submit" class="button secondary" '+(current.saving?'disabled':'')+'>'+(current.saving?'Saving...':'Save view')+'</button><p class="error-message" role="alert">'+esc(current.saveError||'')+'</p></form>';
}
function companyBreakdown(data){
 const paging=data.pagination;
 return '<section class="panel company-transactions"><div class="section-heading"><h2>Activity by company</h2><span>'+data.totals.companyCount+' companies &middot; '+data.totals.transactionCount+' transactions</span></div><div class="table-scroll"><table class="statement-table company-breakdown"><caption class="sr-only">Company activity summary for the selected period</caption><thead><tr><th scope="col">Company or biller</th><th scope="col">Received</th><th scope="col">Paid</th><th scope="col">Net</th><th scope="col">Completed</th><th scope="col">Awaiting review</th><th scope="col">Rejected</th></tr></thead><tbody>'+data.companies.map(row=>'<tr><th scope="row"><button class="text-button" type="button" data-company-choice="'+esc(row.company)+'">'+esc(row.company)+'</button></th><td>'+money(row.incomeCents)+'</td><td>'+money(row.outgoingCents)+'</td><td>'+money(row.netCents)+'</td><td>'+row.completedCount+'</td><td>'+row.pendingCount+'</td><td>'+row.rejectedCount+'</td></tr>').join('')+'</tbody></table></div>'+(data.companies.length?'':'<p class="empty-state">No transactions with other companies in this period.</p>')+'<div class="table-footer"><span>Page '+paging.page+' of '+Math.max(1,paging.totalPages)+'</span><div><button class="text-button" type="button" data-action="company-activity-prev" '+(paging.page<=1?'disabled':'')+'>Previous</button><button class="text-button" type="button" data-action="company-activity-next" '+(paging.page>=paging.totalPages?'disabled':'')+'>Next</button></div></div></section>';
}
export function openSavedDashboard(id){navigate('companyActivity',{savedView:id});}
function periodLabel(definition){return definition.period.kind==='rolling'?'Latest '+definition.period.days+' days':'Fixed dates: '+definition.period.from+' to '+definition.period.to;}
export async function saveCompanyView(form){
 const current=state.companyActivity;if(!current?.data || current.saving)return;
 const session=captureSession(),key=current.key,definition=currentDefinition(current.data),title=form.elements.title.value;
 current.saving=true;current.saveTitle=title;current.saveError='';renderResults();
 try{
  const result=await api('/dashboard-views',{title,definition});
  if(!session())return;
  if(state.companyActivity===current && state.route.page==='companyActivity' && keyFor(filters())===key){current.saved=result.view;current.saving=false;renderResults();}
  state.dashboardViews=null;toast(result.alreadySaved?'This dashboard is already saved as '+result.view.title+'.':'Dashboard saved. Open it anytime from Saved dashboards.');
 }catch(error){if(!session() || error.status===-1)return;if(await recoverSession(error))return;if(state.companyActivity===current){current.saving=false;current.saveError=error.message;renderResults();}}
}
function listResults(){
 const current=state.dashboardViews;
 if(!current || current.loading)return '<div class="panel loading-state" role="status"><p>Loading your saved dashboards...</p></div>';
 if(current.error)return '<div class="panel empty-state" role="alert"><p>'+esc(current.error)+'</p><button class="button secondary" type="button" data-action="dashboard-views-retry">Try again</button></div>';
 if(!current.views.length)return '<section class="panel empty-state"><h2>No saved dashboards yet.</h2><p>Ask the assistant to summarize your company transactions and save the dashboard, or save a view from Company activity.</p><button class="button" type="button" data-nav="companyActivity">Explore company activity '+icon('arrow')+'</button></section>';
 return '<div class="saved-dashboard-grid">'+current.views.map(view=>'<article class="panel saved-dashboard-card"><h2>'+esc(view.title)+'</h2><p>'+esc(view.definition.scope==='all'?'All recorded companies and billers':view.definition.company)+'</p><p>'+esc(periodLabel(view.definition))+' &middot; Live ledger figures</p><p class="chart-note">Saved '+fullDate(view.createdAt)+'</p><div><button class="button" type="button" data-saved-dashboard="'+esc(view.id)+'">Open dashboard '+icon('arrow')+'</button><button class="text-button danger-text" type="button" data-remove-dashboard="'+esc(view.id)+'">Remove saved view</button></div></article>').join('')+'</div>';
}
export function dashboardViewsPage(){return heading('Saved dashboards.','Your private views. Reopen a dashboard to refresh its transaction figures.','<button class="button" type="button" data-nav="companyActivity">Create a view '+icon('plus')+'</button>')+'<div id="dashboard-view-list">'+listResults()+'</div>';}
export async function loadDashboardViews(){
 if(!state.user || state.signingOut || state.route.page!=='dashboardViews')return;
 const session=captureSession(),request=++listGeneration;listController?.abort();listController=new AbortController();
 const active=()=>session() && request===listGeneration && state.route.page==='dashboardViews';
 const render=()=>{if(active()){const target=document.querySelector('#dashboard-view-list');if(target)target.innerHTML=listResults();}};
 state.dashboardViews={loading:true};render();
 try{const result=await api('/dashboard-views',undefined,'GET',{signal:listController.signal});if(!active())return;state.dashboardViews={views:result.views};render();}
 catch(error){if(!active() || error.status===-1)return;if(await recoverSession(error) || !active())return;state.dashboardViews={error:error.message};render();}
}
export async function removeSavedDashboard(id){
 const session=captureSession(),control=document.querySelector('[data-remove-dashboard="'+CSS.escape(id)+'"]');if(control)control.disabled=true;
 try{await api('/dashboard-views/'+encodeURIComponent(id),{},'DELETE');if(!session())return;toast('Saved view removed. Your transactions are unchanged.');if(state.route.page==='dashboardViews')await loadDashboardViews();}
 catch(error){if(session() && !await recoverSession(error))toast(error.message);if(session() && control?.isConnected)control.disabled=false;}
}
