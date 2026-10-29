'use strict';
const {createOpenAIModel}=require('../banking/agents/openai');
async function main(){
  const model=createOpenAIModel(),status=await model.inspect();
  if(!status.available)throw new Error(status.reason);
  console.log('OpenAI is accessible. Model: '+status.model);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
