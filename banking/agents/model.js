'use strict';

const { HttpError } = require('../../models/errors');
// AI requests require the installed local Ollama model; there is no offline engine.
function createLocalModel({ mode=process.env.AGENT_MODE || 'ollama', model=process.env.AGENT_MODEL || 'qwen3.5:4b', url=process.env.AGENT_OLLAMA_URL || 'http://127.0.0.1:11434', fetchImpl=fetch }={}) {
  if(mode!=='ollama')throw new Error('AGENT_MODE must be ollama. Offline AI engines are not supported.');
  const origin=new URL(url);
  if(origin.protocol!=='http:' || !['127.0.0.1','localhost','[::1]','ollama'].includes(origin.hostname) || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash)throw new Error('AGENT_OLLAMA_URL must use loopback or the private Compose Ollama service.');
  if(!/^[A-Za-z0-9._:/-]{1,100}$/.test(model) || /cloud/i.test(model))throw new Error('Choose an installed local AGENT_MODEL; cloud models are not allowed.');
  async function request(path,body,signal){
    try{
      const response=await fetchImpl(new URL(path,origin),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error();
      let bytes=0,parts=[];
      for await(const part of response.body){bytes+=part.length;if(bytes>256000)throw new Error();parts.push(Buffer.from(part));}
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    }catch{throw new HttpError(503,'The local language model is unavailable. Start Ollama with the configured model and retry.');}
  }
  async function inspect(){
    try{
      const info=await request('/api/show',{model},AbortSignal.timeout(3000));
      const local=!info.remote_model && !info.remote_host;
      const tools=Array.isArray(info.capabilities) && info.capabilities.every(c=>typeof c==='string') && info.capabilities.includes('completion') && info.capabilities.includes('tools');
      return {mode,configured:true,available:local&&tools,model,localOnly:true,reason:!local?'Remote models are refused.':!tools?'The model must support tool calling.':null};
    }catch{return {mode,configured:true,available:false,model,localOnly:true,reason:'Start Ollama and install the configured tool-capable model.'};}
  }
  async function chat(messages,tools,{signal}={}){
    const data=await request('/api/chat',{model,messages,tools,stream:false,think:false,options:{temperature:0,num_ctx:8192,num_predict:700},keep_alive:'10m'},signal || AbortSignal.timeout(25000));
    const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
    const invalid=()=>new HttpError(503,'The local model returned an invalid or incomplete response. Retry the request.');
    if(!object(data) || Object.hasOwn(data,'error') || data.done!==true || data.done_reason!=='stop' || ![model,`${model}:latest`].includes(data.model))throw invalid();
    const message=data.message;
    if(!object(message) || message.role!=='assistant' || typeof message.content!=='string' || message.content.length>12000 || (message.tool_calls!==undefined && (!Array.isArray(message.tool_calls)||message.tool_calls.length>4 || message.tool_calls.some(c=>!object(c) || !object(c.function) || typeof c.function.name!=='string' || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(c.function.name) || !(object(c.function.arguments) || typeof c.function.arguments==='string')))))throw invalid();
    return {role:'assistant',content:message.content,...(message.tool_calls?.length?{tool_calls:message.tool_calls}: {})};
  }
  return {mode,model,inspect,chat};
}
module.exports={createLocalModel};
