import {state,api,esc,icon,money,fullDate,statusPill,captureSession,recoverSession,ui,toast} from './core.js';
import {heading} from './views.js';
import {companyCharts} from './company-charts.js';
import {hydrateDashboardCharts} from './assistant-dashboards.js';
let controller,generation=0;
const operations=new Map();
const labels={general:'General business markets',singapore:'Singapore',fx:'Foreign exchange',trade:'Trade and supply chains',interest_rates:'Interest rates'};
const options=(values,selected)=>values.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>').join('');
export function cancelCustomDashboard(){generation++;controller?.abort();for(const c of operations.values())c.abort();operations.clear();}
function periodLabel(p){return p.kind==='months'?'Past '+p.months+' calendar months':p.kind==='rolling'?'Last '+p.days+' days':p.from+' to '+p.to;}
function preferencesHtml(p){
 return '<section class="panel custom-preferences" aria-labelledby="assistant-settings-title"><h2 id="assistant-settings-title">Assistant preferences</h2><p>These settings apply to future assistant requests. Financial permissions and Singapore dates stay the same.</p><form id="assistant-preferences-form"><div class="custom-settings-grid"><div class="field"><label for="assistant-style">Explanation style</label><select id="assistant-style" name="responseStyle">'+options([['concise','Concise'],['detailed','Detailed']],p.responseStyle)+'</select></div><div class="field"><label for="assistant-months">Default transaction trend period</label><select id="assistant-months" name="trendMonths">'+options(Array.from({length:12},(_,i)=>[String(i+1),(i+1)+' calendar months']),String(p.trendMonths))+'</select></div><div class="field"><label for="assistant-chart">New chart style</label><select id="assistant-chart" name="chartType">'+options([['bar','Bar graph'],['line','Line graph'],['table','Table']],p.chartType)+'</select></div><div class="field"><label for="assistant-topic">Default market topic</label><select id="assistant-topic" name="marketTopic">'+options(Object.entries(labels),p.marketTopic)+'</select></div></div><p class="error-message" role="alert"></p><button type="submit" class="button secondary">Save assistant preferences</button></form></section>';
}
function chartPaging(data){
 const page=data.pagination;
 return '<div class="assistant-dashboard-paging" data-custom-paging><span>Page '+page.page+' of '+Math.max(1,page.totalPages)+'</span><button type="button" class="text-button" data-custom-command="prev" '+(page.page<=1?'disabled':'')+'>Previous</button><button type="button" class="text-button" data-custom-command="next" '+(page.page>=page.totalPages?'disabled':'')+'>Next</button></div>';
}
function chartRecords(data){
 if(data.scopeType==='all')return chartPaging(data);
 return '<details class="custom-dashboard-records"><summary>Matching transactions</summary><div class="table-scroll"><table class="statement-table"><caption class="sr-only">Transactions with '+esc(data.company)+'</caption><thead><tr><th scope="col">Transaction</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead><tbody>'+data.transactions.map(row=>'<tr><td><button type="button" class="text-button" data-transaction="'+esc(row.id)+'">'+esc(row.description)+'</button><small>'+fullDate(row.completedAt||row.requestedAt||row.date)+'</small></td><td>'+statusPill(row.status)+'</td><td>'+money(row.amountCents)+'</td></tr>').join('')+'</tbody></table></div>'+chartPaging(data)+'</details>';
}
function chartBody(id){
 const remote=state.remote.customDashboard,item=remote?.charts?.[id],view=remote?.data?.views.find(v=>v.id===id);
 if(!item)return '<p role="status">Loading live chart...</p>';
 if(item.error)return '<p class="error-message" role="alert">'+esc(item.error)+'</p><button class="text-button" type="button" data-custom-command="refresh">Retry chart</button>';
 const data=item.dashboard;
 if(!data)return '<p role="status">Loading live chart...</p>';
 const total=data.totals;
 return '<p class="company-period">'+esc(data.company)+' &middot; '+esc(data.period.from)+' to '+esc(data.period.to)+' &middot; SGD &middot; Singapore time</p><p class="chart-note">Live query: '+fullDate(data.generatedAt)+'. Last saved refresh: '+(view?.refreshedAt?fullDate(view.refreshedAt):'not completed')+'. '+(view?.refreshCadence==='weekly'?'Weekly refresh next due: '+fullDate(view.nextRefreshAt)+'.':'Manual refresh.')+'</p>'+(view?.refreshError?'<p class="notice">The last scheduled refresh failed. These live figures were checked separately; retry the saved refresh below.</p>':'')+(data.status!=='ready'?'<p>No matching recorded company is available.</p>':'<div class="agent-metrics company-metrics"><div><span>Received</span><strong>'+money(total.incomeCents)+'</strong></div><div><span>Paid</span><strong>'+money(total.outgoingCents)+'</strong></div><div><span>Net movement</span><strong>'+money(total.netCents)+'</strong></div></div>'+companyCharts(data,'custom-'+id,view.presentation)+chartRecords(data))+(item.drilldown?'<button type="button" class="text-button" data-custom-command="reset">Back to saved chart</button>':'');
}
function settings(view){
 const p=view.presentation;
 return '<details class="custom-chart-settings"><summary>Customize chart</summary><form class="custom-chart-form" data-custom-form="'+esc(view.id)+'"><input type="hidden" name="version" value="'+view.version+'"><div class="custom-settings-grid"><div class="field"><label for="title-'+view.id+'">Chart title</label><input id="title-'+view.id+'" name="title" value="'+esc(view.title)+'" minlength="2" maxlength="80" required></div><div class="field"><label for="type-'+view.id+'">Chart style</label><select id="type-'+view.id+'" name="chartType">'+options([['bar','Bar graph'],['line','Line graph'],['table','Table']],p.chartType)+'</select></div><div class="field"><label for="cadence-'+view.id+'">Refresh schedule</label><select id="cadence-'+view.id+'" name="refreshCadence">'+options([['manual','Manual'],['weekly','Weekly']],view.refreshCadence)+'</select></div></div><label class="custom-checkbox"><input type="checkbox" name="showStatus" '+(p.showStatus?'checked':'')+'> Show transaction status</label><label class="custom-checkbox"><input type="checkbox" name="showCompanies" '+(p.showCompanies?'checked':'')+'> Show company comparison</label><p class="chart-note">Weekly snapshots use the existing scheduled job. Figures are also queried live whenever you open this page. The current month can be partial.</p><p class="error-message" role="alert"></p><button class="button secondary" type="submit">Save chart settings</button></form></details>';
}
export function customDashboardPage(){
 const remote=state.remote.customDashboard;
 const head=heading('My customized dashboard','Private charts saved from GLDB Assistant.', '<button type="button" class="button secondary" data-custom-command="reload">Reload dashboard</button><button type="button" class="button" data-custom-command="ask">Ask for a chart '+icon('chat')+'</button>');
 if(!remote||remote.loading)return head+'<div class="panel loading-state" role="status">Loading your saved charts...</div>';
 if(remote.error)return head+'<p class="error-message" role="alert">'+esc(remote.error)+'</p>';
 const views=remote.data.views;
 return head+preferencesHtml(remote.data.preferences)+(views.length?'<div class="custom-dashboard-list">'+views.map(view=>'<article class="panel custom-dashboard-card" data-custom-card="'+esc(view.id)+'"><div class="section-heading"><div><h2 data-custom-title>'+esc(view.title)+'</h2><p>'+esc(periodLabel(view.definition.period))+'</p></div><div class="custom-card-actions"><button type="button" class="text-button" data-custom-command="refresh">Refresh saved chart</button><button type="button" class="text-button danger-text" data-custom-command="remove">Remove</button></div></div><div data-custom-body>'+chartBody(view.id)+'</div>'+settings(view)+'<p class="error-message custom-action-error" role="alert"></p></article>').join('')+'</div>':'<section class="panel empty-state"><h2>No saved charts yet.</h2><p>Ask for transaction trends, then say &ldquo;Add this chart to my customized dashboard and refresh it weekly.&rdquo;</p><button type="button" class="button" data-custom-command="ask">Open assistant</button></section>');
}
function paint(id){
 const card=document.querySelector('[data-custom-card="'+id+'"]');
 if(card){card.querySelector('[data-custom-body]').innerHTML=chartBody(id);hydrateDashboardCharts(card);}
}
export async function loadCustomDashboard(){
 if(!state.user||state.signingOut)return;
 controller?.abort();controller=new AbortController();const current=++generation,valid=captureSession(),signal=controller.signal;
 const active=()=>valid()&&current===generation;
 state.remote.customDashboard={loading:true};
 if(state.route.page==='customDashboard')ui.render();
 try{
  const [saved,prefs]=await Promise.all([api('/dashboard-views',undefined,'GET',{signal}),api('/assistant-preferences',undefined,'GET',{signal})]);
  if(!active())return;
  const remote={data:{views:saved.views,preferences:prefs.preferences},charts:{},chartVersions:{}};state.remote.customDashboard=remote;
  if(state.route.page==='customDashboard')ui.render();
  for(let offset=0;offset<saved.views.length;offset+=4){
   if(!active())return;
   await Promise.all(saved.views.slice(offset,offset+4).map(async view=>{
    const version=remote.chartVersions[view.id]||0;
    try{const result=await api('/dashboard-views/'+encodeURIComponent(view.id),undefined,'GET',{signal});if(!active()||state.remote.customDashboard!==remote||(remote.chartVersions[view.id]||0)!==version)return;remote.charts[view.id]={dashboard:result.dashboard};}
    catch(error){if(!active()||error.status===-1||(remote.chartVersions[view.id]||0)!==version)return;if(await recoverSession(error)||!active())return;remote.charts[view.id]={error:error.message};}
    if(active())paint(view.id);
   }));
  }
 }catch(error){if(!active()||error.status===-1)return;if(await recoverSession(error)||!active())return;state.remote.customDashboard={error:error.message};if(state.route.page==='customDashboard')ui.render();}
}
async function operate(id,work){
 const remote=state.remote.customDashboard,valid=captureSession(),c=new AbortController();
 operations.get(id)?.abort();operations.set(id,c);
 const active=()=>valid()&&state.remote.customDashboard===remote&&operations.get(id)===c;
 try{await work({remote,active,signal:c.signal});}
 catch(error){if(!active()||error.status===-1)return;if(await recoverSession(error)||!active())return;const target=document.querySelector('[data-custom-card="'+id+'"] .custom-action-error')||document.querySelector('#assistant-preferences-form [role=alert]');if(target)target.textContent=error.message;}
 finally{if(operations.get(id)===c)operations.delete(id);}
}
export async function customDashboardControl(control){
 if(control.dataset.customCommand==='reload'){await loadCustomDashboard();return true;}
 if(control.dataset.customCommand==='ask'){ui.composeAssistant?.('Show my transaction trends over the past 6 months');return true;}
 const card=control.closest('[data-custom-card]');if(!card)return false;
 const id=card.dataset.customCard,command=control.dataset.customCommand;
 if(!command&&!control.dataset.companyChoice)return false;
 control.disabled=true;
 const remote=state.remote.customDashboard;if(!remote)return true;remote.chartVersions[id]=(remote.chartVersions[id]||0)+1;
 await operate(id,async({remote,active,signal})=>{
  const view=remote.data.views.find(v=>v.id===id);if(!view)return;
  if(command==='remove'){
   await api('/dashboard-views/'+encodeURIComponent(id),{},'DELETE',{signal});if(!active())return;
   remote.data.views=remote.data.views.filter(v=>v.id!==id);delete remote.charts[id];card.remove();if(!remote.data.views.length)ui.render();return;
  }
  const current=remote.charts[id],data=current?.dashboard,paging=command==='next'||command==='prev';
  if(paging&&(!data?.pagination||data.status!=='ready'))return;
  const page=paging?Math.max(1,Math.min(Math.max(1,data.pagination.totalPages),data.pagination.page+(command==='next'?1:-1))):1;
  const drilldown=Boolean(control.dataset.companyChoice||(paging&&current?.drilldown));
  const query=drilldown?'/company-activity?'+new URLSearchParams({scope:'company',company:control.dataset.companyChoice||data.company,from:data.period.from,to:data.period.to,page:String(page),pageSize:'10'}):'/dashboard-views/'+encodeURIComponent(id)+(command==='refresh'?'/refresh':paging?'?page='+page:'');
  const result=await api(query,command==='refresh'?{}:undefined,command==='refresh'?'POST':'GET',{signal});
  if(!active())return;
  if(result.view)remote.data.views=remote.data.views.map(v=>v.id===id?result.view:v);
  remote.charts[id]={dashboard:result.dashboard,drilldown};paint(id);
 });
 if(control.isConnected)control.disabled=false;return true;
}
export async function submitCustomSettings(form){
 const id=form.dataset.customForm,button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('[role=alert]').textContent='';
 await operate(id,async({remote,active,signal})=>{
  const values=new FormData(form),body={version:Number(values.get('version')),title:values.get('title'),refreshCadence:values.get('refreshCadence'),presentation:{chartType:values.get('chartType'),showStatus:values.has('showStatus'),showCompanies:values.has('showCompanies')}};
  const result=await api('/dashboard-views/'+encodeURIComponent(id),body,'PATCH',{signal});if(!active())return;
  remote.data.views=remote.data.views.map(v=>v.id===id?result.view:v);form.elements.version.value=result.view.version;form.closest('[data-custom-card]').querySelector('[data-custom-title]').textContent=result.view.title;paint(id);toast('Chart settings saved.');
 });if(button.isConnected)button.disabled=false;
}
export async function submitAssistantPreferences(form){
 const button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('[role=alert]').textContent='';
 await operate('preferences',async({remote,active,signal})=>{
  const values=Object.fromEntries(new FormData(form));values.trendMonths=Number(values.trendMonths);
  const result=await api('/assistant-preferences',values,'PATCH',{signal});if(!active())return;remote.data.preferences=result.preferences;toast('Assistant preferences saved.');
 });if(button.isConnected)button.disabled=false;
}
