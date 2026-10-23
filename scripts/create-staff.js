'use strict';

const { createOperatorDatabase: createDatabase } = require('../database');
const security=require('../banking/security');
async function createStaff({db:suppliedDatabase,email,name,password,connectionString}={}){
  email=security.emailAddress(email);name=security.fullName(name);password=security.password(password);
  const db=suppliedDatabase||createDatabase({connectionString});
  try{
    if(!suppliedDatabase)await db.migrate();
    const hash=await security.hashPassword(password);
    return await db.transaction(async client=>{
      if((await client.query('SELECT 1 FROM users WHERE lower(email)=$1',[email])).rowCount)throw new security.HttpError(409,'This email is already registered. Existing accounts are never replaced.');
      const user=(await client.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id,name,email,role",[name,email,hash])).rows[0];
      await client.query("INSERT INTO audit_log(target_user_id,event_type,metadata) VALUES($1,'operator.staff_created',$2)",[user.id,{method:'local-operator',role:'admin'}]);
      return security.publicUser(user);
    });
  }catch(error){if(error.code==='23505')throw new security.HttpError(409,'This email is already registered. Existing accounts are never replaced.');throw error;}
  finally{if(!suppliedDatabase)await db.close();}
}
module.exports={createStaff};
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--email'||args[2]!=='--name'){
    console.error('Usage: npm run admin:create -- --email operator@example.com --name "Bank Operations". Set GREENLINK_STAFF_PASSWORD privately in the environment.');process.exitCode=1;
  }else createStaff({email:args[1],name:args[3],password:process.env.GREENLINK_STAFF_PASSWORD}).then(user=>console.log(`Created bank operations user ${user.email}. No business or deposit account was created.`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
