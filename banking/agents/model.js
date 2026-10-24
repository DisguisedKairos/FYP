'use strict';

const { HttpError } = require('../../models/errors');
// Ollama is an optional local-only language model. It is not the risk scorer.
function createLocalModel({ mode=process.env.AGENT_MODE || 'workflow', model=process.env.AGENT_MODEL || '', url=process.env.AGENT_OLLAMA_URL || 'http://127.0.0.1:11434', fetchImpl=fetch }={}) {
  if(!['workflow','ollama'].includes(mode))throw new Error('AGENT_MODE must be workflow or ollama.');
  const origin=new URL(url);
  if(origin.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash)throw new Error('AGENT_OLLAMA_URL must be a plain loopback HTTP origin.');
  if(mode==='ollama' && (!/^[A-Za-z0-9._:/-]{1,100}$/.test(model) || /cloud/i.test(model)))throw new Error('Choose an installed local AGENT_MODEL; cloud models are not allowed.');
  async function request(path,body,signal){
    try{
      const response=await fetchImpl(new URL(path,origin),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error();
      let bytes=0,parts=[];
      for await(const part of response.body){bytes+=part.length;if(bytes>256000)throw new Error();parts.push(Buffer.from(part));}
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    }catch{throw new HttpError(503,'The local language model is unavailable. Use the offline workflow or check Ollama.');}
  }
  async function inspect(){
    if(mode!=='ollama')return {mode,configured:false,available:false,model:null,localOnly:true};
    try{
      const info=await request('/api/show',{model},AbortSignal.timeout(3000));
      const local=!info.remote_model && !info.remote_host;
      const tools=Array.isArray(info.capabilities) && info.capabilities.includes('tools');
      return {mode,configured:true,available:local&&tools,model,localOnly:true,reason:!local?'Remote models are refused.':!tools?'The model must support tool calling.':null};
    }catch{return {mode,configured:true,available:false,model,localOnly:true,reason:'Start Ollama and install the configured tool-capable model.'};}
  }
  async function chat(messages,tools,{signal}={}){
    if(mode!=='ollama')throw new HttpError(503,'No local language model is configured.');
    const data=await request('/api/chat',{model,messages,tools,stream:false,think:false,options:{temperature:0,num_ctx:8192,num_predict:700},keep_alive:'10m'},signal || AbortSignal.timeout(25000));
    const message=data.message;
    if(!message || message.role!=='assistant' || typeof message.content!=='string' || message.content.length>12000 || (message.tool_calls!==undefined && (!Array.isArray(message.tool_calls)||message.tool_calls.length>4)))throw new HttpError(503,'The local model returned an invalid response.');
    return {role:'assistant',content:message.content,...(message.tool_calls?.length?{tool_calls:message.tool_calls}: {})};
  }
  return {mode,model:mode==='ollama'?model:null,inspect,chat};
}
module.exports={createLocalModel};
