'use strict';
const {HttpError}=require('../models/errors');
const {decimal}=require('./finance-reports');
async function pdf(report){
  if(report.transactions.length>2000)throw new HttpError(413,'PDF reports support up to 2,000 ledger entries. Choose a shorter period or download CSV.');
  // Loaded only for a requested PDF, so ordinary banking startup stays small.
  const PDFDocument=require('pdfkit'),chunks=[];
  const doc=new PDFDocument({size:'A4',margins:{top:78,left:42,right:42,bottom:44},info:{Title:report.title,Author:'Green Link Digital Bank - C300 FYP',CreationDate:new Date(report.generatedAt)}});
  let bytes=0,page=0,escapedCharacters=false;
  const result=new Promise((resolve,reject)=>{
    doc.on('data',chunk=>{bytes+=chunk.length;if(bytes>4000000)doc.destroy(new HttpError(413,'This PDF is too large. Choose a shorter period.'));else chunks.push(chunk);});
    doc.once('error',reject);doc.once('end',()=>resolve({content:Buffer.concat(chunks),filename:'greenlink-finance-'+report.period.from+'-to-'+report.period.to+'.pdf'}));
  });
  // Standard PDF fonts cover Latin text. Preserve other characters visibly as
  // Unicode codes rather than silently corrupting legal names or references.
  const safe=value=>String(value??'').replace(/[\r\n\t]/g,' ').replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/gu,char=>{escapedCharacters=true;return '[U+'+char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')+']';});
  const header=()=>{doc.font('Helvetica-Bold').fontSize(13).fillColor('#003c82').text('GREEN LINK DIGITAL BANK',42,28,{width:430,lineBreak:false});doc.font('Helvetica').fontSize(8).fillColor('#475569').text('Finance activity | Page '+(++page),42,48,{lineBreak:false});doc.x=42;doc.y=78;};
  doc.on('pageAdded',header);header();
  const paragraph=(value,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(9).fillColor('#1e293b').text(safe(value),{width:doc.page.width-84,lineGap:3});};
  const heading=value=>{if(doc.y>doc.page.height-110)doc.addPage();doc.moveDown();doc.font('Helvetica-Bold').fontSize(12).fillColor('#003c82').text(safe(value),{width:doc.page.width-84});doc.moveDown(0.4);};
  try{
    paragraph(report.title,true);
    paragraph('Business: '+(report.business?.legalName||'Business profile not linked'));
    paragraph('Registration: '+(report.business?.registrationNumber||'Not supplied'));
    paragraph('Period: '+report.period.from+' to '+report.period.to+' (SGT, inclusive)');
    paragraph('Generated: '+new Date(report.generatedAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT');
    paragraph('Generated (UTC): '+report.generatedAt);
    heading('Financial activity summary');
    for(const [label,key] of [['Current account balances','balanceCents'],['Received - external completed','incomeCents'],['Paid - external completed','outgoingCents'],['Net external movement','netCents'],['Pending outgoing - not reserved','pendingOutgoingCents'],['Rejected outgoing - no funds moved','rejectedOutgoingCents']])paragraph(label+': SGD '+decimal(report.totals[key]));
    paragraph('Completed entries: '+report.totals.completedCount+' | Awaiting review: '+report.totals.pendingCount+' | Rejected: '+report.totals.rejectedCount);
    heading('Current accounts');
    if(!report.accounts.length)paragraph('No business accounts.');
    for(const row of report.accounts)paragraph(row.name+' | '+row.number+' | '+row.status+' | SGD '+decimal(row.balanceCents));
    heading('Activity with recorded companies and billers');
    if(!report.companies.length)paragraph('No external activity in this period.');
    for(const row of report.companies){paragraph(row.company,true);paragraph('Received SGD '+decimal(row.incomeCents)+' | Paid SGD '+decimal(row.outgoingCents)+' | Net SGD '+decimal(row.netCents));paragraph('Completed '+row.completedCount+' | Awaiting review '+row.pendingCount+' | Rejected '+row.rejectedCount);doc.moveDown(0.4);}
    heading('Ledger entries');
    if(!report.transactions.length)paragraph('No entries in this period.');
    for(const row of report.transactions){
      if(doc.y>doc.page.height-160)doc.addPage();
      paragraph((row.completedAt||row.requestedAt)+' | '+row.status+' | SGD '+decimal(row.amountCents),true);
      paragraph('Account: '+row.accountName+' | '+row.accountNumber+' | '+row.type);
      paragraph('Description: '+row.description+' | Counterparty: '+row.counterparty);
      paragraph('Reference: '+(row.reference||'-')+' | ID: '+row.id);
      paragraph('Requested: '+row.requestedAt+' | Completed: '+(row.completedAt||'Not completed'));
      if(row.internal||row.openingBalance)paragraph(row.internal?'Own-account transfer: excluded from external cash flow.':'Opening funds: excluded from external cash flow.');
      doc.moveDown(0.6);
    }
    heading('Report scope');
    for(const note of report.notes)paragraph(note);
    if(escapedCharacters)paragraph('Characters unsupported by this PDF font appear as Unicode codes. CSV retains the original text.');
    doc.end();
  }catch(error){doc.destroy(error);}
  return result;
}
module.exports={pdf};
