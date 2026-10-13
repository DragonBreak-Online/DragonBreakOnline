// gearstrip.js over a hot reload (13 Oct): the state object the code before it built (globalThis S) had no owedPaid, and
// payOwed threw on every sweep (312 uncaught TypeErrors on live after hotfix-1012c). Fails on 0fae4e61's gearstrip.js.
//   node tests/gearstrip-reload-harness.js [gearstrip.js]
const path=require('path'); const MOD=path.resolve(process.argv[2] || path.join(__dirname, '..', 'gearstrip.js'));
const P=new Map(); const get=(id,k)=>P.get(id+'|'+k); const set=(id,k,v)=>P.set(id+'|'+k,JSON.parse(JSON.stringify(v)));
set(0xff000601,'inventory',{entries:[]}); set(0xff000601,'profileId',1);
globalThis.__dboGearStripS = undefined;
const cfg={gearStrip:{enabled:true,items:[{item:'1:a.esm',name:'X',refund:[]}],owed:[{to:'ff000601',give:'2:a.esm',n:1,name:'W'}],stateFile:'' + require('path').join(require('os').tmpdir(), 'gearstrip-reload-' + process.pid + '.json') + ''}};
const api=()=>({mp:{get,set,getIdFromDesc:(d)=>({'1:a.esm':1,'2:a.esm':2})[d]||0,getDescFromId:(i)=>String(i),callPapyrusFunction(){} },log(){},personal(){},audit(){},who:(a)=>String(a),onlineActors:()=>[0xff000601],every(){},stopTimer(){},giveItem:(a,id,n)=>{const inv=get(a,'inventory');inv.entries.push({baseId:id,count:n});set(a,'inventory',inv);return true;},cfg});
try{require('fs').unlinkSync(cfg.gearStrip.stateFile);}catch(e){}
require(MOD)(api());
// simulate the old code's state object (no owedPaid) surviving the reload
const st=globalThis.__dboGearStripState && globalThis.__dboGearStripState();
for (const k of Object.keys(globalThis)) { const v=globalThis[k]; if (v && typeof v==='object' && v.state && v.state.removed) delete v.state.owedPaid; }
delete require.cache[MOD]; require(MOD)(api());
let ok=true; try{ globalThis.__dboGearStripLogin(0xff000601);}catch(e){ ok=false; console.log('THREW',e.message); }
const got=get(0xff000601,'inventory').entries.filter(e=>e.baseId===2).length;
console.log(ok&&got===1?'ok: no throw, owed paid once':'FAIL', got); process.exit(ok&&got===1?0:1);
