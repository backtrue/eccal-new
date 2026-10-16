export const taiwanDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const shiftDay=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const dateRange=(start,end)=>{const days=[];for(let d=start;d<=end;d=shiftDay(d,1))days.push(d);return days;};
const sum=(rs,key='events')=>rs.reduce((n,r)=>n+(Number(r[key])||0),0);
const ids=rs=>new Set(rs.map(r=>r.user_hash).filter(h=>/^[a-f0-9]{64}$/.test(h)));
export function defaultScope(snapshot){const end=shiftDay(taiwanDay(snapshot.generatedAt),-1);return {range:`${shiftDay(end,-29)}..${end}`,platform:'all',plan:'all',includeOwner:false};}
export function scopeRows(rows,scope,{dated=true}={}) {
  const [start,end]=scope.range.split('..');
  return rows.filter(r=>(scope.includeOwner||r.internal!=='internal')&&(scope.platform==='all'||r.platform===scope.platform)&&(scope.plan==='all'||r.plan===scope.plan)&&(!dated||!r.date||(r.date>=start&&r.date<=end)));
}
export function derive(snapshot,scope) {
  const raw=id=>snapshot.queries[id]?.rows??[];
  const [start,end]=scope.range.split('..');
  const usage=scopeRows(raw('usage'),scope),questions=scopeRows(raw('questions'),scope).sort((a,b)=>b.received_at.localeCompare(a.received_at));
  const observedStart=raw('usage').map(r=>r.date).sort()[0]??null;
  const grants=scopeRows(raw('grants'),scope,{dated:false}),liveGrants=grants.filter(g=>!g.expires_at||g.expires_at>snapshot.generatedAt);
  const reads=usage.filter(r=>r.event==='skill_read'),searches=usage.filter(r=>r.event==='skill_search');
  const memberMap=new Map(raw('members').map(u=>[u.user_hash,u]));
  const hashes=new Set([...grants,...usage,...questions].map(r=>r.user_hash));
  const accountRows=[...hashes].filter(h=>/^[a-f0-9]{64}$/.test(h)).map(h=>{
    const member=memberMap.get(h),rs=usage.filter(r=>r.user_hash===h),gr=grants.filter(r=>r.user_hash===h),read=rs.filter(r=>r.event==='skill_read');
    const activeDays=new Set(read.map(r=>r.date)),platforms=[...new Set([...rs,...gr].map(r=>r.platform))],skills=new Map();
    for(const r of read)skills.set(r.document,(skills.get(r.document)??0)+r.events);
    const top=[...skills.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
    return {user_hash:h,account:member?.email??`會員 ${h.slice(0,10)}`,email:member?.email??null,member_id:member?.member_id??null,plan:member?.plan??'unknown',platforms:platforms.join('、'),first_connected:gr.map(r=>r.created_at).sort()[0]??null,last_used:rs.map(r=>r.last_seen).sort().at(-1)??null,active_days:activeDays.size,reads:sum(read),searches:sum(rs.filter(r=>r.event==='skill_search')),top_skill:top?(snapshot.dashboard.skillNames[top]??top):'—',status:liveGrants.some(r=>r.user_hash===h)?(activeDays.size?'期間有使用':'期間未觀測使用'):'未見有效授權',internal:h===snapshot.dashboard.owner.user_hash,grant_count:gr.length};
  }).sort((a,b)=>b.reads-a.reads||a.account.localeCompare(b.account));
  const byDay=new Map();
  for(const r of usage){if(!byDay.has(r.date))byDay.set(r.date,{date:r.date,'讀取量':0,'搜尋量':0,users:new Set()});const g=byDay.get(r.date);g[r.event==='skill_read'?'讀取量':'搜尋量']+=r.events;if(r.event==='skill_read')g.users.add(r.user_hash);}
  const trend=usage.length?dateRange(start,end).map(date=>{
    const g=byDay.get(date),observed=observedStart!==null&&date>=observedStart;
    return {date,'讀取量':g?.['讀取量']??(observed?0:null),'搜尋量':g?.['搜尋量']??(observed?0:null),'觀測會員':g?.users.size??(observed?0:null)};
  }):[];
  const platforms=[...new Set(usage.map(r=>r.platform))].map(platform=>({platform,'觀測使用會員':ids(reads.filter(r=>r.platform===platform)).size,'讀取量':sum(reads.filter(r=>r.platform===platform))})).sort((a,b)=>b['觀測使用會員']-a['觀測使用會員']);
  const skillMap=new Map();
  for(const r of reads){if(!skillMap.has(r.document))skillMap.set(r.document,{skill_id:r.document,skill:snapshot.dashboard.skillNames[r.document]??r.document,reads:0,members:new Set(),dates:new Map()});const g=skillMap.get(r.document);g.reads+=r.events;g.members.add(r.user_hash);if(!g.dates.has(r.user_hash))g.dates.set(r.user_hash,new Set());g.dates.get(r.user_hash).add(r.date);}
  const skillRows=[...skillMap.values()].map(({members,dates,...r})=>({...r,members:members.size,returning_members:[...dates.values()].filter(d=>d.size>1).length})).sort((a,b)=>b.members-a.members||b.reads-a.reads);
  const gapMap=new Map();for(const r of searches.filter(r=>r.no_match>0)){if(!gapMap.has(r.document))gapMap.set(r.document,{query:r.document,searches:0,members:new Set()});const g=gapMap.get(r.document);g.searches+=r.no_match;g.members.add(r.user_hash);}
  const gapRows=[...gapMap.values()].map(({members,...r})=>({...r,members:members.size})).sort((a,b)=>b.searches-a.searches);
  const firstConnected=new Map();
  for(const g of grants){const date=taiwanDay(g.created_at);if(!firstConnected.has(g.user_hash)||date<firstConnected.get(g.user_hash))firstConnected.set(g.user_hash,date);}
  const firstRows=[...firstConnected].map(([user_hash,date])=>({user_hash,date}));
  const newMembers=firstRows.filter(r=>r.date>=start&&r.date<=end);
  const growth=(grants.length||usage.length)?dateRange(start,end).map(date=>({date,'觀測活躍會員':observedStart!==null&&date>=observedStart?ids(reads.filter(r=>r.date===date)).size:null,'首次現存授權會員':newMembers.filter(r=>r.date===date).length})):[];
  const total={reads:sum(reads),searches:sum(searches),active:ids(reads).size,questions:questions.length,connected:ids(liveGrants).size,grantRecords:liveGrants.length,memberPlatforms:new Set(liveGrants.map(g=>g.user_hash+':'+g.platform)).size,returning:accountRows.filter(a=>a.active_days>1).length,noMatch:sum(searches,'no_match'),newMembers:newMembers.length};
  const days=dateRange(start,end).length,previousStart=shiftDay(start,-days),previousEnd=shiftDay(start,-1);
  const previousUsage=scopeRows(raw('usage'),{...scope,range:`${previousStart}..${previousEnd}`});
  const comparable=observedStart!==null&&previousStart>=observedStart;
  const previousTotal={reads:comparable?sum(previousUsage.filter(r=>r.event==='skill_read')):null,searches:comparable?sum(previousUsage.filter(r=>r.event==='skill_search')):null,active:comparable?ids(previousUsage.filter(r=>r.event==='skill_read')).size:null,newMembers:firstRows.filter(r=>r.date>=previousStart&&r.date<=previousEnd).length};
  const comparisonRows=[['newMembers','首次現存授權會員'],['active','觀測活躍會員'],['reads','Skill 讀取量（估計）'],['searches','Skill 搜尋量（估計）']].map(([key,metric])=>({metric,current:total[key],previous:previousTotal[key],change:previousTotal[key]===null?null:total[key]-previousTotal[key],current_period:scope.range,previous_period:`${previousStart}..${previousEnd}`,platform:scope.platform,plan:scope.plan,internal:scope.includeOwner?'all':'external'}));
  const excluded=scopeRows(raw('usage'),{...scope,includeOwner:true}).filter(r=>r.internal==='internal');
  const exclusion={reads:sum(excluded.filter(r=>r.event==='skill_read')),searches:sum(excluded.filter(r=>r.event==='skill_search'))};
  return {usage,reads,searches,questions,grants,liveGrants,members:raw('members').filter(m=>hashes.has(m.user_hash)),accountRows,trend,growth,newMembers,platforms,skillRows,gapRows,total,exclusion,previousUsage,previousTotal,comparisonRows,previousRange:`${previousStart}..${previousEnd}`,observedStart,comparable};
}
