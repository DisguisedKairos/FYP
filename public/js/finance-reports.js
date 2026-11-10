import {state,api,esc,icon,fullDate,captureSession,recoverSession} from './core.js';

const downloads=new Map();
export function financeReportHtml(message){
  const report=message.financeReport;if(!report)return '';
  return '<section class="assistant-finance-report" data-finance-report="'+message.id+'" aria-busy="'+Boolean(message.financeBusy)+'"><h3>Download finance report</h3><p>'+esc(report.period.from)+' to '+esc(report.period.to)+' &middot; SGD &middot; Singapore time</p><p>Preview generated '+esc(fullDate(report.generatedAt))+' SGT. Each download refreshes the latest committed ledger data for this period.</p><div class="assistant-finance-actions">'+['csv','pdf'].map(format=>'<button type="button" class="button secondary" data-finance-format="'+format+'" '+(message.financeBusy?'disabled':'')+'>Download '+format.toUpperCase()+' '+icon('down')+'</button>').join('')+'</div><p class="assistant-finance-status" role="status">'+(message.financeBusy?'Preparing your latest report...':'')+'</p><p class="error-message" role="alert">'+esc(message.financeError||'')+'</p></section>';
}
function paint(message){const target=document.querySelector('[data-finance-report="'+message.id+'"]');if(target)target.outerHTML=financeReportHtml(message);}
export function cancelFinanceReports(){
  for(const request of downloads.values())request.abort();downloads.clear();
  for(const message of state.assistant?.messages||[]){if(message.financeReport){message.financeBusy=false;paint(message);}}
}
export async function financeReportControl(control){
  const format=control.dataset.financeFormat;if(!format)return false;
  const card=control.closest('[data-finance-report]'),thread=state.assistant,message=thread?.messages.find(row=>String(row.id)===card?.dataset.financeReport);
  if(!message?.financeReport || !['csv','pdf'].includes(format) || message.financeBusy || !state.user || state.signingOut)return true;
  const validSession=captureSession(),request=new AbortController(),period=message.financeReport.period;
  const active=()=>validSession() && state.assistant===thread && downloads.get(message.id)===request;
  downloads.set(message.id,request);message.financeBusy=true;message.financeError='';paint(message);
  let url;
  try{
    const result=await api('/reports/finance?'+new URLSearchParams({from:period.from,to:period.to,format}),undefined,'GET',{responseType:'blob',signal:request.signal,timeoutMs:60000});
    if(!active() || request.signal.aborted)return true;
    const mime=format==='pdf'?'application/pdf':'text/csv';
    if(!result.blob.type.startsWith(mime))throw new Error('The server returned an unexpected report format. Please try again.');
    url=URL.createObjectURL(result.blob);
    const link=document.createElement('a');
    link.href=url;link.download='greenlink-finance-'+period.from+'-to-'+period.to+'.'+format;
    document.body.append(link);link.click();link.remove();
    message.financeError='';
  }catch(error){
    if(active() && error.status!==-1 && !await recoverSession(error) && active())message.financeError=error.message;
  }finally{
    if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(active()){downloads.delete(message.id);message.financeBusy=false;paint(message);}
  }
  return true;
}
