'use strict';

const {HttpError}=require('../models/errors');
const {dateRange}=require('./history');
const DAY=86400000;
const MONTHS='jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const day=value=>new Date(value+8*3600000).toISOString().slice(0,10);
const fail=()=>new HttpError(400,'Specify a valid start date and end date, for example 1 November 2026 to 19 November 2026 or 01/11/2026 to 19/11/2026 (DD/MM/YYYY). Dates are inclusive in Singapore time.');
const format=(year,month,date)=>String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(date).padStart(2,'0');
const SMALL=Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ').map((word,index)=>[word,index]));
const TENS={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
function writtenCount(text){
  const parts=text.toLowerCase().split(/[ -]+/);
  if(parts.length===1&&['a','an'].includes(parts[0]))return 1;
  const small=words=>words.length===1?(SMALL[words[0]]??TENS[words[0]]):words.length===2&&TENS[words[0]]&&SMALL[words[1]]>0&&SMALL[words[1]]<10?TENS[words[0]]+SMALL[words[1]]:undefined;
  const hundred=parts.indexOf('hundred');
  if(hundred===-1)return small(parts);
  const head=hundred===1?(SMALL[parts[0]]??(['a','an'].includes(parts[0])?1:undefined)):undefined;
  if(!head||head>9)return undefined;
  const rest=parts.slice(2);if(rest[0]==='and')rest.shift();
  const tail=rest.length?small(rest):0;
  return tail===undefined?undefined:head*100+tail;
}
function normalizeDurations(message){
  const words=[...Object.keys(SMALL),...Object.keys(TENS),'a','an','hundred','and'].join('|');
  return message.replace(new RegExp('\\b((?:'+words+')(?:[ -]+(?:'+words+')){0,5})\\s+(days?|weeks?|months?)\\b','gi'),(whole,count,unit)=>{const number=writtenCount(count);return number===undefined?whole:number+' '+unit;})
    .replace(/\bprevious(?=\s+\d+\s+(?:days?|weeks?|months?)\b)/gi,'last');
}
function expandNamedRanges(message){
  const date='(\\d{1,2})(?:st|nd|rd|th)?',join='\\s*(?:to|through|until|and|[-\u2013\u2014])\\s*',year='(?:\\s*,?\\s*(\\d{4}))?',end='\\b(?!\\s*(?:'+MONTHS+')\\b)';
  const stamp=(date,month,year)=>date+' '+month+(year?' '+year:'');
  return message.replace(new RegExp('\\b'+date+join+date+'\\s+('+MONTHS+')'+year+'\\b','gi'),(_all,first,last,month,y)=>stamp(first,month,y)+' to '+stamp(last,month,y))
    .replace(new RegExp('\\b('+MONTHS+')\\s+'+date+year+join+date+year+end,'gi'),(_all,month,first,y1,last,y2)=>stamp(first,month,y1||y2)+' to '+stamp(last,month,y2||y1))
    .replace(new RegExp('\\b'+date+'\\s+('+MONTHS+')'+year+join+date+year+end,'gi'),(_all,first,month,y1,last,y2)=>stamp(first,month,y1||y2)+' to '+stamp(last,month,y2||y1));
}
function explicitDates(message,year){
  const pattern=new RegExp('\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[-/\\.]\\d{1,2}[-/\\.]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:'+MONTHS+')(?:\\s*,?\\s*\\d{4})?|(?:'+MONTHS+')\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*\\d{4})?)\\b','gi');
  const dates=[...message.matchAll(pattern)].map(match=>{
    const raw=match[0];let parts;
    if(/^\d{4}-/.test(raw))return {value:raw,index:match.index,end:match.index+raw.length};
    if((parts=/^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{4})$/.exec(raw)))return {value:format(+parts[3],+parts[2],+parts[1]),index:match.index,end:match.index+raw.length};
    parts=new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?\\s+('+MONTHS+')(?:\\s*,?\\s*(\\d{4}))?$','i').exec(raw);
    if(parts)return {year:parts[3]?+parts[3]:null,month:names.indexOf(parts[2].slice(0,3).toLowerCase())+1,date:+parts[1],index:match.index,end:match.index+raw.length};
    parts=new RegExp('^('+MONTHS+')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?$','i').exec(raw);
    return {year:parts[3]?+parts[3]:null,month:names.indexOf(parts[1].slice(0,3).toLowerCase())+1,date:+parts[2],index:match.index,end:match.index+raw.length};
  });
  // A year written on either endpoint applies to an adjacent named date too.
  const stated=dates.map(d=>d.year || (d.value?Number(d.value.slice(0,4)):null)).filter(Boolean);
  for(const d of dates)if(!d.value)d.value=format(d.year||stated[0]||year,d.month,d.date);
  return dates;
}
function requestedPeriod(message,{now=Date.now}={}){
  message=expandNamedRanges(normalizeDurations(message));
  const today=day(now()),year=Number(today.slice(0,4)),dates=explicitDates(message,year);
  if(dates.length){
    if(dates.length>2)throw fail();
    let from=dates[0].value,to=dates[1]?.value;
    if(!to){
      const before=message.slice(0,dates[0].index),after=message.slice(dates[0].end);
      if(/\bbetween\s*$/i.test(before)||/^\s*(?:to|until|through|and)\b/i.test(after))throw fail();
      to=/\b(?:since|from)\s*$/i.test(before)?today:from;
    }
    dateRange(new URLSearchParams({from,to}));
    return {from,to};
  }
  // Never turn an incomplete or misspelled explicit range into a default month.
  if(/\b(?:from|between)\b[\s\S]*\b(?:to|and|until|through)\b[\s\S]*(?:\bdate\b|\d)|\b(?:start|end)\s*date\b|\b\d{1,4}[-/\.]\d{1,2}(?:[-/\.]\d{1,4})?\b/i.test(message))throw fail();
  const relative=/\b(?:last|past)\s+(\d+)\s+(days?|weeks?|months?)\b/i.exec(message);
  if(relative){
    const count=Number(relative[1]),unit=relative[2].toLowerCase();
    if(unit.startsWith('month')){
      if(count<1||count>12)throw new HttpError(400,'Choose between 1 and 12 calendar months.');
      const start=new Date(today.slice(0,7)+'-01T00:00:00Z');start.setUTCMonth(start.getUTCMonth()-(count-1));
      return {from:start.toISOString().slice(0,10),to:today};
    }
    const days=count*(unit.startsWith('week')?7:1);
    if(days<1||days>366)throw new HttpError(400,'Choose a period of between 1 and 366 days.');
    return {from:day(now()-(days-1)*DAY),to:today};
  }
  if(/\byesterday\b/i.test(message))return {from:day(now()-DAY),to:day(now()-DAY)};
  if(/\b(?:(?:this|current|last|previous)\s+week)\b/i.test(message)){
    const weekday=new Date(today+'T00:00:00Z').getUTCDay(),monday=Date.parse(today+'T00:00:00+08:00')-((weekday+6)%7)*DAY;
    return /\b(?:last|previous) week\b/i.test(message)?{from:day(monday-7*DAY),to:day(monday-DAY)}:{from:day(monday),to:today};
  }
  if(/\b(?:this|current) month\b/i.test(message))return {from:today.slice(0,7)+'-01',to:today};
  if(/\b(?:last|previous) month\b/i.test(message)){
    const to=day(Date.parse(today.slice(0,7)+'-01T00:00:00+08:00')-DAY);return {from:to.slice(0,7)+'-01',to};
  }
  const candidates=[...message.matchAll(new RegExp('\\b('+MONTHS+')(?:\\s+(\\d{4}))?\\b','gi'))];
  const month=candidates.find(m=>m[2]||/\b(?:in|for|during|month of)\s*$/i.test(message.slice(0,m.index))||/^[\s.!?]*$/.test(message.slice(m.index+m[0].length)));
  if(month){
    if(/\b(?:last|previous|next)\s*$/i.test(message.slice(0,month.index))||new RegExp('\\b(?:from|between)\\s+(?:'+MONTHS+')\\b','i').test(message))throw fail();
    const y=Number(month[2]||year),m=names.indexOf(month[1].slice(0,3).toLowerCase())+1;
    const from=format(y,m,1),end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    return {from,to:from.slice(0,7)===today.slice(0,7)?today:end};
  }
  if(/\btoday\b/i.test(message))return {from:today,to:today};
  if(/\b(?:dates?|yesterday|tomorrow|weeks?|years?|quarters?|hours?)\b|\b(?:last|past|this|previous|current|next)\s+(?:\w+\s+)?(?:days?|months?)\b|\b(?:since|until|before|after)\s+(?:\d|today|a date|date)\b/i.test(message))throw fail();
  return {};
}
function isDateReply(message){
  message=normalizeDurations(message);
  const remaining=message.replace(/\b\d+(?:st|nd|rd|th)\b/gi,'').replace(new RegExp('\\b(?:'+MONTHS+'|from|to|and|between|on|for|the|since|until|through|today|yesterday|this|last|past|current|previous|days?|weeks?|months?|dates?|please|yes)\\b','gi'),'').replace(/[\d\s,./!?-]/g,'');
  return !remaining&&/\d|today|yesterday|this|last|past|current|previous|date/i.test(message);
}
function clarification(error){
  if(!(error instanceof HttpError)||error.status!==400)throw error;
  return {complete:false,needsClarification:true,items:[{title:'Please clarify the report period',detail:error.message}],actions:[]};
}
module.exports={requestedPeriod,isDateReply,clarification,normalizeDurations};
