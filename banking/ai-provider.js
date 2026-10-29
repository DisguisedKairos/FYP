'use strict';
const {createHash}=require('node:crypto');
const identity=model=>createHash('sha256').update('openai:'+model).digest('hex');
function validProvenance(value){
  if(!value || typeof value.modelName!=='string' || !/^[A-Za-z0-9._:/-]{1,100}$/.test(value.modelName) || !/^[a-f0-9]{64}$/.test(value.promptSha256 || ''))return false;
  return value.provider==='openai' && value.modelIdentitySha256===identity(value.modelName) && value.modelSha256===undefined;
}
// The legacy digest is read only when inspecting retained historical evidence.
const fingerprint=value=>value?.modelIdentitySha256 || value?.modelSha256;
module.exports={identity,validProvenance,fingerprint};
