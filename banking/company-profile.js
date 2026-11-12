'use strict';
const {assertCurrentUser}=require('./auth');
const companyActivity=require('./company-activity');
async function analyze(db,user,{now=Date.now,months=3}={}){
 await assertCurrentUser(db,user);
 const row=(await db.query('SELECT legal_name,country,legal_form,industry,status,created_at FROM businesses WHERE primary_user_id=$1',[user.id])).rows[0];
 if(!row)return {available:false,scope:'Only your registered business profile.',items:[{title:'No registered business profile is attached to this operator.'}]};
 const activity=await companyActivity.assistantDashboard(db,user,{},'Show transaction trends over the past '+months+' months',{now});
 return {available:true,checkedAt:new Date(now()).toISOString(),profile:{legalName:row.legal_name,country:row.country,legalForm:row.legal_form,industry:row.industry,status:row.status,registeredInAppAt:new Date(row.created_at).toISOString()},activity:{period:activity.period,totals:activity.totals,months:activity.months},scope:'Your submitted company profile and your permitted settled banking activity. This is not an independent company verification, credit rating or fraud decision.',items:[{title:'Analysis scope',subtitle:'Your submitted profile and owned completed activity; not independent company verification or a credit rating.'},{title:row.legal_name,subtitle:row.industry+' \u00b7 '+row.country+' \u00b7 '+row.legal_form},{title:'Application status',subtitle:row.status},{title:'Completed external receipts',amountCents:activity.totals.incomeCents},{title:'Completed external payments',amountCents:activity.totals.outgoingCents},{title:'Net external movement',amountCents:activity.totals.netCents}]};
}
module.exports={analyze};
