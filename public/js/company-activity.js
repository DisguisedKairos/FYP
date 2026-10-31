import {state,api,esc,icon,money,fullDate,singaporeDay,navigate,captureSession,recoverSession,statusPill} from './core.js';
import {heading} from './views.js';
let controller,generation=0;
const filters=()=>Object.fromEntries(['company','from','to'].map(key=>[key,state.route[key]||'']));
const keyFor=value=>JSON.stringify(value);
export function cancelCompanyActivity(){generation++;controller?.abort();state.companyActivity=null;}
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
    const params=new URLSearchParams({...query,page:String(Math.max(1,page)),pageSize:'10'});
    const result=await api('/company-activity?'+params,undefined,'GET',{signal:controller.signal});
    if(!active())return;
    state.companyActivity={data:result.dashboard,key,loading:false};renderResults();
  }catch(error){
    if(!active() || error.status===-1)return;
    if(await recoverSession(error) || !active())return;
    state.companyActivity={error:error.message,key,loading:false};renderResults();
  }
}
export function submitCompanyActivity(form){navigate('companyActivity',Object.fromEntries(new FormData(form)));}
export function chooseCompanyActivity(company){navigate('companyActivity',{...filters(),company});}
export function companyActivityPage(){
  const values=filters(),today=singaporeDay();
  return heading('Company activity.','Explore transactions with a company or biller recorded in your account history.','')+
    '<form id="company-activity-filters" class="panel company-filters"><div class="field"><label for="company-name">Company or biller</label><input id="company-name" name="company" type="search" value="'+esc(values.company)+'" placeholder="e.g. Harbour Supplies" minlength="2" maxlength="120" autocomplete="off"><small>Leave blank to choose from your recorded counterparties.</small></div><div class="field"><label for="company-from">From date (SGT)</label><input id="company-from" name="from" type="date" value="'+esc(values.from)+'" max="'+today+'"></div><div class="field"><label for="company-to">To date (SGT)</label><input id="company-to" name="to" type="date" value="'+esc(values.to)+'" max="'+today+'"><small>Defaults to the last 90 days.</small></div><button type="submit" class="button">Show dashboard '+icon('arrow')+'</button></form><div id="company-activity-results" aria-busy="'+Boolean(state.companyActivity?.loading)+'">'+results()+'</div>';
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
  const transactions='<section class="panel company-transactions"><div class="section-heading"><h2>Matching transactions</h2><span>'+paging.total+' records</span></div>'+(data.transactions.length?'<div class="table-scroll"><table class="transaction-table"><caption class="sr-only">Transactions with '+esc(data.company)+'</caption><thead><tr><th scope="col">Transaction / reference</th><th scope="col">Activity date (SGT)</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead><tbody>'+data.transactions.map(t=>'<tr><td><button class="transaction-open" type="button" data-transaction="'+esc(t.id)+'"><span class="transaction-description"><strong>'+esc(t.description)+'</strong><span>'+esc(t.reference||t.counterparty)+'</span><span>'+esc(t.accountName)+'</span></span></button></td><td>'+fullDate(t.completedAt||t.requestedAt)+'</td><td>'+statusPill(t.status)+'</td><td><span class="transaction-amount '+(t.amountCents>0?'incoming':'')+'">'+(t.amountCents>0?'+':'')+money(t.amountCents)+'</span></td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state"><p>No activity with this company in the selected period.</p></div>')+'<div class="table-footer"><span>Page '+paging.page+' of '+Math.max(1,paging.totalPages)+'</span><div><button type="button" class="text-button" data-action="company-activity-prev" '+(paging.page<=1?'disabled':'')+'>Previous</button><button type="button" class="text-button" data-action="company-activity-next" '+(paging.page>=paging.totalPages?'disabled':'')+'>Next</button></div></div></section>';
  return '<div data-company-dashboard><section class="company-summary"><h2>'+esc(data.company)+'</h2>'+period+'<div class="agent-metrics company-metrics">'+metric('Received',money(totals.incomeCents))+metric('Paid',money(totals.outgoingCents))+metric('Net movement',money(totals.netCents))+metric('Completed',totals.completedCount)+metric('Awaiting review',totals.pendingCount)+metric('Rejected',totals.rejectedCount)+'</div><p class="chart-note">Only completed payments affect monetary totals. '+esc(data.period.dateBasis)+'</p></section>'+chart+transactions+scope+'</div>';
}
