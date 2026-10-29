'use strict';
const {validProvenance,fingerprint}=require('./ai-provider');
const {HttpError}=require('../models/errors');
const {assertActor}=require('./agents/reports');
async function modelActivity(db,user,{days='30',now=Date.now,activeModel}={}){
  await assertActor(db,user,{admin:true});
  if(!/^(?:[1-9]|[1-8][0-9]|90)$/.test(String(days)))throw new HttpError(400,'Choose a monitoring window from 1 to 90 days.');
  if(!validProvenance(activeModel))throw new HttpError(503,'Current AI provider provenance is unavailable.');
  const end=now(),from=new Date(end-Number(days)*86400000).toISOString();
  const rows=(await db.query('SELECT result_json FROM fraud_assessments WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC,id LIMIT 1001',[from,new Date(end).toISOString()])).rows;
  const decisions={allow:0,review:0,block:0},scores=[];let missing=0,legacy=0,otherModel=0;
  for(const {result_json:r} of rows.slice(0,1000)){
    if(!r){missing++;continue;}
    if(r.provider!==activeModel.provider){legacy++;continue;}
    if(fingerprint(r)!==fingerprint(activeModel) || r.modelName!==activeModel.modelName || r.promptSha256!==activeModel.promptSha256){otherModel++;continue;}
    if(!Number.isInteger(r.modelScore) || r.modelScore<0 || r.modelScore>94 || !Object.hasOwn(decisions,r.decision)){missing++;continue;}
    scores.push(r.modelScore);decisions[r.decision]++;
  }
  return {generatedAt:new Date(end).toISOString(),days:Number(days),from,provider:activeModel.provider,model:activeModel,
    sampled:Math.min(rows.length,1000),scored:scores.length,missing,legacy,otherModel,truncated:rows.length>1000,
    status:scores.length?'recorded':'no_assessments',decisions,
    scoreSummary:scores.length?{minimum:Math.min(...scores),maximum:Math.max(...scores),mean:Number((scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2))}:null,
    limitations:['These are recorded AI model outputs, not verified fraud outcomes.','No accuracy, precision, recall, calibration or synthetic evaluation is claimed.','Historical assessments from the retired model remain audit evidence and are excluded from current model counts.','A low score is not proof of safety. Financial rules and independent human review remain separate.']};
}
module.exports={modelActivity};
