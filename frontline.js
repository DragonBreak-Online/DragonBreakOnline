// DragonBreak Online: staff-run frontline wars (#staff-suggestions "War System", mestreugway 6 Oct; Nate picked it 20 Oct).
// Loaded by gamemode.js. Phase 1: the staff run every battle; the game keeps the declaration, the roster, the line and
// the record. It stands beside realm.js's automatic land war (closed by war.enabled) and changes no land by itself.
//
//   declare   a faction's leader (realm.js __dboRealmLeads: its leader rank, or a hold's ruler) declares on another
//             faction of the allowed kinds; staff confirm it (confirm 'gm', the default) or it starts at once ('none').
//   enlist    voluntary for everyone: guards are not made to fight, and any civilian may enlist. A member of one side
//             cannot enlist for the other, and one account fights on one side only. Only the roster counts in battle.
//   front     a line of `stages` steps each way from a start staff name when confirming (stage 0, or any other).
//             A battle won moves it one stage toward the loser's capital. The side whose ground the line stands on (the
//             declared-on side at stage 0) defends the next battle, and its leader picks the field from its territories.
//   final     reaching the last stage lets the winner call a Final Stand at the other side's capital (realm.js seat).
//             Before it the defenders may yield one by one as prisoners (out of the Final Stand, freed when the war ends);
//             a leader who yields surrenders the faction. Losing the Final Stand loses the war; holding it pushes the
//             line back one stage.
//   end       by a Final Stand, a surrender (a leader, any time) or staff. Terms and land are applied by hand.
//   record    while staff have a battle open, downs and finishing blows between enlisted enemies count for each soldier
//             (downed.js __dboFrontDown, __dboFrontFinish), and everyone enlisted and online at its start fought in it.
//
// The panel (contextMenu, widget 157) opens with /front, also from the U panel. Staff run it from the same panel or chat.
// State in frontline.json. gamemode-config.json "frontline" (header of C below), hot reload.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, cfg, onUi, openWidget, closeWidget, registerChatCommand, isAdmin, onlineActors } = api;
  const fn = (f, dflt) => (typeof f === 'function' ? f : dflt);
  const profileOf = fn(api.profileOf, () => -1);
  const realNameOf = fn(api.realNameOf, fn(api.display, () => 'Stranger'));
  const tagOf = fn(api.tagOf, () => '');
  const sendPacket = fn(api.sendPacket, () => {});
  const sendJson = fn(api.sendJson, null);
  const now = fn(api.now, Date.now);
  const C = Object.assign({
    enabled: false,
    // Who may wage it: these kinds of faction (guild-defs kind), and these ids besides (a player-founded faction by its id)
    kinds: ['hold', 'stronghold'],
    factions: ['imperial-legion', 'stormcloaks', 'thalmor', 'penitus-oculatus', 'house-hlaalu', 'house-redoran', 'house-telvanni',
      'house-indoril', 'house-dres', 'house-sadras'],
    confirm: 'gm', stages: 3, warsPerFaction: 1, enlistDuringBattle: false, openEnlist: true,
    announce: true, discord: false, discordChannelId: '', discordPingRoleId: '', maxReason: 200, maxNote: 200,
  }, (cfg && cfg.frontline) || {});
  const STAGES = Math.max(1, Math.min(10, Math.round(Number(C.stages) || 3)));
  const MENU_ID = 157;
  const FILE = path.resolve('frontline.json');

  const S = globalThis.__dboFrontline || (globalThis.__dboFrontline = { data: null, panels: new Map() });
  const data = () => {
    if (S.data) return S.data;
    let d = null; try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { d = null; }
    S.data = d && Array.isArray(d.wars) ? d : { nextId: 1, wars: [] };
    return S.data;
  };
  const save = () => { try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data(), null, 1)); fs.renameSync(tmp, FILE); } catch (e) { log('frontline: save failed', e.message); } };

  // ---- factions (guilds.js, realm.js) ----------------------------------------------------------------------------------
  const g = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const info = (fid) => { try { const f = g('__dboGuildInfo'); return f ? f(fid) : null; } catch (e) { return null; } };
  const fname = (fid) => (info(fid) || {}).name || fid;
  const leads = (a, fid) => { try { const f = g('__dboRealmLeads'); return !!f && !!f(a, fid); } catch (e) { return false; } };
  const memberOf = (a, fid) => { try { const f = g('__dboRealmMemberOf'); return !!f && !!f(a, fid); } catch (e) { return false; } };
  const territoriesOf = (fid) => { try { const f = g('__dboRealmTerritoriesOf'); return f ? f(fid) || [] : []; } catch (e) { return []; } };
  const territoryName = (tid) => { try { const f = g('__dboRealmTerritoryName'); return f ? f(tid) : tid; } catch (e) { return tid; } };
  const capitalOf = (fid) => { try { const f = g('__dboRealmSeatOf'); const s = f ? f(fid) : null; return (s && s.name) || `${fname(fid)}'s capital`; } catch (e) { return `${fname(fid)}'s capital`; } };
  const allowed = (fid) => {
    const f = info(fid);
    if (!f || f.secret) return false;
    return (C.factions || []).includes(f.id) || (C.kinds || []).includes(f.kind);
  };
  const ledBy = (a) => {
    const list = typeof globalThis.__dboRealmFactionsLedBy === 'function' ? (globalThis.__dboRealmFactionsLedBy(a) || []) : [];
    return list.map((x) => (typeof x === 'string' ? x : x && x.id)).filter((x) => x && allowed(x));
  };
  const isStaff = (a) => { try { return !!isAdmin(a); } catch (e) { return false; } };

  // ---- wars ------------------------------------------------------------------------------------------------------------
  const live = () => data().wars.filter((w) => w.status !== 'ended');
  const warById = (id) => data().wars.find((w) => w.id === Number(id)) || null;
  const warsOf = (fid) => live().filter((w) => w.a === fid || w.d === fid);
  const other = (w, fid) => (fid === w.a ? w.d : w.a);
  const key = (a) => `c${(Number(a) >>> 0).toString(16)}`;
  const enlisted = (w, a) => (w.roster || {})[key(a)] || null;
  const sideIn = (w, a) => { const r = enlisted(w, a); return r ? r.side : null; };
  const clean = (t, max) => String(t || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\[\[/g, '[ [').split('#{').join('# {').replace(/\s+/g, ' ').trim().slice(0, max);
  const whenText = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  // A side named in a command: its faction id, or attacker / defender
  const sideArg = (w, s) => { const x = String(s || '').toLowerCase(); return x === w.a || x === 'attacker' || x === 'a' ? w.a : x === w.d || x === 'defender' || x === 'd' ? w.d : null; };
  // Who fights the next battle on home ground: the side the line stands in (the declared-on side at stage 0)
  const homeSide = (w) => (w.line < 0 ? w.a : w.d);
  const lineText = (w) => {
    if (w.status === 'proposed') return 'Waiting for staff to confirm it';
    const start = w.start ? ` (from ${w.start})` : '';
    if (w.line === 0) return `The front stands at the starting line${start}`;
    const [ahead, behind] = w.line > 0 ? [w.a, w.d] : [w.d, w.a];
    return `${fname(ahead)} has pushed ${Math.abs(w.line)} of ${STAGES} stage${STAGES === 1 ? '' : 's'} into ${fname(behind)}'s land${start}`;
  };
  const nextText = (w) => {
    if (w.final) return `Final Stand at ${w.final.place}${w.next && w.next.when ? `, ${whenText(w.next.when)}` : ''}`;
    const n = w.next || {};
    return `${n.place ? `Next battle at ${n.place}` : `${fname(homeSide(w))} has not chosen the next battlefield`}${n.when ? `, ${whenText(n.when)}` : ''}`;
  };

  // ---- announcements ---------------------------------------------------------------------------------------------------
  const md = (t) => String(t == null ? '' : t).replace(/[\\*_~`|[\]<@]/g, (ch) => `\\${ch}`).replace(/^\s*([#>+-])/, (m, ch) => m.slice(0, -1) + `\\${ch}`);
  const discordOn = () => !!C.discord && !!api.token && !!sendJson && /^\d{15,22}$/.test(String(C.discordChannelId || ''));
  const toDiscord = (text) => {
    if (!discordOn()) return;
    const ping = /^\d{15,22}$/.test(String(C.discordPingRoleId || '')) ? String(C.discordPingRoleId) : '';
    const body = { content: `${ping ? `<@&${ping}> ` : ''}**War**\n${md(text)}`.slice(0, 1900), allowed_mentions: { parse: [], roles: ping ? [ping] : [] } };
    sendJson('POST', `https://discord.com/api/v10/channels/${C.discordChannelId}/messages`, body, { Authorization: `Bot ${api.token}` })
      .then(() => {}, (e) => log('frontline: Discord post failed', e.message));
  };
  const announce = (text, alsoDiscord) => {
    if (C.announce) for (const o of onlineActors()) { system(o, text); try { sendPacket(o, { customPacketType: 'dboBanner', text, seconds: 6 }); } catch (e) { /* old client */ } }
    if (alsoDiscord !== false) toDiscord(text);
  };
  // Leaders of both sides, the soldiers of both and staff: news that is not for everyone
  const tellWar = (w, text) => {
    for (const o of onlineActors()) if (isStaff(o) || leads(o, w.a) || leads(o, w.d) || enlisted(w, o)) personal(o, text);
  };
  const tellStaff = (text) => { for (const o of onlineActors()) if (isStaff(o)) personal(o, text); };

  // ---- the rules -------------------------------------------------------------------------------------------------------
  const declare = (a, fid, target, reason) => {
    if (!C.enabled) return 'War is not open yet.';
    if (!leads(a, fid)) return `Only the leader of ${fname(fid)} can declare its wars.`;
    if (!allowed(fid)) return `${fname(fid)} cannot wage war.`;
    if (!allowed(target) || target === fid) return `${fname(target)} is not a faction you can declare on.`;
    if (warsOf(fid).some((w) => other(w, fid) === target)) return `${fname(fid)} is already at war with ${fname(target)}.`;
    const cap = Math.max(1, Number(C.warsPerFaction) || 1);
    if (warsOf(fid).length >= cap) return `${fname(fid)} is already at war.`;
    if (warsOf(target).length >= cap) return `${fname(target)} is already at war.`;
    const d = data();
    const w = { id: d.nextId++, a: fid, d: target, reason: clean(reason, Number(C.maxReason) || 200), status: 'proposed', declaredBy: who(a),
      declaredAt: now(), line: 0, start: '', next: { place: '', territory: '', when: 0 }, battle: null, battles: [], roster: {}, stats: {}, prisoners: {}, final: null };
    d.wars.push(w);
    audit(`FRONT war ${w.id} declared by ${who(a)}: ${fid} on ${target}${w.reason ? `: ${w.reason}` : ''}`);
    if (C.confirm === 'none') { activate(w, 0, ''); return `${fname(fid)} is at war with ${fname(target)}.`; }
    save();
    tellStaff(`${fname(fid)} declares war on ${fname(target)} (war ${w.id}${w.reason ? `: ${w.reason}` : ''}). Confirm it in /front, or /front confirm ${w.id} [stage] [starting point].`);
    for (const o of onlineActors()) if (leads(o, target)) personal(o, `${fname(fid)} has declared war on ${fname(target)}. The staff will confirm it.`);
    return `Declared. The staff will confirm the war on ${fname(target)} and name where the front starts.`;
  };
  const activate = (w, line, start) => {
    w.status = 'active'; w.line = Math.max(-STAGES + 1, Math.min(STAGES - 1, Math.round(Number(line) || 0))); w.start = clean(start, 80);
    w.startedAt = now();
    save();
    announce(`War: ${fname(w.a)} against ${fname(w.d)}${w.reason ? `, ${w.reason}` : ''}. ${lineText(w)}. Anyone may enlist with /front.`);
  };
  const confirm = (a, w, line, start) => {
    if (!isStaff(a)) return 'Only staff confirm a war.';
    if (!w || w.status !== 'proposed') return 'That war is not waiting for confirmation.';
    w.confirmedBy = who(a); activate(w, line, start);
    audit(`FRONT war ${w.id} confirmed by ${who(a)} at stage ${w.line}${w.start ? ` from ${w.start}` : ''}`);
    return `War ${w.id} has begun.`;
  };
  const refuse = (a, w, why) => {
    if (!isStaff(a)) return 'Only staff refuse a war.';
    if (!w || w.status !== 'proposed') return 'That war is not waiting for confirmation.';
    end(w, null, 'refused', `refused by the staff${why ? `: ${clean(why, 200)}` : ''}`, a, true);
    for (const o of onlineActors()) if (leads(o, w.a)) personal(o, `The staff did not confirm the war on ${fname(w.d)}${why ? `: ${clean(why, 200)}` : ''}.`);
    return `War ${w.id} refused.`;
  };
  const enlist = (a, w, side) => {
    if (!w || w.status === 'ended') return 'That war is over.';
    if (side !== w.a && side !== w.d) return 'Enlist for one of its two sides.';
    if (enlisted(w, a)) return `You are already enlisted for ${fname(enlisted(w, a).side)}.`;
    if (w.battle && !C.enlistDuringBattle) return 'A battle is being fought. Enlist when it is over.';
    if (w.prisoners && w.prisoners[key(a)]) return 'You yielded as a prisoner of this war.';
    const foe = other(w, side);
    if (memberOf(a, foe)) return `You belong to ${fname(foe)}: you cannot fight against it.`;
    if (!C.openEnlist && !memberOf(a, side)) return `Only members of ${fname(side)} enlist for it.`;
    const busy = live().find((x) => x !== w && enlisted(x, a));
    if (busy) return `You are already enlisted in the war between ${fname(busy.a)} and ${fname(busy.d)}.`;
    const pid = Number(profileOf(a));
    if (pid >= 0 && Object.values(w.roster).some((r) => r.profile === pid && r.side !== side)) return 'Another character of yours fights on the other side.';
    w.roster[key(a)] = { char: Number(a) >>> 0, profile: pid, name: realNameOf(a), tag: String(tagOf(a) || ''), side, at: now() };
    save();
    audit(`FRONT war ${w.id}: ${who(a)} enlisted for ${side}`);
    for (const o of onlineActors()) if (o !== a && leads(o, side)) personal(o, `${realNameOf(a)} has enlisted to fight for ${fname(side)}.`);
    return `You are enlisted to fight for ${fname(side)}. ${nextText(w)}.`;
  };
  const leave = (a, w) => {
    const r = w && enlisted(w, a);
    if (!r) return 'You are not enlisted in that war.';
    if (w.battle) return 'Not while a battle is being fought.';
    delete w.roster[key(a)]; save();
    audit(`FRONT war ${w.id}: ${who(a)} left the roster of ${r.side}`);
    return `You are no longer enlisted for ${fname(r.side)}.`;
  };
  const discharge = (a, w, charKey) => {
    const r = w && w.roster[charKey];
    if (!r) return 'They are not on the roster.';
    if (!isStaff(a) && !leads(a, r.side)) return `Only the leader of ${fname(r.side)} discharges its soldiers.`;
    delete w.roster[charKey]; save();
    audit(`FRONT war ${w.id}: ${who(a)} discharged ${r.name} #${r.tag} from ${r.side}`);
    for (const o of onlineActors()) if (key(o) === charKey) personal(o, `You have been discharged from the war for ${fname(r.side)}.`);
    return `${r.name} is discharged.`;
  };
  const choosePlace = (a, w, tid) => {
    if (!w || (w.status !== 'active')) return 'There is no battle to choose a field for.';
    const home = homeSide(w);
    if (!leads(a, home) && !isStaff(a)) return `The leader of ${fname(home)} chooses where the next battle is fought.`;
    if (!territoriesOf(home).includes(tid)) return `That land is not ${fname(home)}'s.`;
    w.next = Object.assign({}, w.next, { place: territoryName(tid), territory: tid, setBy: who(a) }); save();
    tellWar(w, `${fname(home)} will meet ${fname(other(w, home))} at ${w.next.place}.`);
    audit(`FRONT war ${w.id}: next battle at ${tid}, chosen by ${who(a)}`);
    return `The next battle will be fought at ${w.next.place}.`;
  };
  const startBattle = (a, w) => {
    if (!isStaff(a)) return 'Only staff open a battle.';
    if (!w || (w.status !== 'active' && w.status !== 'final')) return 'That war is not being fought.';
    if (w.battle) return 'A battle is already open.';
    w.battle = { n: w.battles.length + 1, at: now(), by: who(a) };
    for (const o of onlineActors()) { const r = enlisted(w, o); if (r) stat(w, key(o)).battles++; }
    save();
    announce(`${w.final ? 'The Final Stand' : `Battle ${w.battle.n}`} between ${fname(w.a)} and ${fname(w.d)} has begun${w.final ? ` at ${w.final.place}` : w.next.place ? ` at ${w.next.place}` : ''}.`);
    return 'The battle is open. Record its result when it ends.';
  };
  const stat = (w, k) => { w.stats = w.stats || {}; return w.stats[k] || (w.stats[k] = { downs: 0, finals: 0, fell: 0, battles: 0 }); };
  // Staff record a battle: the winner moves the line one stage toward the loser's capital
  const record = (a, w, winner, note) => {
    if (!isStaff(a)) return 'Only staff record battles.';
    if (!w || (w.status !== 'active' && w.status !== 'final')) return 'That war is not being fought.';
    if (winner !== w.a && winner !== w.d) return 'Name the side that won.';
    const loser = other(w, winner);
    const entry = { n: w.battles.length + 1, at: now(), winner, place: w.final ? w.final.place : (w.next.place || ''), note: clean(note, Number(C.maxNote) || 200), by: who(a), final: !!w.final };
    w.battles.push(entry); w.battle = null;
    audit(`FRONT war ${w.id}: battle ${entry.n} won by ${winner}, recorded by ${who(a)}${entry.note ? `: ${entry.note}` : ''}`);
    if (w.final) {
      if (winner === w.final.by) { end(w, winner, 'final', `${fname(winner)} won the Final Stand at ${w.final.place}`, a); return `${fname(winner)} wins the war.`; }
      w.line += winner === w.a ? 1 : -1; w.final = null; w.status = 'active'; w.next = { place: '', territory: '', when: 0 }; save();
      announce(`${fname(winner)} has held ${entry.place} against ${fname(loser)}. The front is pushed back: ${lineText(w)}.`);
      return 'Recorded: the Final Stand was held.';
    }
    w.line += winner === w.a ? 1 : -1;
    w.next = { place: '', territory: '', when: 0 };
    if (Math.abs(w.line) >= STAGES) {
      w.line = Math.sign(w.line) * STAGES; w.status = 'final';
      w.final = { by: winner, against: loser, place: capitalOf(loser), at: now() };
      save();
      announce(`${fname(winner)} has fought through to ${w.final.place}. A Final Stand against ${fname(loser)} may now be called; its leaders may surrender before it, and any of its people may yield as prisoners.`);
      return 'Recorded: the Final Stand is unlocked.';
    }
    save();
    announce(`${fname(winner)} won the battle${entry.place ? ` at ${entry.place}` : ''} against ${fname(loser)}. ${lineText(w)}.`);
    return 'Recorded.';
  };
  const setWhen = (a, w, text) => {
    if (!isStaff(a)) return 'Only staff set when battles are fought.';
    if (!w || w.status === 'ended' || w.status === 'proposed') return 'That war is not being fought.';
    if (/^clear$/i.test(String(text).trim())) { w.next.when = 0; save(); return 'The next battle has no time set.'; }
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(text).trim());
    if (!m) return 'Give the time as YYYY-MM-DD HH:MM in UTC, or clear.';
    const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (!Number.isFinite(at)) return 'That is not a time.';
    w.next.when = at; save();
    tellWar(w, `${w.final ? 'The Final Stand' : 'The next battle'} between ${fname(w.a)} and ${fname(w.d)} is set for ${whenText(at)}.`);
    return `Set for ${whenText(at)}.`;
  };
  const setPlaceText = (a, w, text) => {
    if (!isStaff(a)) return 'Only staff name a battlefield by hand.';
    if (!w || w.status !== 'active') return 'That war is not being fought.';
    const t = clean(text, 80); if (!t) return 'Name the place.';
    w.next = Object.assign({}, w.next, { place: t, territory: '', setBy: who(a) }); save();
    tellWar(w, `The next battle between ${fname(w.a)} and ${fname(w.d)} will be fought at ${t}.`);
    return `The next battle will be fought at ${t}.`;
  };
  // A leader surrenders the faction; anyone else on the Final Stand's defending side yields as a prisoner
  const surrender = (a, w, fid) => {
    if (!w || w.status === 'ended' || w.status === 'proposed') return 'That war is not being fought.';
    if (!leads(a, fid) || (fid !== w.a && fid !== w.d)) return 'Only a side\'s leader surrenders it.';
    end(w, other(w, fid), 'surrender', `${fname(fid)} surrendered (${realNameOf(a)})`, a);
    return `${fname(fid)} has surrendered.`;
  };
  const yieldTo = (a, w) => {
    if (!w || w.status !== 'final' || !w.final) return 'Only before a Final Stand can you yield.';
    const side = w.final.against;
    if (sideIn(w, a) !== side && !memberOf(a, side)) return `Only ${fname(side)}'s people yield before its Final Stand.`;
    if (leads(a, side)) return surrender(a, w, side);
    w.prisoners = w.prisoners || {};
    w.prisoners[key(a)] = { char: Number(a) >>> 0, name: realNameOf(a), tag: String(tagOf(a) || ''), at: now() };
    delete w.roster[key(a)]; save();
    audit(`FRONT war ${w.id}: ${who(a)} yielded as a prisoner`);
    for (const o of onlineActors()) if (leads(o, w.final.by) || leads(o, side) || isStaff(o)) personal(o, `${realNameOf(a)} of ${fname(side)} yields as a prisoner of ${fname(w.final.by)} and will not fight the Final Stand.`);
    return `You yield to ${fname(w.final.by)}. Give yourself up to them; you take no part in the Final Stand and go free when the war ends.`;
  };
  const end = (w, winner, how, text, by, quiet) => {
    w.status = 'ended'; w.battle = null;
    w.outcome = { winner: winner || null, how, text, at: now(), by: by ? who(by) : 'the server' };
    save();
    audit(`FRONT war ${w.id} ended (${how}): ${text}`);
    if (quiet) return;
    const top = best(w, 1)[0];
    announce(`The war between ${fname(w.a)} and ${fname(w.d)} is over: ${text}.${winner ? ` ${fname(winner)} is victorious.` : ''}${top ? ` Most final blows: ${top.name} (${top.finals}).` : ''}`);
    for (const o of onlineActors()) if (w.prisoners && w.prisoners[key(o)]) personal(o, 'The war is over: you are free.');
  };
  const staffEnd = (a, w, winner, note) => {
    if (!isStaff(a)) return 'Only staff end a war.';
    if (!w || w.status === 'ended') return 'That war is already over.';
    end(w, winner, 'staff', `ended by the staff${note ? `: ${clean(note, 200)}` : ''}`, a);
    return `War ${w.id} ended.`;
  };
  const best = (w, n) => Object.entries(w.stats || {}).map(([k, s]) => Object.assign({ name: ((w.roster || {})[k] || (w.prisoners || {})[k] || {}).name || 'a soldier' }, s))
    .filter((s) => s.finals || s.downs).sort((x, y) => y.finals - x.finals || y.downs - x.downs).slice(0, n);

  // downed.js: a down or a finishing blow counts while staff have a battle open, between soldiers of the two sides
  const fight = (victim, by) => {
    if (!by || (by >>> 0) === (victim >>> 0)) return null;
    for (const w of live()) {
      if (!w.battle) continue;
      const v = sideIn(w, victim), k = sideIn(w, by);
      if (v && k && v !== k) return w;
    }
    return null;
  };
  globalThis.__dboFrontDown = (victim, by) => { try { const w = fight(victim, by); if (w) { stat(w, key(by)).downs++; stat(w, key(victim)).fell++; save(); } } catch (e) { log('frontline: down not counted', e.message); } };
  globalThis.__dboFrontFinish = (victim, by) => { try { const w = fight(victim, by); if (w) { stat(w, key(by)).finals++; save(); } } catch (e) { log('frontline: finish not counted', e.message); } };

  // ---- the panel (contextMenu, widget 157) -----------------------------------------------------------------------------
  const seesRoster = (a, w) => isStaff(a) || leads(a, w.a) || leads(a, w.d) || !!enlisted(w, a);
  const sideCount = (w, fid) => Object.values(w.roster || {}).filter((r) => r.side === fid).length;
  const open = (a, page, note) => {
    const nonce = `${(a >>> 0).toString(16)}-${now().toString(36)}`;
    S.panels.set(a >>> 0, { nonce });
    const act = (id, label) => ({ id: `${nonce}|${id}`, label });
    const actions = []; let title = ''; let lines = null;
    const [kind, x, y] = String(page || 'main').split(':');
    const w = x ? warById(x) : null;
    if (kind === 'war' && w) {
      const mine = enlisted(w, a);
      title = `${fname(w.a)} against ${fname(w.d)}${w.reason ? `: ${w.reason}` : ''}. ${lineText(w)}.`;
      if (w.status !== 'proposed') title += ` ${nextText(w)}.${w.battle ? ' A battle is being fought now.' : ''}`;
      title += ` Enlisted: ${fname(w.a)} ${sideCount(w, w.a)}, ${fname(w.d)} ${sideCount(w, w.d)}.`;
      title += mine ? ` You fight for ${fname(mine.side)}.` : '';
      if (!mine && !(w.prisoners || {})[key(a)]) for (const s of [w.a, w.d]) if (!memberOf(a, other(w, s)) && (C.openEnlist || memberOf(a, s))) actions.push(act(`enlist:${w.id}:${s}`, `Enlist for ${fname(s)}`));
      if (mine && !w.battle) actions.push(act(`leave:${w.id}`, 'Leave the roster'));
      if (seesRoster(a, w)) actions.push(act(`page:roster:${w.id}`, 'The roster and the record'));
      for (const s of [w.a, w.d]) {
        if (!leads(a, s)) continue;
        if (w.status === 'active' && homeSide(w) === s) actions.push(act(`page:field:${w.id}:${s}`, 'Choose the next battlefield'));
        if (sideCount(w, s)) actions.push(act(`page:discharge:${w.id}:${s}`, `Discharge a soldier of ${fname(s)}`));
        if (w.status !== 'proposed') actions.push(act(`page:surrender:${w.id}:${s}`, `Surrender ${fname(s)}`));
      }
      if (w.status === 'final' && w.final && !leads(a, w.final.against) && (sideIn(w, a) === w.final.against || memberOf(a, w.final.against))) actions.push(act(`page:yield:${w.id}`, `Yield to ${fname(w.final.by)} as a prisoner`));
      if (isStaff(a)) {
        if (w.status === 'proposed') { actions.push(act(`confirm:${w.id}`, 'Staff: confirm, starting at the line')); actions.push(act(`refuse:${w.id}`, 'Staff: refuse it')); } else {
          if (!w.battle) actions.push(act(`start:${w.id}`, `Staff: open ${w.final ? 'the Final Stand' : 'the next battle'}`));
          actions.push(act(`win:${w.id}:${w.a}`, `Staff: ${fname(w.a)} won the battle`));
          actions.push(act(`win:${w.id}:${w.d}`, `Staff: ${fname(w.d)} won the battle`));
        }
        actions.push(act(`page:end:${w.id}`, 'Staff: end the war'));
      }
      actions.push(act('page:main', 'Back'));
    } else if (kind === 'roster' && w && seesRoster(a, w)) {
      title = `The roster: ${fname(w.a)} against ${fname(w.d)}`;
      lines = [];
      for (const s of [w.a, w.d]) {
        const rs = Object.entries(w.roster || {}).filter(([, r]) => r.side === s);
        lines.push(`${fname(s)}: ${rs.length} enlisted`);
        if (isStaff(a) || leads(a, w.a) || leads(a, w.d) || sideIn(w, a) === s) for (const [k, r] of rs.slice(0, 40)) { const st = (w.stats || {})[k] || {}; lines.push(`  ${r.name}${isStaff(a) ? ` #${r.tag}` : ''}: ${st.battles || 0} battles, ${st.downs || 0} downed, ${st.finals || 0} final blows`); }
      }
      const pr = Object.values(w.prisoners || {});
      if (pr.length) lines.push(`Yielded as prisoners: ${pr.map((p) => p.name).join(', ')}`);
      lines.push(`Battles: ${w.battles.length ? w.battles.map((b) => `${b.final ? 'Final Stand' : b.n}${b.place ? ` at ${b.place}` : ''} won by ${fname(b.winner)}`).join('; ') : 'none yet'}`);
    } else if (kind === 'field' && w && (leads(a, y) || isStaff(a))) {
      title = `Where will ${fname(y)} meet ${fname(other(w, y))}? Your land:`;
      for (const tid of territoriesOf(y).slice(0, 30)) actions.push(act(`field:${w.id}:${tid}`, territoryName(tid)));
      if (!actions.length) title = `${fname(y)} holds no land the realm map knows. Ask the staff to name the battlefield.`;
      actions.push(act(`page:war:${w.id}`, 'Back'));
    } else if (kind === 'discharge' && w && (leads(a, y) || isStaff(a))) {
      title = `Discharge a soldier of ${fname(y)}`;
      for (const [k, r] of Object.entries(w.roster || {}).filter(([, r]) => r.side === y).slice(0, 30)) actions.push(act(`discharge:${w.id}:${k}`, r.name));
      actions.push(act(`page:war:${w.id}`, 'Back'));
    } else if (kind === 'surrender' && w && leads(a, y)) {
      title = `Surrender ${fname(y)} to ${fname(other(w, y))}? The war ends at once and ${fname(other(w, y))} wins it; the terms are agreed in person.`;
      actions.push(act(`surrender:${w.id}:${y}`, `Yes, surrender ${fname(y)}`));
      actions.push(act(`page:war:${w.id}`, 'Back'));
    } else if (kind === 'yield' && w && w.final) {
      title = `Yield to ${fname(w.final.by)}? You give yourself up as their prisoner, leave the roster, take no part in the Final Stand and go free when the war ends.`;
      actions.push(act(`yield:${w.id}`, 'Yes, yield'));
      actions.push(act(`page:war:${w.id}`, 'Back'));
    } else if (kind === 'end' && w && isStaff(a)) {
      title = `End the war between ${fname(w.a)} and ${fname(w.d)}. Who won? Land and terms are applied by hand.`;
      actions.push(act(`end:${w.id}:${w.a}`, `${fname(w.a)} won`));
      actions.push(act(`end:${w.id}:${w.d}`, `${fname(w.d)} won`));
      actions.push(act(`end:${w.id}:none`, 'No winner'));
      actions.push(act(`page:war:${w.id}`, 'Back'));
    } else if (kind === 'declare' && leads(a, x)) {
      title = `${fname(x)} declares war on:`;
      const known = typeof globalThis.__dboFactionList === 'function' ? globalThis.__dboFactionList() || [] : [];
      for (const fid of known.filter((f) => f !== x && allowed(f) && !warsOf(f).length)) actions.push(act(`declare:${x}:${fid}`, fname(fid)));
      if (!actions.length) title = 'There is no faction to declare on.';
      actions.push(act('page:main', 'Back'));
    } else {
      const ws = live();
      title = ws.length ? `Wars under way: ${ws.length}.` : 'No faction is at war.';
      if (!C.enabled) title += ' War is not open yet.';
      for (const q of ws) actions.push(act(`page:war:${q.id}`, `${fname(q.a)} against ${fname(q.d)}: ${q.status === 'proposed' ? 'waiting for the staff' : q.status === 'final' ? 'the Final Stand' : `stage ${q.line}`}`));
      if (C.enabled) for (const fid of ledBy(a)) if (warsOf(fid).length < Math.max(1, Number(C.warsPerFaction) || 1)) actions.push(act(`page:declare:${fid}`, `Declare war for ${fname(fid)}`));
    }
    if (note) title = `${note} ${title}`;
    if (lines) openWidget(a, { type: 'contextMenu', id: MENU_ID, mode: 'inspect', targetName: title, actions: [], lines, events: { action: 'dbo:frontChoose', close: 'dbo:frontClose' } }, true);
    else openWidget(a, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: title, actions, events: { action: 'dbo:frontChoose', close: 'dbo:frontClose' } }, true);
    return true;
  };
  const choose = (a, raw) => {
    const p = S.panels.get(a >>> 0);
    const s = String(raw || ''); const bar = s.indexOf('|');
    if (!p || bar <= 0 || s.slice(0, bar) !== p.nonce) return;
    const [verb, x, y] = s.slice(bar + 1).split(':');
    const w = x ? warById(x) : null;
    const back = (r) => open(a, w ? `war:${w.id}` : 'main', r);
    switch (verb) {
      case 'page': return open(a, [x, y, s.slice(bar + 1).split(':')[3]].filter((q) => q !== undefined).join(':'));
      case 'enlist': return back(enlist(a, w, y));
      case 'leave': return back(leave(a, w));
      case 'discharge': return open(a, `war:${x}`, discharge(a, w, y));
      case 'field': return back(choosePlace(a, w, y));
      case 'surrender': return back(surrender(a, w, y));
      case 'yield': return back(yieldTo(a, w));
      case 'confirm': return back(confirm(a, w, 0, ''));
      case 'refuse': return back(refuse(a, w, ''));
      case 'start': return back(startBattle(a, w));
      case 'win': return back(record(a, w, y, ''));
      case 'end': return back(staffEnd(a, w, y === 'none' ? null : sideArg(w, y), ''));
      case 'declare': { const r = declare(a, x, y, ''); const nw = live().find((q) => q.a === x && q.d === y); return open(a, nw ? `war:${nw.id}` : 'main', r); }
      default: return undefined;
    }
  };
  onUi('frontChoose', (a, args) => { try { choose(a >>> 0, (args || [])[0]); } catch (e) { log('frontline: panel failed', e.message); } });
  onUi('frontClose', (a) => { S.panels.delete(a >>> 0); closeWidget(a, MENU_ID); });

  // ---- /front ------------------------------------------------------------------------------------------------------------
  const STAFF_USAGE = 'Staff: /front confirm <war> [stage] [starting point] | refuse <war> [why] | start <war> | win <war> <side> [note] | place <war> <name> | when <war> <YYYY-MM-DD HH:MM|clear> | end <war> <side|none> [note]. A side is its faction id, attacker or defender.';
  const command = (a, args) => {
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || '').toLowerCase();
    const w = parts[1] ? warById(parts[1]) : null;
    const rest = (n) => parts.slice(n).join(' ');
    const say = (t) => personal(a, t);
    switch (sub) {
      case '': return open(a, 'main');
      case 'help': say('/front opens the war panel: the front, the roster and the next battle. /front declare <faction id> <reason> (leaders), /front enlist <war> <side>, /front leave <war>, /front yield <war>, /front surrender <war> <your faction id>.'); if (isStaff(a)) say(STAFF_USAGE); return undefined;
      case 'declare': { const mine = ledBy(a); const fid = mine.length === 1 ? mine[0] : null; if (!fid) return say(mine.length ? 'You lead more than one faction: declare from the panel.' : 'Only a faction\'s leader declares war.'); return say(declare(a, fid, String(parts[1] || '').toLowerCase(), rest(2))); }
      case 'enlist': return say(w ? enlist(a, w, sideArg(w, parts[2])) : 'Usage: /front enlist <war> <side>');
      case 'leave': return say(w ? leave(a, w) : 'Usage: /front leave <war>');
      case 'yield': return say(yieldTo(a, w));
      case 'surrender': return say(w ? surrender(a, w, sideArg(w, parts[2])) : 'Usage: /front surrender <war> <your faction id>');
      case 'confirm': { const n = Number(parts[2]); const has = parts[2] !== undefined && Number.isFinite(n); return say(confirm(a, w, has ? n : 0, rest(has ? 3 : 2))); }
      case 'refuse': return say(refuse(a, w, rest(2)));
      case 'start': return say(startBattle(a, w));
      case 'win': return say(w ? record(a, w, sideArg(w, parts[2]), rest(3)) : 'No such war.');
      case 'place': return say(setPlaceText(a, w, rest(2)));
      case 'when': return say(setWhen(a, w, rest(2)));
      case 'end': { if (!w) return say('No such war.'); const s = String(parts[2] || '').toLowerCase(); const win = s === 'none' ? null : sideArg(w, s); if (s !== 'none' && !win) return say('Name the winner (faction id, attacker or defender) or none.'); return say(staffEnd(a, w, win, rest(3))); }
      case 'list': for (const q of data().wars.slice(-10)) say(`#${q.id} ${fname(q.a)} vs ${fname(q.d)} [${q.status}] line ${q.line}/${STAGES}, ${Object.keys(q.roster || {}).length} enlisted${q.outcome ? `; ${q.outcome.text}` : ''}`); return undefined;
      default: return say('Unknown. /front help');
    }
  };
  registerChatCommand('front', (a, args) => command(a, args), { help: 'the war panel: the front, enlisting, the roster and the next battle' });

  log(`frontline loaded: ${live().length} war(s) under way, ${C.enabled ? 'OPEN' : 'closed (frontline.enabled false)'}, ${STAGES} stage(s), confirm ${C.confirm}`);
  return { declare, confirm, refuse, enlist, leave, discharge, choosePlace, startBattle, record, setWhen, setPlaceText, surrender, yieldTo, staffEnd, command, open, choose, data, live, STAGES, MENU_ID };
};
