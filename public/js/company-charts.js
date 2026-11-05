import {esc,icon,money} from './core.js';

const axisMoney=new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD',notation:'compact',maximumFractionDigits:1});
const legend=()=>'<div class="activity-chart-legend"><span><i class="activity-swatch received"></i>Received</span><span><i class="activity-swatch paid"></i>Paid</span></div>';
const monthName=value=>new Date(value+'-01T00:00:00Z').toLocaleDateString('en-SG',{month:'short',year:'numeric',timeZone:'Asia/Singapore'});
function monthlyChart(data,prefix){
 const peak=Math.max(0,...data.months.flatMap(row=>[row.incomeCents,row.outgoingCents]));
 const magnitude=10**Math.floor(Math.log10(Math.max(1,peak/4)));
 const step=Math.max(1,[1,2,5,10].find(value=>value*magnitude>=peak/4)*magnitude),ceiling=step*4;
 const table='<details class="company-months"><summary>Monthly amounts</summary><div class="table-scroll"><table class="statement-table"><caption class="sr-only">Monthly completed activity with '+esc(data.company)+'</caption><thead><tr><th scope="col">Month (SGT)</th><th scope="col">Received</th><th scope="col">Paid</th></tr></thead><tbody>'+data.months.map(row=>'<tr><th scope="row">'+esc(monthName(row.month))+'</th><td>'+money(row.incomeCents)+'</td><td>'+money(row.outgoingCents)+'</td></tr>').join('')+'</tbody></table></div></details>';
 const graph=peak?'<div class="activity-month-layout"><div class="activity-y-axis" aria-hidden="true">'+[4,3,2,1,0].map(tick=>'<span>'+esc(axisMoney.format(step*tick/100))+'</span>').join('')+'</div><div class="activity-month-scroll" tabindex="0" role="region" aria-label="Monthly bar graph. Scroll horizontally for more months."><div class="activity-month-plot">'+data.months.map(row=>{
  const label=monthName(row.month),amounts=label+': '+money(row.incomeCents)+' received, '+money(row.outgoingCents)+' paid';
  return '<div class="activity-month-column"><div class="activity-month-bars" role="img" aria-label="'+esc(amounts)+'" title="'+esc(amounts)+'"><span class="activity-month-bar received" data-chart-height="'+row.incomeCents/ceiling*100+'" aria-hidden="true"></span><span class="activity-month-bar paid" data-chart-height="'+row.outgoingCents/ceiling*100+'" aria-hidden="true"></span></div><span class="activity-month-label">'+esc(label)+'</span></div>';
 }).join('')+'</div></div></div>':'<p class="activity-chart-empty">No completed payments in this period. Pending and rejected transactions appear in the status chart.</p>';
 return '<section class="panel company-chart activity-month-card" aria-labelledby="'+prefix+'-month-title"><h2 id="'+prefix+'-month-title">Monthly payment activity</h2><p class="activity-chart-caption">Received and paid amounts in SGD &middot; Completed payments only</p>'+legend()+graph+table+'</section>';
}
function comparisonChart(data,prefix){
 const rows=data.companies,peak=Math.max(1,...rows.flatMap(row=>[row.incomeCents,row.outgoingCents]));
 const first=rows.length?(data.pagination.page-1)*data.pagination.pageSize+1:0,last=rows.length?first+rows.length-1:0;
 return '<section class="panel activity-company-card" aria-labelledby="'+prefix+'-company-title"><h2 id="'+prefix+'-company-title">Company comparison</h2><p class="activity-chart-caption">Companies '+first+'-'+last+' of '+data.totals.companyCount+' &middot; Completed amounts in SGD</p>'+legend()+(rows.length?'<p class="chart-note">Bars share the same scale on this page. Select a company to open its transactions.</p><div class="activity-company-bars">'+rows.map(row=>{
  const received=money(row.incomeCents),paid=money(row.outgoingCents),description=row.company+': '+received+' received, '+paid+' paid. Open company activity.';
  return '<button class="activity-company-bar" type="button" data-company-choice="'+esc(row.company)+'" aria-label="'+esc(description)+'"><span class="activity-company-name">'+esc(row.company)+icon('arrow')+'</span><svg viewBox="0 0 400 30" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="activity-bar-track" width="400" height="11" rx="3"/><rect class="activity-bar-track" y="18" width="400" height="11" rx="3"/><rect class="received" width="'+row.incomeCents/peak*400+'" height="11" rx="3"/><rect class="paid" y="18" width="'+row.outgoingCents/peak*400+'" height="11" rx="3"/></svg><span class="activity-company-values"><span>Received <strong>'+received+'</strong></span><span>Paid <strong>'+paid+'</strong></span></span></button>';
 }).join('')+'</div>':'<p class="activity-chart-empty">No company activity in this period.</p>')+'</section>';
}
function statusChart(data,prefix){
 const statuses=[{label:'Completed',value:data.totals.completedCount,kind:'completed'},{label:'Awaiting review',value:data.totals.pendingCount,kind:'pending'},{label:'Rejected',value:data.totals.rejectedCount,kind:'rejected'}];
 const total=statuses.reduce((sum,row)=>sum+row.value,0),description=statuses.map(row=>row.label+': '+row.value).join('. ');
 let offset=0;
 const arcs=statuses.map(row=>{const percent=total?row.value/total*100:0,arc='<circle class="activity-status-arc '+row.kind+'" cx="60" cy="60" r="44" pathLength="100" stroke-dasharray="'+percent+' '+(100-percent)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 60 60)"/>';offset+=percent;return arc;}).join('');
 return '<section class="panel activity-status-card '+(data.scopeType==='all'?'':'activity-status-wide')+'" aria-labelledby="'+prefix+'-status-title"><h2 id="'+prefix+'-status-title">Transaction status</h2><p class="activity-chart-caption">Transaction counts across the selected period</p><div class="activity-status-layout"><svg class="activity-status-ring" viewBox="0 0 120 120" role="img" aria-label="'+esc(description)+'"><circle class="activity-status-track" cx="60" cy="60" r="44"/>'+arcs+'<text class="activity-status-total" x="60" y="58" text-anchor="middle">'+total+'</text><text class="activity-status-label" x="60" y="74" text-anchor="middle">transactions</text></svg><dl class="activity-status-legend">'+statuses.map(row=>'<div><dt><i class="activity-swatch '+row.kind+'"></i>'+row.label+'</dt><dd>'+row.value+' <span>'+(total?(row.value/total*100).toFixed(1):'0.0')+'%</span></dd></div>').join('')+'</dl></div><p class="chart-note">Only completed transactions contribute to received, paid and net amounts.</p></section>';
}
export function companyCharts(data,prefix='company-dashboard'){
 return '<div class="company-visual-grid">'+monthlyChart(data,prefix)+(data.scopeType==='all'?comparisonChart(data,prefix):'')+statusChart(data,prefix)+'</div>';
}
