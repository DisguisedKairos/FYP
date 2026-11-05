import {state,api,esc,icon,money,singaporeDay,captureSession,recoverSession,statusPill,fullDate} from './core.js';
import {companyCharts} from './company-charts.js';

const requests=new Map();
export function cancelAssistantDashboards(){for(const request of requests.values())request.abort();requests.clear();}
export function hydrateDashboardCharts(root){root?.querySelectorAll('[data-chart-height]').forEach(bar=>{bar.style.height=Number(bar.dataset.chartHeight)+'%';});}
function periodLabel(definition){const period=definition?.period;return period?.kind==='rolling'?'Latest '+period.days+' days':period?'Fixed dates: '+period.from+' to '+period.to:'';}
function paging(data,busy){
 const page=data.pagination;
 return '<div class="assistant-dashboard-paging"><span>Page '+page.page+' of '+Math.max(1,page.totalPages)+'</span><button type="button" class="text-button" data-dashboard-command="prev" '+(busy||page.page<=1?'disabled':'')+'>Previous</button><button type="button" class="text-button" data-dashboard-command="next" '+(busy||page.page>=page.totalPages?'disabled':'')+'>Next</button></div>';
}
function records(data,busy){
 if(data.scopeType==='all')return '<p class="chart-note">Company comparison bars show the current page of counterparties.</p>'+paging(data,busy);
 return '<details class="assistant-dashboard-records"><summary>Matching transactions</summary><div class="table-scroll"><table class="statement-table"><caption class="sr-only">Transactions with '+esc(data.company)+'</caption><thead><tr><th scope="col">Transaction</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead><tbody>'+data.transactions.map(row=>'<tr><td><button class="text-button" type="button" data-transaction="'+esc(row.id)+'">'+esc(row.description)+'</button><small>'+fullDate(row.completedAt||row.requestedAt||row.date)+'</small></td><td>'+statusPill(row.status)+'</td><td>'+money(row.amountCents)+'</td></tr>').join('')+'</tbody></table></div>'+paging(data,busy)+'</details>';
}
export function dashboardHtml(message){
 const dashboard=message.dashboard;
 const start='<section class="assistant-dashboard" data-assistant-dashboard="'+message.id+'" '+(!dashboard?'hidden':'')+' aria-busy="'+Boolean(message.dashboardBusy||dashboard?.busy)+'">';
 if(!dashboard)return start+'</section>';
 const data=dashboard.data,busy=Boolean(message.dashboardBusy||dashboard.busy),error='<p class="error-message" role="alert">'+esc(dashboard.error||'')+'</p>';
 if(!data)return start+'<p role="status">'+(busy?'Loading your dashboard...':'Dashboard unavailable.')+'</p>'+error+'</section>';
 if(data.status!=='ready')return start+'<h3>Choose a company</h3><p>'+esc(data.status==='not_found'?'No matching company in your transaction history. Ask about another recorded name.':'Several recorded names match. Select a company to see its activity.')+'</p><div class="company-choice-list">'+data.companies.map(name=>'<button type="button" class="button secondary" data-company-choice="'+esc(name)+'" '+(busy?'disabled':'')+'>'+esc(name)+'</button>').join('')+'</div>'+error+'</section>';
 const metric=(label,value)=>'<div><span>'+label+'</span><strong>'+esc(value)+'</strong></div>',totals=data.totals;
 return start+'<div data-company-dashboard><h3 tabindex="-1">'+esc(data.company)+'</h3><p class="company-period">'+esc(data.period.from)+' to '+esc(data.period.to)+' &middot; SGD &middot; Singapore time</p>'+
 (dashboard.savedView?'<p class="assistant-saved-notice">Saved: '+esc(dashboard.savedView.title)+' &middot; '+esc(periodLabel(dashboard.savedView.definition))+'</p>':'')+
 '<div class="agent-metrics company-metrics">'+metric('Received',money(totals.incomeCents))+metric('Paid',money(totals.outgoingCents))+metric('Net movement',money(totals.netCents))+'</div>'+
 companyCharts(data,'chat-dashboard-'+message.id)+records(data,busy)+
 '<p class="chart-note">'+esc(data.scope)+'</p><div class="assistant-dashboard-controls"><button type="button" class="text-button" data-dashboard-command="refresh" '+(busy?'disabled':'')+'>Refresh figures</button>'+
 (!dashboard.savedView&&dashboard.definition?'<button type="button" class="button secondary" data-dashboard-command="save" '+(busy?'disabled':'')+'>Save this dashboard</button>':'')+
 '</div><p class="assistant-dashboard-status" role="status">'+(busy?'Updating dashboard...':'')+'</p>'+error+'</div></section>';
}
export function savedDashboardsHtml(message){
 const views=message.savedDashboards,disabled=message.dashboardBusy?'disabled':'';
 return '<section class="assistant-saved-dashboards" data-assistant-saved-list="'+message.id+'" '+(!Array.isArray(views)?'hidden':'')+'>'+
 (!Array.isArray(views)?'':'<h3>Your saved dashboards</h3>'+(views.length?views.map(view=>'<article class="assistant-saved-card"><h4>'+esc(view.title)+'</h4><p>'+esc(view.definition.scope==='all'?'All companies':view.definition.company)+' &middot; '+esc(periodLabel(view.definition))+'</p><div><button type="button" class="button secondary" data-dashboard-command="open" data-view-id="'+esc(view.id)+'" '+disabled+'>Open in chat '+icon('arrow')+'</button><button type="button" class="text-button" data-dashboard-command="remove" data-view-id="'+esc(view.id)+'" '+disabled+'>Remove</button></div></article>').join(''):'<p>No saved dashboards yet. Ask me for a company dashboard, then save it for later.</p>')+'<button type="button" class="text-button" data-dashboard-command="list" '+disabled+'>Refresh saved list</button><p class="error-message" role="alert">'+esc(message.savedDashboardError||'')+'</p>')+'</section>';
}
function paint(message){
 const root=document.querySelector('#assistant-thread [data-message-id="'+message.id+'"]');
 if(root){const chart=root.querySelector('[data-assistant-dashboard]'),list=root.querySelector('[data-assistant-saved-list]');if(chart)chart.outerHTML=dashboardHtml(message);if(list)list.outerHTML=savedDashboardsHtml(message);hydrateDashboardCharts(root);}
 document.querySelector('#assistant-root')?.classList.toggle('assistant-has-dashboard',Boolean(state.assistant?.messages.some(item=>item.dashboard)));
}
function queryFor(definition,data,page){
 const period=definition?.period,range=period?.kind==='rolling'?{from:singaporeDay(Date.now()-(period.days-1)*86400000),to:singaporeDay()}:period?.kind==='fixed'?period:data.period;
 return new URLSearchParams({scope:definition?.scope||data.scopeType||'company',company:definition?.company??(data.scopeType==='all'?'':data.company||data.query||''),from:range.from,to:range.to,page:String(page),pageSize:'10'});
}
async function operate(message,key,work){
 if(!state.user||state.signingOut)return;
 const validSession=captureSession(),thread=state.assistant,controller=new AbortController();
 requests.get(key)?.abort();requests.set(key,controller);
 const active=()=>validSession() && state.assistant===thread && thread.messages.includes(message) && requests.get(key)===controller;
 message.dashboardBusy=true;
 if(message.dashboard){message.dashboard.busy=true;message.dashboard.error='';}message.savedDashboardError='';paint(message);
 try{await work({active,signal:controller.signal});}
 catch(error){if(!active()||error.status===-1)return;if(await recoverSession(error)||!active())return;if(message.dashboard)message.dashboard.error=error.message;else message.savedDashboardError=error.message;}
 finally{if(active()){message.dashboardBusy=false;if(message.dashboard)message.dashboard.busy=false;paint(message);requests.delete(key);}}
}
async function load(message,{company,page=1,viewId}={}){
 const prior=message.dashboard;
 if(!prior)message.dashboard={data:null,definition:null,savedView:null};
 await operate(message,'dashboard:'+message.id,async({active,signal})=>{
  const definition=company?{scope:'company',company,period:prior.definition?.period||{kind:'fixed',from:prior.data.period.from,to:prior.data.period.to}}:prior?.definition;
  const savedId=viewId||(!company?prior?.savedView?.id:null);
  const result=await api(savedId?'/dashboard-views/'+encodeURIComponent(savedId)+'?page='+page:'/company-activity?'+queryFor(definition,prior.data,page),undefined,'GET',{signal});
  if(!active())return;
  const data=result.dashboard;
  message.dashboard={data,definition:result.view?.definition||definition,savedView:result.view||null};
  if(data.status==='ready'&&data.scopeType!=='all')message.dashboard.definition={...message.dashboard.definition,company:data.company};
  state.assistant.activeDashboardDefinition=message.dashboard.definition;
  state.assistant.dashboardSelectionVersion=(state.assistant.dashboardSelectionVersion||0)+1;
 });
 const card=document.querySelector('#assistant-thread [data-message-id="'+message.id+'"] [data-company-dashboard]'),target=document.querySelector('#assistant-thread');
 if(card&&target)target.scrollTop+=card.getBoundingClientRect().top-target.getBoundingClientRect().top-12;
}
export async function dashboardControl(control){
 const container=control.closest('[data-assistant-dashboard],[data-assistant-saved-list]');
 if(!container)return false;
 const message=state.assistant?.messages.find(item=>String(item.id)===(container.dataset.assistantDashboard||container.dataset.assistantSavedList));
 if(!message||!state.user||state.signingOut)return true;
 const command=control.dataset.dashboardCommand;
 if(control.dataset.companyChoice){await load(message,{company:control.dataset.companyChoice});return true;}
 if(!command)return false;
 if(message.dashboardBusy||message.dashboard?.busy)return true;
 if(command==='open')await load(message,{viewId:control.dataset.viewId});
 else if(command==='refresh'||command==='prev'||command==='next')await load(message,{page:command==='refresh'?1:Math.max(1,message.dashboard.data.pagination.page+(command==='next'?1:-1))});
 else if(command==='save')await operate(message,'dashboard:'+message.id,async({active,signal})=>{
  const result=await api('/dashboard-views',{definition:message.dashboard.definition},'POST',{signal});
  if(active())message.dashboard.savedView=result.view;
 });
 else if(command==='list')await operate(message,'list:'+message.id,async({active,signal})=>{const result=await api('/dashboard-views',undefined,'GET',{signal});if(active())message.savedDashboards=result.views;});
 else if(command==='remove')await operate(message,'list:'+message.id,async({active,signal})=>{
  const id=control.dataset.viewId;await api('/dashboard-views/'+encodeURIComponent(id),{},'DELETE',{signal});
  if(!active())return;
  for(const entry of state.assistant.messages){if(Array.isArray(entry.savedDashboards))entry.savedDashboards=entry.savedDashboards.filter(view=>view.id!==id);if(entry.dashboard?.savedView?.id===id)entry.dashboard.savedView=null;paint(entry);}
 });
 return true;
}
