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
export function publicResearchHtml(message){
 if(!Array.isArray(message.publicResearch))return '';
 return message.publicResearch.slice(0,2).map(result=>'<section class="public-research-card" aria-label="Sourced public research"><h3>'+esc(result.title)+'</h3><p class="chart-note">Public sources checked '+fullDate(result.checkedAt)+'. Publication dates appear in the report where available.</p><div class="public-research-text">'+(result.parts||[]).map(p=>'<p>'+partHtml(p)+'</p>').join('')+'</div><p class="chart-note">'+esc(result.scope)+'</p></section>').join('');
}
