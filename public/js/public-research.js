import {esc,fullDate} from './core.js';
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function partHtml(part){
 let at=0,html='';
 for(const a of part.annotations||[]){
  const url=safeUrl(a.url);if(!url||!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<at||a.end<=a.start||a.end>part.text.length)continue;
  html+=esc(part.text.slice(at,a.start))+'<a class="public-research-citation" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'+esc(a.title||new URL(url).hostname)+'</a>';at=a.end;
 }
 return html+esc(part.text.slice(at));
}
function counterpartyHtml(scan){
 if(!scan)return '';
 const labels={completed:'Research completed; identity review required',partial:'Partial research; some checks unavailable',unavailable:'Public research unavailable',no_counterparties:'No searchable recent counterparties'};
 const links=(scan.officialSources||[]).map(source=>{const url=safeUrl(source.url);return url?'<li><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'+esc(source.title)+'</a></li>':'';}).join('');
 return '<section class="public-research-card counterparty-scan" aria-label="Counterparty news and compliance research"><h3>Counterparty news and compliance research</h3><p role="status">'+esc(labels[scan.status]||'Review the research coverage')+'</p><p class="chart-note">Selected '+esc(scan.companies.length)+' of '+esc(scan.totalCompanyCount)+' recorded names from completed external receipts over the last '+esc(scan.period.days)+' days. '+esc(scan.omittedCompanyCount)+' names were omitted. Public searches use only selected names and a generic industry topic.</p>'+(scan.companies.length?'<p>Names selected: '+scan.companies.map(esc).join('; ')+'. Industry context: '+esc(scan.industryTopic)+'.</p>':'<p>No company names were sent for public research. Use a business account with completed external receipts or open the official sources below.</p>')+(scan.failures||[]).map(f=>'<p class="notice">'+esc(f.message)+'</p>').join('')+'<p class="chart-note">'+esc(scan.scope)+'</p><p class="notice">Name-based web research cannot establish sanctions clearance, full compliance or permission to pay. Review source dates, legal entity identifiers and applicable jurisdictions with a human reviewer. A missing search result is inconclusive.</p><details><summary>Official sources for manual checks</summary><ul>'+links+'</ul></details></section>';
}
export function publicResearchHtml(message){
 return counterpartyHtml(message.counterpartyScan)+(Array.isArray(message.publicResearch)?message.publicResearch:[]).slice(0,2).map(result=>'<section class="public-research-card" aria-label="Sourced public research"><h3>'+esc(result.title)+'</h3><p class="chart-note">Public sources checked '+fullDate(result.checkedAt)+'. Publication dates appear in the report where available.</p><div class="public-research-text">'+(result.parts||[]).map(p=>'<p>'+partHtml(p)+'</p>').join('')+'</div><p class="chart-note">'+esc(result.scope)+'</p></section>').join('');
}
