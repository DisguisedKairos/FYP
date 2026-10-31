'use strict';
// Only public, fixed official feeds are fetched. Banking data never enters a feed request.
const DAY=86400000;
const SOURCES=Object.freeze({
  alerts:'https://www.scamshield.gov.sg/resources/scam-alert/',
  fx:'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  news:'https://www.ecb.europa.eu/rss/press.html',
});
const TOPICS=Object.freeze({
  investment:/\binvest(?:ment|ing|or|ors)?\b|\btrading\b|\bcrypto(?:currency)?\b/i,
  impersonation:/\bimpersonat\w*\b|\bposing\b|\btelco\b/i,
  phishing:/\bphishing\b|\bfake hotline\b/i,
  invoice:/\binvoice\b|\bbusiness.email\b|\bsupplier\b/i,
  recovery:/\brecovery\b|\brecover\b/i,
  job:/\bjobs?\b|\bcommission\b|\btasks?\b/i,
});
const topics=text=>Object.entries(TOPICS).filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
const text=value=>String(value).replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[a-f\d]+);/gi,entity=>{
  const names={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"};
  if(names[entity.toLowerCase()])return names[entity.toLowerCase()];
  const code=entity.slice(0,3).toLowerCase()==='&#x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));
  return Number.isInteger(code)&&code>=32&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';
}).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
function day(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
function calendar(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid source date');const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value)throw Error('Invalid source date');return value;}
function recent(date,now,maxDays){const age=Date.parse(day(now))-Date.parse(calendar(date));return age>=0 && age<=maxDays*DAY;}
function officialLink(value,base){const url=new URL(text(value),base);if(url.origin!==new URL(base).origin||url.username||url.password||url.hash||url.search)throw Error('Untrusted source link');return url.href;}
function parseAlerts(html,now){
  const rows=[],seen=new Set(),months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  for(const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
    if(!/^\/resources\/scam-alert\/[a-z0-9-]+\/$/.test(match[1]))continue;
    const heading=match[2].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i),date=text(match[2]).match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2})\b/);
    if(!heading||!date)continue;
    const publishedAt=calendar(date[3]+'-'+String(months.indexOf(date[2])+1).padStart(2,'0')+'-'+date[1].padStart(2,'0'));
    if(!recent(publishedAt,now,45))continue;
    const title=text(heading[1]).slice(0,240),url=officialLink(match[1],SOURCES.alerts);
    if(!title||seen.has(url))continue;seen.add(url);
    rows.push({title,publishedAt,url,topics:topics(title)});
  }
  if(!rows.length)throw Error('No recent dated scam alerts');
  return rows.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,6);
}
function parseFx(xml,now){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsupported XML');
  const days=[];
  for(const match of xml.matchAll(/<Cube\b[^>]*time=['"](\d{4}-\d{2}-\d{2})['"][^>]*>([\s\S]*?)<\/Cube>/g)){
    calendar(match[1]);const rates={EUR:1};
    for(const row of match[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"](\d+(?:\.\d+)?)['"]\s*\/?>/g)){
      const value=Number(row[2]);if(!Number.isFinite(value)||value<=0||value>1e9||Object.hasOwn(rates,row[1]))throw Error('Invalid exchange rate');rates[row[1]]=value;
    }
    if(['SGD','USD','GBP'].every(key=>rates[key]))days.push({date:match[1],rates});
  }
  days.sort((a,b)=>b.date.localeCompare(a.date));
  if(days.length<2||days[0].date===days[1].date||!recent(days[0].date,now,7))throw Error('No fresh exchange-rate comparison');
  return ['USD','EUR','GBP'].map(base=>{
    const rate=days[0].rates.SGD/days[0].rates[base],previous=days[1].rates.SGD/days[1].rates[base];
    const rounded=Number(rate.toFixed(6)),changePercent=(rate/previous-1)*100;
    if(!Number.isFinite(rate)||!Number.isFinite(previous)||!Number.isFinite(changePercent)||rounded<=0)throw Error('Invalid derived exchange rate');
    return {pair:base+'/SGD',rate:rounded,changePercent:Number(changePercent.toFixed(3)),asOf:days[0].date,previousDate:days[1].date,derived:true};
  });
}
function parseNews(xml,now){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsupported XML');
  const rows=[];
  for(const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
    const field=name=>item[1].match(new RegExp('<'+name+'\\b[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1];
    const title=text(field('title')||'').slice(0,240),date=new Date(text(field('pubDate')||''));
    if(!title||!Number.isFinite(+date)||date.getTime()>now+60000)continue;
    const publishedAt=date.toISOString().slice(0,10);if(!recent(publishedAt,now,14))continue;
    const url=officialLink(field('link')||'',SOURCES.news);if(!new URL(url).pathname.startsWith('/press/')&&!new URL(url).pathname.startsWith('//press/'))continue;
    rows.push({title,publishedAt,url});
  }
  if(!rows.length)throw Error('No recent dated financial news');
  return rows.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,5);
}
function createMarketContext({fetchImpl=fetch,now=Date.now}={}){
  let cache,pending;
  async function read(url){
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/xml, application/rss+xml, text/html','User-Agent':'Greenlink-C300-public-context/1.0'}});
    if(!response.ok||!response.body)throw Error('Source unavailable');
    let size=0;const parts=[];for await(const part of response.body){size+=part.length;if(size>1000000)throw Error('Source too large');parts.push(Buffer.from(part));}
    return Buffer.concat(parts).toString('utf8');
  }
  async function refresh(){
    const at=now(),parsers={alerts:parseAlerts,fx:parseFx,news:parseNews};
    const entries=await Promise.all(Object.entries(SOURCES).map(async([id,url])=>{try{return [id,{available:true,sourceUrl:url,records:parsers[id](await read(url),at)}];}catch{return [id,{available:false,sourceUrl:url,records:[],error:'SOURCE_UNAVAILABLE_OR_STALE'}];}}));
    const sources=Object.fromEntries(entries),available=entries.filter(([,value])=>value.available).length;
    cache={day:day(at),cachedAt:at,ttl:available===3?3600000:300000,value:{asOf:day(at),fetchedAt:new Date(at).toISOString(),sources,status:available===3?'available':available?'partial':'unavailable',limitations:['Official sources are checked on demand and cached for at most one hour; publication is not necessarily daily.','FX values are derived from ECB reference rates, not tradable quotes or live stock prices.','Market movements and news do not establish fraud. Payment-specific evidence and human review are required.']}};
    return cache.value;
  }
  return {async get(){if(cache&&cache.day===day(now())&&now()-cache.cachedAt>=0&&now()-cache.cachedAt<cache.ttl)return structuredClone(cache.value);if(!pending)pending=refresh().finally(()=>{pending=undefined;});return structuredClone(await pending);}};
}
module.exports={createMarketContext,parseAlerts,parseFx,parseNews,topics,SOURCES,day};
