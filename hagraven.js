// DragonBreak Online: the Hagraven's pact, a woman of the Reach trading her humanity for witchcraft (Nat, 25 Oct 2026; design
// _work\hagraven-design-1025.md on the PC, items H1, H2 and H4). Loaded by gamemode.js after briarheart.js (whose altars the
// pact uses) and exposure.js. Off until config hagraven.enabled is true (feature flags are switched on with Nat).
//
// A curse on the character's own humanoid race, never a race change or a beast form: the vanilla HagravenRace (Skyrim
// 0131FB) is not playable (DATA flags 0x8900, a non-humanoid HagravenProject.hkx graph), and a non-humanoid caster is the
// known path to watcher crashes (server memory remote-vampire-lord-crashes-watchers). The look (H5) and the crows (H3) wait
// for Nat's models: config visual holds one armour per stage, empty until then.
// Not a supernatural.js kind (that would make her a beast to gamemode.js, guilds.js and beastform.js): the record is its own
// (private.dboHagraven) and refuses, and is refused by, a vampire, a werewolf, a fever and a Briarheart.
//
// The pact (H1): /hagraven pact at a Hagraven altar (briarheart.js's: /briarheart altar add) by a woman (appearance.isFemale)
//   of config races (the DLE's DBOReachmanRace) whose faith (prayer.js) is in config faiths (The Reach Old Gods), carrying a
//   Hagraven Feather and a Hagraven Claw (pactItems, spent), confirmed with /hagraven confirm within 5 minutes. No death:
//   the price is the life after. Staff: /hagraven grant <name> <reason>, revoke, stage <name> <1-3> <reason> (Lead GM).
// The stages (H2), by time played as one (counted on the server, a minute a tick while she is online; time offline does
//   not count): stageHours [20, 60] are the hours at which she becomes Feathered (2) and then a Hagraven (3).
//   1 Crone-touched: her Destruction spell hits harder by spellBonus[0] (the hit's source effects of a school in
//     spellSkills, MGEF DATA magic skill at 12: Destruction 20), magicka regeneration magickaRegen[0] (racial.js asks
//     __dboHagravenRegenMult), and no Divine's blessing but Kynareth's (prayer.js asks __dboHagravenRefusesDeity).
//   2 Feathered: spellBonus[1]; slower (speedMult, the server's Papyrus SetActorValue SpeedMult, to be measured in game);
//     her citizenship of every hold but keepHolds (the Reach) lapses and is barred for barDays, renewed each day while
//     she is one (citizenship.js __dboCitizenOutlaw), so a cure lets it run out.
//   3 Hagraven: spellBonus[2]; she may perform the Briarheart rite (briarheart.js asks __dboHagravenRiteAt: a Hagraven at
//     the altar is the one who presses the briar in); known on sight: seen by exposure.js's witnesses in a hold not in
//     knownOnSightExemptHolds (default the Reach), she is exposed there as a Hagraven (exposure.js form 'hagraven': the
//     hold's bounty and guards, the hunters told), at most once per witnessEveryMinutes.
// The cure (H4), Kyne's alone (lore: Kyne cleansed Keeper Ormi, ESO): /hagraven cure at a shrine of Kynareth touched in the
//   last 10 minutes (prayer.js __dboPrayerLastShrine), offering a filled grand soul gem (cureItem): she is mortal again,
//   her speed restored; the citizenship bar runs out by itself. Staff can cure: /hagraven revoke <name> <reason>.
//
// The body (Nat, 25 Oct, the Leader's brief): a Hagraven (stage 3) takes the real Hagraven creature with /hagraven form and
//   leaves it the same way, at will, form.cooldownSeconds between changes. It is beastform.js's polymorph (__dboPolymorphAs,
//   by 'hagraven'), so its guards all apply: the Owners' switch, dead, down, bound, jailed, duelling, in a fight, mounted,
//   seated, in water, indoors, and the creatureBody distance guard; death, logout and login revert it as any form. The
//   creature casts nothing, so she leaves the body to cast; her stage stays on her, its SpeedMult is put back after the body.
//   Down, jail, bound or carried, the pact ended or her stage lowered end the body (formTick, every 5 s).
// Chat: /hagraven [status] | pact | confirm | form | cure; staff: grant <name> <reason> | revoke <name> <reason> |
//   stage <name> <1-3> <reason> | list.
// State: private.dboHagraven = { since, played (ms), stage, how, by, barredAt } on the character.
'use strict';

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, registerChatCommand, onlineActors, isLeadStaff, findByName, every } = api;
  const sourceSkillsOf = typeof api.sourceSkillsOf === 'function' ? api.sourceSkillsOf : () => new Set();
  const zoneOfActor = typeof api.zoneOfActor === 'function' ? api.zoneOfActor : () => null;
  const giveItem = typeof api.giveItem === 'function' ? api.giveItem : null;
  const C = Object.assign({
    enabled: false,
    races: ['DBOReachmanRace'], femaleOnly: true, faiths: ['reach'],
    pactItems: ['3ad66:Skyrim.esm', '6b689:Skyrim.esm'],   // HagravenFeathers, HagravenClaw (INGR)
    confirmMinutes: 5,
    stageHours: [20, 60],
    spellBonus: [0.10, 0.20, 0.30], spellSkills: [20],       // Destruction (MGEF DATA magic skill, verified on Firebolt's effects)
    magickaRegen: [1.5, 1.5, 1.5],
    allowedDeities: ['kynareth'],                            // the one Divine whose blessing still reaches her
    speedMult: 90,
    citizenshipLapse: true, keepHolds: ['markarth'], barDays: 7,
    canRiteBriarhearts: true,
    knownOnSight: true, knownOnSightExemptHolds: ['markarth'], witnessRadius: 2000, witnessEveryMinutes: 10,
    cureDeities: ['kynareth'], cureItem: '2e4ff:Skyrim.esm',  // a filled grand soul gem
    visual: { enabled: false, stages: { 1: '', 2: '', 3: '' } },
  }, (cfg && cfg.hagraven) || {});
  C.form = Object.assign({ enabled: true, cooldownSeconds: 60 }, (cfg && cfg.hagraven && cfg.hagraven.form) || {});
  const PROP = 'private.dboHagraven';
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const NAMES = ['', 'Crone-touched', 'Feathered', 'Hagraven'];

  const S = globalThis.__dboHagraven || (globalThis.__dboHagraven = { pending: new Map(), seenAt: new Map() });
  if (!(S.formAt instanceof Map)) S.formAt = new Map();
  if (!(S.pending instanceof Map)) S.pending = new Map();
  if (!(S.seenAt instanceof Map)) S.seenAt = new Map();

  // ---- helpers ----------------------------------------------------------------------------------------------------------
  const idOf = (desc) => { try { return Number(mp.getIdFromDesc(String(desc))) >>> 0; } catch (e) { return 0; } };
  const get = (a, p, d) => { try { const v = mp.get(a >>> 0, p); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const set = (a, p, v) => { try { mp.set(a >>> 0, p, v); return true; } catch (e) { log(`hagraven: writing ${p} failed`, e.message); return false; } };
  const isOnline = (a) => onlineActors().includes(a >>> 0);
  const papyrus = (a, method, args) => { try { mp.callPapyrusFunction('method', 'Actor', method, { type: 'form', desc: mp.getDescFromId(a >>> 0) }, args); return true; } catch (e) { log(`hagraven: ${method} failed`, e.message); return false; } };
  const fn = (n) => (typeof globalThis[n] === 'function' ? globalThis[n] : null);
  const call = (n, ...args) => { const f = fn(n); if (!f) return undefined; try { return f(...args); } catch (e) { log(`hagraven: ${n} failed`, e.message); return undefined; } };
  const recOf = (a) => { const r = get(a, PROP, null); return r && typeof r === 'object' && r.since ? r : null; };
  const stageOf = (a) => { const r = recOf(a); return r ? Math.max(1, Math.min(3, Number(r.stage) || 1)) : 0; };
  const raceEdid = (a) => { try { const app = mp.get(a >>> 0, 'appearance'); const r = app && mp.lookupEspmRecordById(Number(app.raceId) >>> 0); return String((r && r.record && r.record.editorId) || ''); } catch (e) { return ''; } };
  const isFemale = (a) => { try { const app = mp.get(a >>> 0, 'appearance'); return !!(app && app.isFemale === true); } catch (e) { return false; } };
  const invOf = (a) => { try { return ((mp.get(a >>> 0, 'inventory') || {}).entries || []); } catch (e) { return []; } };
  const hasOne = (a, id) => invOf(a).some((e) => (Number(e.baseId) >>> 0) === id && Number(e.count) > 0);
  const takeEach = (a, ids) => {
    const entries = invOf(a).map((e) => Object.assign({}, e));
    for (const id of ids) { const hit = entries.find((e) => (Number(e.baseId) >>> 0) === id && Number(e.count) > 0); if (!hit) return false; hit.count -= 1; }
    set(a, 'inventory', { entries: entries.filter((e) => Number(e.count) > 0) }); return true;
  };
  const posOf = (a) => { try { const l = mp.get(a >>> 0, 'locationalData'); return l && Array.isArray(l.pos) ? { world: String(l.cellOrWorldDesc || ''), pos: l.pos } : null; } catch (e) { return null; } };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], (p[2] || 0) - (q[2] || 0));
  const isStaff = (a) => !!call('__dboIsStaff', a >>> 0);
  const superKind = (a) => call('__dboSuperKind', a >>> 0) || null;
  const superState = (a) => get(a, 'private.supernatural', null) || {};
  const faithId = (a) => String(call('__dboFaithIdOf', a >>> 0) || '');
  const zoneId = (a) => { try { const z = zoneOfActor(a >>> 0); return z ? String(z.id || z) : ''; } catch (e) { return ''; } };
  const stageFor = (played) => { const h = (Number(played) || 0) / HOUR; const t = C.stageHours || []; return h >= (Number(t[1]) || Infinity) ? 3 : h >= (Number(t[0]) || Infinity) ? 2 : 1; };
  const at = (list, stage) => { const v = Array.isArray(list) ? Number(list[stage - 1]) : NaN; return Number.isFinite(v) ? v : 0; };

  // ---- what each stage does ---------------------------------------------------------------------------------------------
  // Applied on entering a stage, at login, and undone at the end
  const applyStage = (a, why) => {
    const st = stageOf(a); if (!st || !isOnline(a)) return;
    if (st >= 2 && Number(C.speedMult) > 0 && Number(C.speedMult) !== 100) {
      papyrus(a, 'SetActorValue', ['SpeedMult', Number(C.speedMult)]);
      log(`hagraven: SpeedMult ${C.speedMult} on ${display(a)} (${why}, stage ${st})`);
    }
    if (st >= 2) lapseCitizenship(a, why);
    const look = C.visual && C.visual.enabled && C.visual.stages ? String(C.visual.stages[st] || '') : '';
    if (look) { const id = idOf(look); if (id && !hasOne(a, id) && giveItem) giveItem(a >>> 0, id, 1); if (id) papyrus(a, 'EquipItem', [{ type: 'espm', desc: look }, false, true]); }
  };
  const undoStage = (a, stageWas) => {
    if (isOnline(a) && stageWas >= 2 && Number(C.speedMult) > 0 && Number(C.speedMult) !== 100) papyrus(a, 'SetActorValue', ['SpeedMult', 100]);
  };
  // Stage 2+: every citizenship but keepHolds is taken and barred for barDays, once a day while she is one
  const lapseCitizenship = (a, why) => {
    if (!C.citizenshipLapse || !fn('__dboCitizenOutlaw')) return;
    const r = recOf(a); if (!r) return;
    const holds = (call('__dboCitizenHolds', a >>> 0) || []).map(String);
    const due = !r.barredAt || Date.now() - Number(r.barredAt) > DAY;
    const keep = new Set((C.keepHolds || []).map(String));
    const lose = holds.filter((z) => !keep.has(z));
    if (!lose.length && !due) return;
    for (const z of lose.length ? lose : []) call('__dboCitizenOutlaw', a >>> 0, z, Date.now() + Number(C.barDays) * DAY, `a Hagraven (${why})`);
    r.barredAt = Date.now(); set(a, PROP, r);
    if (lose.length && isOnline(a)) personal(a >>> 0, `The holds will not keep a Hagraven among their citizens: your citizenship of ${lose.join(', ')} is gone.`);
  };
  const become = (a, how, by, stage) => {
    const st = Math.max(1, Math.min(3, Number(stage) || 1));
    const played = st >= 3 ? Number(C.stageHours[1]) * HOUR : st === 2 ? Number(C.stageHours[0]) * HOUR : 0;
    set(a, PROP, { since: Date.now(), played, stage: st, how, by: String(by || '') });
    applyStage(a, how);
  };
  const end = (a, why) => {
    const st = stageOf(a); if (!st) return false;
    leaveForm(a, 'pact ended');
    set(a, PROP, null);
    undoStage(a, st);
    audit(`HAGRAVEN ${who(a)} is a Hagraven no more (${why})`);
    return true;
  };

  // ---- the pact -----------------------------------------------------------------------------------------------------------
  const pactRefusal = (a) => {
    if (!C.enabled) return 'No coven answers.';
    if (stageOf(a)) return 'The pact is made, and cannot be made twice.';
    if (isStaff(a)) return 'Staff make no pact.';
    if (C.femaleOnly && !isFemale(a)) return 'The covens take only women into the pact.';
    const k = superKind(a); if (k) return k === 'vampire' ? 'The dead have no humanity left to trade. Be cured first.' : 'Hircine has marked you. Be cured first.';
    if (superState(a).disease) return 'A fever holds you. Be cured first.';
    if (call('__dboIsBriarheart', a >>> 0)) return 'A briar already beats in your chest. The Hagravens do not take one of their own works.';
    const race = raceEdid(a);
    if (!(C.races || []).some((r) => race === r || race === `${r}Vampire`)) return 'The pact is for the women of the Reach.';
    if (!(C.faiths || []).includes(faithId(a))) return 'The pact is made before the Old Gods of the Reach. Take them as your faith first.';
    if (!call('__dboBriarheartAltarNear', a >>> 0)) return 'The pact is made at a Hagraven altar.';
    for (const d of C.pactItems || []) if (!hasOne(a, idOf(d))) return 'The coven asks for a Hagraven Feather and a Hagraven Claw.';
    return '';
  };
  const pact = (a) => {
    const no = pactRefusal(a); if (no) return no;
    S.pending.set(a >>> 0, Date.now());
    audit(`HAGRAVEN ${who(a)} asked for the pact and was told its price`);
    return `You would trade your humanity for the witch's power. Your spells will burn hotter, and grow hotter still; the Divines will turn from you (Kynareth alone may still hear you). In time you will slow, the holds will strip you of your citizenship, and as a Hagraven you will be known on sight outside the Reach, hunted and bountied. Only Kyne can undo it. Say /hagraven confirm within ${C.confirmMinutes} minutes to give yourself to the coven.`;
  };
  const confirm = (a) => {
    const t0 = S.pending.get(a >>> 0); S.pending.delete(a >>> 0);
    if (!t0 || Date.now() - t0 > C.confirmMinutes * MIN) return 'There is nothing to confirm. Stand at the altar and say /hagraven pact.';
    const no = pactRefusal(a); if (no) return no;
    if (!takeEach(a, (C.pactItems || []).map(idOf))) return 'The coven asks for a Hagraven Feather and a Hagraven Claw.';
    become(a, 'pact', '', 1);
    audit(`HAGRAVEN ${who(a)} made the pact at a Hagraven altar (stage 1, Crone-touched)`);
    return 'The coven takes the feather and the claw, and something of you with them. The witchcraft wakes in your hands. You are Crone-touched.';
  };

  // ---- the cure: Kyne's alone ------------------------------------------------------------------------------------------------
  const cure = (a) => {
    if (!stageOf(a)) return 'You have made no pact.';
    const m = globalThis.__dboPrayerLastShrine; const v = m && m.get(a >>> 0);
    if (!v || Date.now() - v.at > 10 * MIN || !(C.cureDeities || []).includes(v.deityId)) return 'Only Kyne undoes the pact: touch a shrine of Kynareth, then say /hagraven cure.';
    if (!takeEach(a, [idOf(C.cureItem)])) return 'Kyne asks for a filled grand soul gem: a whole life offered for the one you gave away.';
    end(a, 'cleansed at a shrine of Kynareth');
    return 'Kyne\'s wind goes through you. The feathers fall, the claws soften, and your own breath comes back. You are a woman of the Reach again.';
  };

  // ---- time played, and the stages it brings ----------------------------------------------------------------------------------
  const advance = (a) => {
    const r = recOf(a); if (!r) return;
    r.played = (Number(r.played) || 0) + MIN;
    const was = Math.max(1, Number(r.stage) || 1); const now = Math.max(was, stageFor(r.played));
    r.stage = now; set(a, PROP, r);
    if (now > was) {
      audit(`HAGRAVEN ${who(a)} became ${NAMES[now]} (stage ${now}, ${Math.round(r.played / HOUR)} h played)`);
      personal(a >>> 0, now === 2 ? 'Feathers push through your skin. Your step grows heavy, and the holds have heard of you: their citizenship is no longer yours.'
        : 'The pact is complete. You are a Hagraven: the briar answers your hands, and outside the Reach every guard will know you on sight.');
      applyStage(a, `stage ${now}`);
    } else if (now >= 2) lapseCitizenship(a, 'daily');
  };
  // Stage 3 seen by enough witnesses in a hold that does not suffer Hagravens: exposure.js's form 'hagraven'
  const witnessed = (a) => {
    if (!C.knownOnSight || stageOf(a) < 3 || !fn('__dboBeastWitnessed')) return;
    const zid = zoneId(a); if (!zid || (C.knownOnSightExemptHolds || []).map(String).includes(zid)) return;
    const last = S.seenAt.get(a >>> 0) || 0; if (Date.now() - last < C.witnessEveryMinutes * MIN) return;
    const here = posOf(a); if (!here) return;
    const seers = onlineActors().filter((o) => (o >>> 0) !== (a >>> 0)).filter((o) => { const p = posOf(o); return p && p.world === here.world && dist(p.pos, here.pos) <= C.witnessRadius; });
    if (!seers.length) return;
    if (call('__dboBeastWitnessed', a >>> 0, 'hagraven', seers, 'seen')) { S.seenAt.set(a >>> 0, Date.now()); log(`hagraven: ${display(a)} seen as a Hagraven in ${zid} by ${seers.length}`); }
  };
  const tick = () => { if (!C.enabled) return; for (const a of onlineActors()) { if (!stageOf(a)) continue; try { advance(a); witnessed(a); } catch (e) { log('hagraven: tick failed', e.message); } } };
  if (typeof every === 'function') every('hagraven', MIN, tick);

  // ---- hooks for the other modules ---------------------------------------------------------------------------------------------
  globalThis.__dboHagravenStage = (a) => (C.enabled ? stageOf(Number(a) >>> 0) : 0);
  // gamemode.js onHitDamageAttempt, the attacker side: her Destruction hits
  globalThis.__dboHagravenAttackMult = (agg, src) => {
    const st = C.enabled ? stageOf(Number(agg) >>> 0) : 0; if (!st) return 1;
    let skills; try { skills = sourceSkillsOf(Number(src) >>> 0); } catch (e) { skills = null; }
    if (!skills || typeof skills.has !== 'function' || !(C.spellSkills || []).some((s) => skills.has(Number(s)))) return 1;
    return 1 + Math.max(0, at(C.spellBonus, st));
  };
  // racial.js regenFactor: magicka regeneration
  globalThis.__dboHagravenRegenMult = (a, stat) => { const st = C.enabled ? stageOf(Number(a) >>> 0) : 0; return st && stat === 'magicka' ? Math.max(1, at(C.magickaRegen, st) || 1) : 1; };
  // prayer.js grantBlessing: no Divine but the allowed (Kynareth)
  globalThis.__dboHagravenRefusesDeity = (a, d) => (C.enabled && stageOf(Number(a) >>> 0) && d && d.kind === 'divine' && !(C.allowedDeities || []).includes(d.id)
    ? `${d.name} turns from what you have become. The Divines do not bless a Hagraven's pact.` : '');
  // briarheart.js riteRefusal / confirm: a full Hagraven at the same altar is the one who performs the rite (0 when none)
  globalThis.__dboHagravenRiteAt = (altar, candidate) => {
    if (!C.enabled || !C.canRiteBriarhearts || !altar) return 0;
    const r = Number(altar.radius) || 400;
    return onlineActors().find((o) => (o >>> 0) !== (Number(candidate) >>> 0) && stageOf(o) >= 3 && !isStaff(o) && (() => { const p = posOf(o); return p && p.world === String(altar.world) && dist(p.pos, altar.pos) <= r; })()) || 0;
  };
  globalThis.__dboHagravenLogin = (a) => { if (C.enabled && stageOf(Number(a) >>> 0)) applyStage(Number(a) >>> 0, 'login'); };

  // ---- the body: the Hagraven creature, through beastform.js's polymorph ----------------------------------------------------------
  // Hers when beastform marked the shape by 'hagraven'; a beastform without that field: a Hagraven shape on a full Hagraven
  const inForm = (a) => {
    const s = get(a, 'private.beast', null);
    if (!s || typeof s !== 'object' || s.form !== 'hagraven' || !s.original) return false;
    return s.by === 'hagraven' || (s.by === undefined && stageOf(a) >= 3);
  };
  const cooldownLeft = (a) => Math.max(0, Math.ceil(((S.formAt.get(a >>> 0) || 0) + Number(C.form.cooldownSeconds || 0) * 1000 - Date.now()) / 1000));
  const formRefusal = (a) => {
    if (!C.enabled || C.form.enabled === false) return 'The Hagraven body does not answer yet.';
    if (stageOf(a) < 3) return 'Only a full Hagraven can take the Hagraven body.';
    if (!fn('__dboPolymorphAs')) return 'The Hagraven body is not available on this server yet.';
    const left = cooldownLeft(a); if (left) return `Your body has only just changed. Wait ${left} more second${left === 1 ? '' : 's'}.`;
    return '';
  };
  // '' when she took it, else why not (beastform's own sentence for its guards)
  const takeForm = (a) => {
    const no = formRefusal(a); if (no) return no;
    let why; try { why = globalThis.__dboPolymorphAs(a >>> 0, 'hagraven', { by: 'hagraven' }); } catch (e) { log('hagraven: __dboPolymorphAs failed', e.message); return 'That failed; see the server log.'; }
    if (why) return String(why);
    S.formAt.set(a >>> 0, Date.now());
    audit(`HAGRAVEN ${who(a)} took the Hagraven body`);
    S.seenAt.delete(a >>> 0); witnessed(a);
    return '';
  };
  const leaveForm = (a, why) => {
    if (!inForm(a)) return false;
    const ok = call('__dboBeastRevert', a >>> 0, why);
    if (!ok) return false;
    S.formAt.set(a >>> 0, Date.now());
    audit(`HAGRAVEN ${who(a)} left the Hagraven body (${why})`);
    // The race swap back may reset what the stage set on her (SpeedMult): put it back once the client has her own body again
    setTimeout(() => { try { if (stageOf(a) && isOnline(a) && !inForm(a)) applyStage(a, 'left the body'); } catch (e) { log('hagraven: stage after the body failed', e.message); } }, 2500);
    return true;
  };
  // What ends the body that beastform's polymorph tick does not: down, jail, bound or carried, the pact gone or her stage lowered
  const formBreak = (a) => {
    if (stageOf(a) < 3) return 'no longer a Hagraven';
    if (call('__dboIsDowned', a >>> 0)) return 'downed';
    const j = get(a, 'private.dboSentence', null); if (j && Number(j.totalMs) > (Number(j.servedMs) || 0)) return 'jailed';
    const r = get(a, 'private.restrained', null); if (r && (r.boundHands || r.carried || r.captorActorId)) return 'bound';
    return '';
  };
  const FORM_END_TELL = { downed: 'struck down, you fall back into your own body', jailed: 'the gaol takes you as you are, in your own body', bound: 'bound, you are pressed back into your own body', 'no longer a Hagraven': 'the pact no longer holds you whole' };
  const formTick = () => {
    for (const a of onlineActors()) {
      if (!inForm(a)) continue;
      const why = formBreak(a); if (!why) continue;
      if (leaveForm(a, why) && FORM_END_TELL[why]) personal(a >>> 0, `You are yourself again: ${FORM_END_TELL[why]}.`);
    }
  };
  if (typeof every === 'function') every('hagraven-form', 5000, () => { try { formTick(); } catch (e) { log('hagraven: form tick failed', e.message); } });
  const form = (a) => {
    if (inForm(a)) return leaveForm(a, 'asked to revert') ? 'You let the body go and stand as yourself again, your spells back in your hands.' : 'That failed; see the server log.';
    const no = takeForm(a); if (no) return no;
    return 'You let the pact take you whole: the hunched body, the feathers, the talons. It casts nothing; say /hagraven form again to stand as yourself and cast.';
  };

  // ---- chat ---------------------------------------------------------------------------------------------------------------------
  const target = (q) => { const id = typeof findByName === 'function' ? findByName(String(q || '').trim()) : 0; return id > 0 ? id >>> 0 : 0; };
  // The longest leading run of words that names an online character; the rest after it
  const splitTarget = (words) => { for (let k = words.length; k >= 1; k--) { const t = target(words.slice(0, k).join(' ')); if (t) return { t, rest: words.slice(k) }; } return { t: 0, rest: words }; };
  registerChatCommand('hagraven', (a, args) => {
    const words = String(args || '').trim().split(/\s+/).filter(Boolean);
    const sub = (words.shift() || 'status').toLowerCase();
    if (sub === 'status') {
      const r = recOf(a); if (!r) return personal(a, 'You have made no pact.');
      const st = stageOf(a); const next = st < 3 ? Number(C.stageHours[st - 1]) - (Number(r.played) || 0) / HOUR : 0;
      return personal(a, `You are ${NAMES[st]} (stage ${st} of 3), ${Math.round((Number(r.played) || 0) / HOUR)} hours since the pact.${st < 3 ? ` The pact deepens in about ${Math.max(0, Math.ceil(next))} more hours of play.` : ''}`);
    }
    if (sub === 'pact') return personal(a, pact(a));
    if (sub === 'confirm') return personal(a, confirm(a));
    if (sub === 'form') return personal(a, form(a));
    if (sub === 'cure') return personal(a, cure(a));
    if (!isLeadStaff(a)) return personal(a, 'Usage: /hagraven [status] | pact | confirm | form | cure');
    if (sub === 'list') { const on = onlineActors().filter((x) => stageOf(x)); return personal(a, on.length ? on.map((x) => `${display(x)} (${NAMES[stageOf(x)]})`).join(', ') : 'No Hagraven is online.'); }
    if (sub === 'grant' || sub === 'revoke' || sub === 'stage') {
      const { t, rest } = splitTarget(words);
      if (!t) return personal(a, `Usage: /hagraven ${sub} <name online>${sub === 'stage' ? ' <1-3>' : ''} <reason>`);
      let st = 0; if (sub === 'stage') { st = Number(rest.shift()); if (!(st >= 1 && st <= 3)) return personal(a, 'Usage: /hagraven stage <name online> <1-3> <reason>'); }
      const why = rest.join(' ').trim(); if (!why) return personal(a, 'Give a reason; it goes in the audit.');
      if (sub === 'grant') {
        if (stageOf(t)) return personal(a, `${display(t)} has made the pact already.`);
        if (superKind(t) || call('__dboIsBriarheart', t)) return personal(a, `${display(t)} is ${superKind(t) || 'a Briarheart'}; cure that first.`);
        become(t, 'staff', who(a), 1); audit(`HAGRAVEN ${who(a)} made ${who(t)} Crone-touched: ${why}`);
        if (isOnline(t)) personal(t, 'The witchcraft wakes in your hands. You are Crone-touched.');
        return personal(a, `${display(t)} is Crone-touched.`);
      }
      if (sub === 'stage') {
        if (!stageOf(t)) return personal(a, `${display(t)} has made no pact.`);
        const r = recOf(t); r.stage = st; r.played = st >= 3 ? Number(C.stageHours[1]) * HOUR : st === 2 ? Number(C.stageHours[0]) * HOUR : 0; set(t, PROP, r);
        if (st < 3) leaveForm(t, 'no longer a Hagraven');
        undoStage(t, 3); applyStage(t, `staff stage ${st}`);
        audit(`HAGRAVEN ${who(a)} set ${who(t)} to stage ${st} (${NAMES[st]}): ${why}`);
        return personal(a, `${display(t)} is ${NAMES[st]}.`);
      }
      if (!end(t, `revoked by ${who(a)}: ${why}`)) return personal(a, `${display(t)} has made no pact.`);
      if (isOnline(t)) personal(t, 'The pact is broken. You are a woman of the Reach again.');
      return personal(a, `${display(t)} is a Hagraven no more.`);
    }
    return personal(a, 'Usage: /hagraven [status] | pact | confirm | form | cure; staff: grant|revoke <name> <reason> | stage <name> <1-3> <reason> | list');
  }, { help: 'the Hagraven pact: [status] | pact (at a Hagraven altar) | confirm | form (a Hagraven: the body, and back) | cure (at Kynareth); staff: grant | revoke | stage | list' });

  log(`hagraven: ${C.enabled ? 'on' : 'off'}, stages at ${(C.stageHours || []).join('/')} h, exempt from known-on-sight: ${(C.knownOnSightExemptHolds || []).join(', ') || 'none'}; the body ${C.form.enabled === false ? 'off' : `on (${C.form.cooldownSeconds} s between changes, polymorph hook ${fn('__dboPolymorphAs') ? 'present' : 'absent'})`}`);
  return { pactRefusal, pact, confirm, cure, tick, advance, witnessed, become, end, stageOf, form, takeForm, leaveForm, inForm, formTick, formBreak, C };
};
