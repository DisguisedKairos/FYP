import {esc} from './core.js';
export function modelActivityPanel(remote){
  if(!remote)return '<section class="panel"><h2>AI model activity</h2><p>Loading recorded model activity...</p></section>';
  if(remote.error)return '<section class="panel"><h2>AI model activity</h2><p>'+esc(remote.error)+'</p></section>';
  const r=remote.data;
  return '<section class="panel" data-model-activity><div class="section-heading"><h2>AI model activity</h2><span class="tag">'+esc(r.model.modelName)+'</span></div><p data-model-monitoring-status>'+esc(r.scored?r.scored+' assessments from the current configured model.':'No assessments from the current configured model yet.')+'</p><div class="agent-metrics">'+['allow','review','block'].map(k=>'<div><span>'+esc(k)+'</span><strong>'+r.decisions[k]+'</strong></div>').join('')+'</div><p>'+r.legacy+' historical assessments from the retired model excluded; '+r.missing+' incomplete attempts.</p><ul>'+r.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section>';
}
