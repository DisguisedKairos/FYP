'use strict';
// Runs only the installed local model server. It never downloads a model.
const {spawn}=require('node:child_process');
const {createLocalModel}=require('../banking/agents/model');
async function main(){
  const model=createLocalModel({mode:'ollama',model:process.env.AGENT_MODEL || 'qwen3.5:4b'});
  if((await model.inspect()).available){console.log('The configured local Ollama model is already available.');return;}
  const origin=new URL(process.env.AGENT_OLLAMA_URL || 'http://127.0.0.1:11434');
  // Do not inherit application/operator credentials into the language model.
  const env={...process.env,OLLAMA_HOST:origin.host,OLLAMA_NO_CLOUD:'1'};
  for(const key of Object.keys(env))if(/DATABASE|TOKEN|SECRET|PASSWORD|AUTH_ENCRYPTION|^PG[A-Z_]*$/i.test(key))delete env[key];
  const child=spawn('ollama',['serve'],{env,windowsHide:true,shell:false,stdio:'inherit'});
  child.on('error',()=>{console.error('Install Ollama and ensure its executable is on PATH.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code || 0;});
  for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>child.kill('SIGTERM'));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
