// A player in the character editor cannot be hit and hits no one (gamemode.js inEditor; karta.gina 19 Oct).
//   node tests/editor-guard-harness.js gamemode.js   (from server/)
const fs=require('fs');const src=fs.readFileSync(process.argv[2]||require('path').resolve(__dirname,'..','gamemode.js'),'utf8');
const a=src.indexOf('const EDITOR_GUARD_MS');const b=src.indexOf('globalThis.__dboInEditor = inEditor;');
const props=new Map();const mp={get:(id,k)=>props.get(id+'|'+k)};
let now=1e12;const Date2={now:()=>now};
const profileOf=(a)=>props.get(a+'|profileId')??-1;
const creationPending=(a)=>mp.get(a,'private.creationPending')===true;
const f=new Function('mp','profileOf','creationPending','Date','globalThis',src.slice(a,b)+';return {inEditor,markEditorOpen,editorOpenAt};');
const g={};const {inEditor,markEditorOpen,editorOpenAt}=f(mp,profileOf,creationPending,Date2,g);
let fails=0;const ok=(c,t)=>{console.log((c?'ok  ':'FAIL')+' '+t);if(!c)fails++;};
const P=1,Q=2,NPC=3;props.set(P+'|profileId',5);props.set(Q+'|profileId',6);
ok(!inEditor(P),'a player out of the editor is not guarded');
markEditorOpen(P);ok(inEditor(P),'a staff /chargen marks them');
now+=31*60000;ok(!inEditor(P),'the mark lapses after 30 minutes');
markEditorOpen(P);editorOpenAt.delete(P);ok(!inEditor(P),'the look coming back clears it');
props.set(P+'|private.dboAppearanceEdit',{at:now});ok(inEditor(P),'an /appearance edit guards them');
now+=31*60000;ok(!inEditor(P),'an edit left open for 30 minutes no longer does');
props.set(Q+'|private.creationPending',true);ok(inEditor(Q),'a character being made is guarded');
props.set(Q+'|private.creationPending',false);props.set(Q+'|private.rerollPending',true);ok(inEditor(Q),'a patron reroll is guarded');
ok(!inEditor(NPC),'an NPC is never');
const hook=src.indexOf("globalThis.__dboHitRefusal = 'in_editor';");ok(hook>0&&/if \(agg !== tgt && \(inEditor\(tgt\) \|\| inEditor\(agg\)\)\) return false;/.test(src.slice(hook,hook+200)),'the hit judge refuses hits on and from a player in the editor');
console.log(fails?fails+' FAILED':'all passed');process.exit(fails?1:0);
