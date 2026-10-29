'use strict';
const {HttpError}=require('../../models/errors');
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const ENDPOINT='https://api.openai.com/v1/';
function createOpenAIModel({model=process.env.OPENAI_MODEL || 'gpt-6-luna',apiKey=process.env.OPENAI_API_KEY || '',fetchImpl=fetch}={}){
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(model))throw new Error('Choose a valid OPENAI_MODEL identifier.');
  const configured=typeof apiKey==='string' && /^[^\s]{20,4096}$/.test(apiKey);
  const unavailable=()=>new HttpError(503,'OpenAI is unavailable. Check the server API key, model access, billing and connection. No payment was executed.');
  async function request(path,body,signal){
    if(!configured)throw unavailable();
    try{
      const response=await fetchImpl(new URL(path,ENDPOINT),{method:body?'POST':'GET',redirect:'error',signal,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok)throw unavailable();
      let bytes=0;const parts=[];
      for await(const part of response.body){bytes+=part.length;if(bytes>256000)throw unavailable();parts.push(Buffer.from(part));}
      const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(!object(data) || data.error)throw unavailable();
      return data;
    }catch{throw unavailable();}
  }
  async function inspect(){
    const status={mode:'openai',configured,available:false,model,localOnly:false,externalServices:true};
    if(!configured)return {...status,reason:'Set OPENAI_API_KEY in the server environment.'};
    try{const data=await request('models/'+encodeURIComponent(model),null,AbortSignal.timeout(5000));return {...status,available:data.id===model,reason:data.id===model?null:'The configured model is unavailable.'};}
    catch{return {...status,reason:'Check OpenAI API credentials, model access and connection.'};}
  }
  async function chat(messages,tools,{signal}={}){
    const input=[],pending=[];
    for(const [index,message] of messages.entries()){
      if(message.role==='assistant' && message.tool_calls?.length){
        if(message.responseItems)input.push(...message.responseItems);
        for(const [position,call] of message.tool_calls.entries()){
          const id=call.id || 'call_greenlink_'+index+'_'+position;
          if(!/^[A-Za-z0-9_-]{1,150}$/.test(id))throw unavailable();
          pending.push({id,name:call.function.name});
          if(!message.responseItems)input.push({type:'function_call',call_id:id,name:call.function.name,arguments:typeof call.function.arguments==='string'?call.function.arguments:JSON.stringify(call.function.arguments)});
        }
      }else if(message.role==='tool'){
        const index=pending.findIndex(c=>message.tool_call_id?c.id===message.tool_call_id:c.name===message.tool_name);
        if(index<0)throw unavailable();
        const [call]=pending.splice(index,1);
        input.push({type:'function_call_output',call_id:call.id,output:message.content});
      }else input.push({role:message.role,content:message.content});
    }
    const schemas=tools.map(({function:fn})=>{
      const required=new Set(fn.parameters.required || []);
      return {type:'function',name:fn.name,description:fn.description,strict:true,parameters:{...fn.parameters,properties:Object.fromEntries(Object.entries(fn.parameters.properties).map(([key,value])=>[key,required.has(key)?value:{...value,type:[value.type,'null']} ])),required:Object.keys(fn.parameters.properties)}};
    });
    const data=await request('responses',{model,input,tools:schemas,store:false,include:['reasoning.encrypted_content'],...(/^gpt-[56]/.test(model)?{reasoning:{effort:'low'}}:{}),parallel_tool_calls:false,max_output_tokens:1800},signal || AbortSignal.timeout(45000));
    const invalid=()=>new HttpError(503,'OpenAI returned an invalid, refused or incomplete response. Retry the request.');
    if(data.status!=='completed' || data.incomplete_details || typeof data.model!=='string' || !(data.model===model || data.model.startsWith(model+'-')) || !Array.isArray(data.output) || data.output.length>30)throw invalid();
    let content='';const calls=[];
    for(const item of data.output){
      if(item.type==='reasoning')continue;
      if(item.type==='function_call'){
        if(typeof item.call_id!=='string' || !/^[A-Za-z0-9_-]{1,150}$/.test(item.call_id) || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(item.name || '') || typeof item.arguments!=='string' || item.arguments.length>12000)throw invalid();
        let args;try{args=JSON.parse(item.arguments);}catch{throw invalid();}if(!object(args))throw invalid();
        const fn=tools.find(t=>t.function.name===item.name)?.function;
        if(!fn)throw invalid();
        // Strict schemas encode optional arguments as nullable. Omit only those optional nulls.
        args=Object.fromEntries(Object.entries(args).filter(([key,value])=>value!==null || fn.parameters.required.includes(key)));
        calls.push({id:item.call_id,function:{name:item.name,arguments:args}});
      }else if(item.type==='message' && item.role==='assistant' && Array.isArray(item.content)){
        for(const part of item.content){if(part.type!=='output_text' || typeof part.text!=='string')throw invalid();content+=part.text;}
      }else throw invalid();
    }
    if(content.length>12000 || calls.length>4 || (!content.trim() && !calls.length))throw invalid();
    return {role:'assistant',content,...(calls.length?{tool_calls:calls,responseItems:data.output}:{}),modelResponse:{provider:'openai',model:data.model,responseId:typeof data.id==='string'?data.id:null}};
  }
  return {mode:'openai',model,inspect,chat};
}
module.exports={createOpenAIModel};
