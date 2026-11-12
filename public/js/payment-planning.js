import {esc,money,fullDate} from './core.js';

const STATUS={covered:'Current funds cover this conservative payment scenario.',needs_funding:'More settled funds are needed in this payment scenario.',needs_details:'More details are needed before checking funding.',unavailable:'The full payment scenario could not be calculated. Ask for a shorter deadline.'};
const metrics=rows=>'<dl class="payment-plan-metrics">'+rows.filter(([,value])=>Number.isSafeInteger(value)).map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+money(value)+'</dd></div>').join('')+'</dl>';
export function paymentReadinessHtml(message){
  const plan=message.paymentReadiness;if(!plan)return '';
  const flow=plan.flow;
  return '<section class="assistant-payment-plan" data-payment-readiness="'+message.id+'"><h3>Company payment funding check</h3><p class="payment-plan-status '+(plan.status==='covered'?'covered':'needs-attention')+'" role="status">'+esc(STATUS[plan.status]||STATUS.unavailable)+'</p>'+
    (flow?'<h4>Completed business cash flow</h4><p>'+esc(flow.period.from)+' to '+esc(flow.period.to)+' &middot; Singapore time &middot; all your accounts</p>'+metrics([['Inflow received',flow.incomeCents],['Outflow paid',flow.outgoingCents],['Net movement',flow.netCents]]):'')+
    (plan.source?'<h4>'+esc(plan.source.name)+'</h4><p>Source account '+esc(plan.source.number)+'</p>'+(flow?.source?metrics([['Source inflow received',flow.source.incomeCents],['Source outflow paid',flow.source.outgoingCents]]):''):'')+
    '<h4>Additional proposed payment</h4><p>'+esc(plan.company||'Recipient company not specified')+(plan.company?' &middot; name as entered; recipient not verified':'')+'</p>'+
    (plan.deadline?'<p><strong>Payment deadline (SGT): '+esc(plan.deadline.date)+'</strong> &middot; end of day</p>':'')+
    metrics([['Current source balance',plan.source?.balanceCents],['Active outgoing schedules through deadline',plan.scheduledOutgoingCents],['Proposed payment',plan.amountCents],['Remaining after schedules and payment',plan.afterPaymentCents],['Additional settled funds needed',plan.shortageCents],['Scheduled incoming credits excluded',plan.scheduledIncomingCents]])+
    (plan.missing?.length?'<ul class="payment-plan-missing">'+plan.missing.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul><p>Include the amount, source account and deadline together in your next question.</p>':'')+
    '<details><summary>Planning assumptions</summary><ul>'+plan.notes.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul></details><small>Checked '+esc(fullDate(plan.generatedAt))+' SGT. This snapshot can change before payment authorization.</small></section>';
}
