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
  async function chat(messages,tools,{signal,maxOutputTokens=1800,requireTool=false}={}){
    if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<1800||maxOutputTokens>4000)throw new HttpError(400,'Invalid model output limit.');
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
      return {type:'function',name:fn.name,description:fn.description,strict:true,parameters:{...fn.parameters,properties:Object.fromEntries(Object.entries(fn.parameters.properties).map(([key,value])=>[key,required.has(key)?value:{...value,type:[value.type,'null'],...(value.enum?{enum:[...value.enum,null]}:{})} ])),required:Object.keys(fn.parameters.properties)}};
    });
    const data=await request('responses',{model,input,tools:schemas,store:false,include:['reasoning.encrypted_content'],...(/^gpt-[56]/.test(model)?{reasoning:{effort:'low'}}:{}),parallel_tool_calls:false,...(requireTool?{tool_choice:'required'}:{}),max_output_tokens:maxOutputTokens},signal || AbortSignal.timeout(45000));
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

  async function research(publicRequest,{signal}={}){
    const publicResearch=require('../public-research');
    if(!publicRequest||!['company','market','counterparty_sanctions','counterparty_news'].includes(publicRequest.kind)||typeof publicRequest.query!=='string'||publicRequest.query.length>1800)throw new HttpError(400,'Choose a valid public research task.');
    const data=await request('responses',{model,instructions:publicResearch.instructionsFor(publicRequest)+' Server check time: '+publicRequest.checkedAt,input:publicRequest.query,tools:[{type:'web_search',external_web_access:true,search_context_size:'low',...(publicRequest.kind==='counterparty_sanctions'?{filters:{allowed_domains:publicResearch.OFFICIAL_DOMAINS}}:{})}],tool_choice:'required',store:false,max_output_tokens:publicRequest.kind.startsWith('counterparty_')?2600:1800,...(/^gpt-[56]/.test(model)?{reasoning:{effort:'low'}}:{})},signal||AbortSignal.timeout(25000));
    return publicResearch.parseResponse(data,model,publicRequest);
  }
  async function assessCounterparties(input,{signal}={}){
    const risk=require('../counterparty-risk');
    if(!input||!Array.isArray(input.companies)||!input.companies.length||input.companies.length>risk.LIMIT||Buffer.byteLength(JSON.stringify(input))>32000)throw new HttpError(400,'Choose a bounded owned counterparty portfolio.');
    const reply=await chat([{role:'system',content:risk.SYSTEM},{role:'user',content:JSON.stringify(input)}],[risk.TOOL],{signal,maxOutputTokens:4000,requireTool:true});
    return risk.validateEvaluation(reply,input);
  }
  return {mode:'openai',model,inspect,chat,research,assessCounterparties};
}
module.exports={createOpenAIModel};
