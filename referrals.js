// DragonBreak Online: referral links (Nate, 16 Oct 2026: "Go for it"; config "referrals"; spec docs/referrals.md).
// Loaded by gamemode.js on every hot reload.
//
// Every account (profile) gets a code and a link, <linkBase><code>. The backend (fork skymp5-backend routes/referrals.js)
// writes one line to its data/referrals.jsonl when a Discord login that came through a link creates a brand-new account;
// this module reads that file, and /referral <code> is the fallback for a player in their first 24 hours of play.
// A referral qualifies once the new account has played qualifyHours on qualifyDays different UTC days and its Discord
// account was accountAgeDays old when it was referred. Then the referrer earns a boost: x firstMult and the carry weight
// ability for the first, x laterMult for each later one. The new player gets x welcomeMult as soon as the referral is
// recorded. Every boost lasts boostHours of PLAY (only while a character of the account is in the world); they queue,
// one at a time, at most queueCap waiting. A boost runs through skillrates.js (__dboReferralSkillRate), so it never
// touches private.xpBoost: while a playtester or staff xpBoost runs on the character, the referral boost waits behind it.
// The carry weight is a constant-effect ability (carrySpell, '<local id>:<plugin>'), given once a session on every
// character of the account; empty until the DLE record exists, so nothing is promised before.
// Records live in referrals.json (runtime, gitignored). Every change is an audit REFERRAL line.
//   /referral                      your link, your friends and your boosts
//   /referral <code>               enter a friend's code (once, in your first 24 hours of play)
//   /referral profile <id>         an account's referrals (staff)
//   /referral revoke <id> [why]    take back the referral of the new account <id> and its rewards (Lead GM and above)
'use strict';

module.exports = (api) => {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { mp, log, personal, system, registerChatCommand, audit, who, display, profileOf, discordOf, isAdmin, isLeadStaff, findAnyByName, onlineActors, every, creationPending, cfg } = api;

  const HOUR = 3600000, DAY = 24 * HOUR;
  const raw = (cfg && cfg.referrals) || {};
  const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const mult = (v, d) => (Number(v) > 1 && Number(v) <= 3 ? Number(v) : d);
  const C = {
    enabled: raw.enabled === true,
    linkBase: String(raw.linkBase || 'https://dragonbreakonline.com/api/join/'),
    bindingsFile: String(raw.bindingsFile || '/opt/alduinak/skymp5-backend/data/referrals.jsonl'),
    qualifyHours: pos(raw.qualifyHours, 5),
    qualifyDays: Number.isInteger(raw.qualifyDays) && raw.qualifyDays >= 1 ? raw.qualifyDays : 2,
    accountAgeDays: Number(raw.accountAgeDays) >= 0 ? Number(raw.accountAgeDays) : 30,
    firstMult: mult(raw.firstMult, 1.15),
    laterMult: mult(raw.laterMult, 1.05),
    welcomeMult: mult(raw.welcomeMult, 1.05),
    boostHours: pos(raw.boostHours, 8),
    queueCap: Number.isInteger(raw.queueCap) && raw.queueCap >= 1 ? raw.queueCap : 10,
    commandWindowHours: pos(raw.commandWindowHours, 24),
    carrySpell: String(raw.carrySpell || ''),
    sampleSeconds: Number(raw.sampleSeconds) >= 5 ? Number(raw.sampleSeconds) : 30,
    flushSeconds: Number(raw.flushSeconds) >= 10 ? Number(raw.flushSeconds) : 120,
    readSeconds: Number(raw.readSeconds) >= 5 ? Number(raw.readSeconds) : 60,
  };
  const STORE_PATH = path.resolve('referrals.json');
  const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
  const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/;
  const CARRY = 'private.dboReferralCarry';
  const XP_BOOST = 'private.xpBoost';

  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
  const old = globalThis.__dboReferrals;
  const S = old && old.v === 1 ? old : (globalThis.__dboReferrals = { v: 1, store: null, last: new Map(), carryOn: new Set(), dirty: false, writing: false, reading: false });
  if (!S.store) {
    const s = readJson(STORE_PATH);
    S.store = s && typeof s === 'object' && s.profiles && typeof s.profiles === 'object' ? s : { profiles: {}, codes: {}, offset: 0 };
    if (!S.store.codes || typeof S.store.codes !== 'object') S.store.codes = {};
  }
  const store = S.store;

  const flush = () => {
    if (!S.dirty || S.writing) return;
    S.dirty = false; S.writing = true;
    const body = JSON.stringify(store);
    fs.promises.writeFile(STORE_PATH + '.tmp', body)
      .then(() => fs.promises.rename(STORE_PATH + '.tmp', STORE_PATH))
      .catch((e) => { S.dirty = true; log('referrals.json write failed', e.message); })
      .finally(() => { S.writing = false; });
  };
  const touch = () => { S.dirty = true; };
  const validPid = (p) => Number.isInteger(p) && p >= 0;
  const recOf = (pid, make) => {
    const k = String(pid);
    let r = store.profiles[k];
    if (!r && make) r = store.profiles[k] = { ms: 0 };
    if (r && !Array.isArray(r.queue)) r.queue = [];
    return r || null;
  };
  const hm = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)} h ${m % 60} m`; };
  const pct = (m) => `+${Math.round((m - 1) * 100)}%`;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const accountCreatedAt = (discordId) => {
    try { const id = BigInt(String(discordId)); return id > 0n ? Number((id >> 22n) + 1420070400000n) : 0; } catch (e) { return 0; }
  };

  // Go-live: every account the play-time records (playtime.js) already know, and the highest profile id among them, were
  // seen before referrals existed; the fallback command never takes them
  if (!store.liveAt) {
    const known = new Set();
    const pt = globalThis.__dboPlaytime && globalThis.__dboPlaytime.store ? globalThis.__dboPlaytime.store : readJson(path.resolve('playtime-slots.json'));
    for (const k of Object.keys((pt && pt.profiles) || {})) if (/^\d+$/.test(k)) known.add(Number(k));
    store.liveAt = Date.now();
    store.preexisting = [...known].sort((a, b) => a - b);
    store.maxPidAtLive = known.size ? Math.max(...known) : -1;
    touch();
    log(`referrals: went live with ${known.size} account(s) already known, highest profile ${store.maxPidAtLive}`);
  }
  const preexisting = new Set(store.preexisting || []);
  const seenBefore = (pid, at) => {
    if (preexisting.has(pid)) return true;
    const r = recOf(pid, false);
    return !!(r && r.firstSeenAt && r.firstSeenAt < at - 60000);
  };

  // ---- codes ---------------------------------------------------------------------------------------------------------
  const codeOf = (pid) => {
    const r = recOf(pid, true);
    if (r.code && store.codes[r.code] === pid) return r.code;
    for (let i = 0; i < 20; i++) {
      const b = crypto.randomBytes(8);
      const c = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
      if (store.codes[c] !== undefined) continue;
      store.codes[c] = pid; r.code = c; touch();
      return c;
    }
    return '';
  };
  const linkOf = (pid) => { const c = codeOf(pid); return c ? `${C.linkBase}${c}` : ''; };

  // ---- the referral --------------------------------------------------------------------------------------------------
  const friendsOf = (pid) => Object.entries(store.profiles).filter(([, r]) => r && r.ref && r.ref.by === pid).map(([k, r]) => ({ pid: Number(k), r }));
  const countedOf = (pid) => friendsOf(pid).filter((f) => f.r.ref.status === 'qualified');
  const hasCarry = (pid) => countedOf(pid).length > 0;
  const tellLater = (pid, text) => { const r = recOf(pid, true); (r.notes = r.notes || []).push(text); if (r.notes.length > 10) r.notes.shift(); touch(); };
  const queueBoost = (pid, b) => {
    const r = recOf(pid, true);
    if (r.queue.length >= C.queueCap) { r.dropped = (r.dropped || 0) + 1; touch(); audit(`REFERRAL profile ${pid} boost ${pct(b.mult)} (${b.kind}) not queued: ${C.queueCap} already waiting`); return false; }
    r.queue.push(Object.assign({ id: crypto.randomBytes(4).toString('hex'), leftMs: C.boostHours * HOUR }, b));
    touch();
    return true;
  };

  // A binding from the backend or the command: refused, or recorded with the welcome boost
  const bind = ({ referee, code, at, via, accountAt, fresh }) => {
    const c = String(code || '').toUpperCase();
    const by = store.codes[c];
    const tag = `REFERRAL profile ${referee} code ${c || '?'} (${via})`;
    if (!validPid(referee)) return { ok: false, why: 'no account' };
    const r = recOf(referee, true);
    if (r.ref) { audit(`${tag} ignored: already referred by profile ${r.ref.by}`); return { ok: false, why: 'already' }; }
    if (by === undefined) { audit(`${tag} ignored: unknown code`); return { ok: false, why: 'unknown' }; }
    if (by === referee) { audit(`${tag} refused: own code`); return { ok: false, why: 'self' }; }
    if (!fresh && seenBefore(referee, at)) { audit(`${tag} refused: account seen before the referral`); return { ok: false, why: 'seen' }; }
    const age = !(accountAt > 0) ? 'unknown' : at - accountAt >= C.accountAgeDays * DAY ? '' : 'young';
    r.ref = { by, code: c, at, via, accountAt: accountAt || 0, status: age ? 'ineligible' : 'pending' };
    if (age) r.ref.reason = age === 'young' ? `Discord account under ${C.accountAgeDays} days old` : 'Discord account age unknown';
    if (!r.days) r.days = [];
    queueBoost(referee, { mult: C.welcomeMult, kind: 'welcome', from: by });
    r.welcomeTold = false;
    touch();
    audit(`${tag} recorded: referred by profile ${by}${age ? `, cannot count (${r.ref.reason})` : ''}; welcome ${pct(C.welcomeMult)} for ${C.boostHours} h of play`);
    return { ok: true, by, ineligible: !!age };
  };

  const qualify = (pid, r, now) => {
    r.ref.status = 'qualified'; r.ref.qualifiedAt = now;
    const by = r.ref.by;
    const first = countedOf(by).filter((f) => f.pid !== pid).length === 0;
    const m = first ? C.firstMult : C.laterMult;
    const queued = queueBoost(by, { mult: m, kind: first ? 'first' : 'later', from: pid });
    if (first) recOf(by, true).carryFrom = pid;
    touch();
    audit(`REFERRAL profile ${pid} qualified for profile ${by} (${hm(r.ms)} on ${r.days.length} days): ${first ? 'first' : 'later'} boost ${pct(m)}${queued ? '' : ' (queue full)'}${first ? ', carry weight' : ''}`);
    tellLater(by, `A friend you invited has now played ${C.qualifyHours} hours and counts as your referral. ${queued ? `You earned ${pct(m)} skill progress for ${C.boostHours} hours of play` : 'Your boost queue was full, so no boost was added'}${first ? `, and +100 carry weight for good${C.carrySpell ? '' : ' (it arrives with a coming update)'}` : ''}. Type /referral to see it.`);
  };

  // Staff: the referral of the new account `pid` and everything it gave
  const revoke = (pid, why, by) => {
    const r = recOf(pid, false);
    if (!r || !r.ref) return null;
    if (r.ref.status === 'revoked') return 'already';
    const was = r.ref.status, ref = r.ref.by;
    r.ref.status = 'revoked'; r.ref.revokedAt = Date.now(); r.ref.reason = String(why || '').slice(0, 200);
    r.queue = r.queue.filter((b) => b.kind !== 'welcome');
    const rr = recOf(ref, false);
    if (rr) rr.queue = rr.queue.filter((b) => b.from !== pid);
    if (rr && rr.carryFrom === pid) { const next = countedOf(ref)[0]; rr.carryFrom = next ? next.pid : undefined; }
    touch();
    audit(`REFERRAL profile ${pid} (referred by profile ${ref}, was ${was}) revoked by ${by}${why ? `: ${why}` : ''}; its boosts taken back${hasCarry(ref) ? '' : ', carry weight taken back'}`);
    return was;
  };

  // ---- the backend's bindings ------------------------------------------------------------------------------------------
  const readBindings = async () => {
    if (S.reading || !C.enabled) return 0;
    S.reading = true;
    try {
      let st; try { st = await fs.promises.stat(C.bindingsFile); } catch (e) { return 0; }
      if (st.size < (store.offset || 0)) { log('referrals: the bindings file shrank; reading it again from the start'); store.offset = 0; }
      if (st.size === (store.offset || 0)) return 0;
      const fh = await fs.promises.open(C.bindingsFile, 'r');
      let text = '';
      try {
        const len = Math.min(st.size - store.offset, 4 * 1024 * 1024);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, store.offset);
        text = buf.toString('utf8');
      } finally { await fh.close(); }
      const end = text.lastIndexOf('\n');
      if (end < 0) return 0;
      store.offset += Buffer.byteLength(text.slice(0, end + 1));
      touch();
      let n = 0;
      for (const line of text.slice(0, end).split('\n')) {
        let b = null; try { b = JSON.parse(line); } catch (e) { continue; }
        if (!b || b.kind !== 'bind' || !CODE_RE.test(String(b.code || '')) || !validPid(Number(b.profileId))) continue;
        bind({ referee: Number(b.profileId), code: b.code, at: Number(b.at) || Date.now(), via: b.via === 'visit' ? 'link-visit' : 'link', accountAt: Number(b.accountCreatedAt) || 0 });
        n++;
      }
      flush();
      return n;
    } catch (e) { log('referrals: reading the bindings failed', e.message); return 0; } finally { S.reading = false; }
  };

  // ---- boosts ------------------------------------------------------------------------------------------------------
  // A playtester or staff boost on the character: the referral boost waits behind it
  const behind = (a) => {
    try { const b = mp.get(a, XP_BOOST); return !!(b && Number(b.mult) > 1 && Number(b.until) > Date.now()); } catch (e) { return false; }
  };
  const runningOf = (a) => {
    if (!C.enabled) return null;
    const pid = profileOf(a);
    const r = validPid(pid) ? store.profiles[String(pid)] : null;
    const b = r && Array.isArray(r.queue) ? r.queue[0] : null;
    return b && b.leftMs > 0 && !behind(a) ? b : null;
  };
  globalThis.__dboReferralSkillRate = (actorId) => { const b = runningOf(actorId >>> 0); return b ? b.mult : 1; };

  const kindText = (b) => (b.kind === 'welcome' ? 'welcome' : 'referral');
  const startNote = (a, b) => personal(a, `Your ${kindText(b)} boost is running: ${pct(b.mult)} skill progress for ${hm(b.leftMs)} of play.`);
  const consume = (a, r, ms) => {
    let left = ms;
    while (left > 0 && r.queue.length) {
      const b = r.queue[0];
      const use = Math.min(left, b.leftMs);
      b.leftMs -= use; left -= use;
      if (b.leftMs > 0) break;
      r.queue.shift();
      audit(`REFERRAL ${who(a)} ${kindText(b)} boost ${pct(b.mult)} ran out`);
      personal(a, `Your ${kindText(b)} boost (${pct(b.mult)}) has run out.`);
      if (r.queue.length) startNote(a, r.queue[0]);
    }
    touch();
  };

  // ---- carry weight ---------------------------------------------------------------------------------------------------
  const carryId = () => {
    if (!C.carrySpell) return 0;
    try { const id = mp.getIdFromDesc(C.carrySpell) >>> 0; const r = id ? mp.lookupEspmRecordById(id) : null; return r && r.record && String(r.record.type) === 'SPEL' ? id : 0; } catch (e) { return 0; }
  };
  const papyrusSpell = (a, add, id) => {
    try {
      mp.callPapyrusFunction('method', 'Actor', add ? 'AddSpell' : 'RemoveSpell', { type: 'form', desc: mp.getDescFromId(a >>> 0) },
        add ? [{ type: 'espm', desc: mp.getDescFromId(id >>> 0) }, false] : [{ type: 'espm', desc: mp.getDescFromId(id >>> 0) }]);
      return true;
    } catch (e) { log(`referrals: ${add ? 'AddSpell' : 'RemoveSpell'} ${id.toString(16)} on ${display(a >>> 0)} failed`, e.message); return false; }
  };
  const carryTick = (a, pid) => {
    let held = ''; try { held = String(mp.get(a, CARRY) || ''); } catch (e) { held = ''; }
    const want = C.enabled && hasCarry(pid) ? carryId() : 0;
    if (want) {
      if (S.carryOn.has(a)) return;
      if (papyrusSpell(a, true, want)) { S.carryOn.add(a); try { mp.set(a, CARRY, mp.getDescFromId(want)); } catch (e) { /* given anyway */ } if (!held) audit(`REFERRAL ${who(a)} given the carry weight ability`); }
    } else if (held && (!C.enabled || !hasCarry(pid))) {
      const id = (() => { try { return mp.getIdFromDesc(held) >>> 0; } catch (e) { return 0; } })();
      if (!id || papyrusSpell(a, false, id)) { S.carryOn.delete(a); try { mp.set(a, CARRY, null); } catch (e) { /* tried */ } audit(`REFERRAL ${who(a)} carry weight ability taken back`); }
    }
  };

  // ---- the tick ------------------------------------------------------------------------------------------------------
  const tick = () => {
    if (!C.enabled) return;
    const now = Date.now(), cap = C.sampleSeconds * 2000;
    const here = new Set(), seen = new Set();
    for (const x of onlineActors()) {
      const a = Number(x) >>> 0; here.add(a);
      const pid = profileOf(a);
      if (!validPid(pid) || seen.has(pid)) continue;
      seen.add(pid);
      if (typeof creationPending === 'function' && creationPending(a)) { S.last.delete(pid); continue; }
      const r = recOf(pid, true);
      if (!r.firstSeenAt) { r.firstSeenAt = now; touch(); }
      codeOf(pid);
      const prev = S.last.get(pid);
      S.last.set(pid, now);
      const d = prev !== undefined ? Math.max(0, Math.min(now - prev, cap)) : 0;
      if (d > 0 && !preexisting.has(pid) && (r.ms < C.commandWindowHours * HOUR || (r.ref && r.ref.status === 'pending'))) { r.ms += d; touch(); }
      if (r.ref && r.ref.status === 'pending' && d > 0) {
        const today = day(now);
        if (!r.days.includes(today)) { r.days.push(today); if (r.days.length > 10) r.days.shift(); touch(); }
        if (r.ms >= C.qualifyHours * HOUR && r.days.length >= C.qualifyDays) qualify(pid, r, now);
      }
      if (r.queue.length && !behind(a)) {
        if (r.queue[0].kind === 'welcome' && r.welcomeTold === false) { r.welcomeTold = true; touch(); system(a, `Welcome to DragonBreak Online! A friend invited you, so your skills rise ${pct(r.queue[0].mult)} faster for your first ${C.boostHours} hours of play.`); }
        if (d > 0) consume(a, r, d);
      }
      if (Array.isArray(r.notes) && r.notes.length) { for (const t of r.notes.splice(0)) system(a, t); touch(); }
      carryTick(a, pid);
    }
    for (const pid of [...S.last.keys()]) if (!seen.has(pid)) S.last.delete(pid);
    for (const a of [...S.carryOn]) if (!here.has(a)) S.carryOn.delete(a);
  };

  // ---- what the player sees ---------------------------------------------------------------------------------------------
  const friendLine = (f, i) => {
    const s = f.r.ref.status;
    if (s === 'qualified') return { n: i + 1, status: 'counted', text: `Friend ${i + 1}: counted` };
    if (s === 'pending') return { n: i + 1, status: 'playing', text: `Friend ${i + 1}: ${hm(Math.min(f.r.ms, C.qualifyHours * HOUR))} of ${C.qualifyHours} h, ${Math.min(f.r.days.length, C.qualifyDays)} of ${C.qualifyDays} days` };
    if (s === 'revoked') return { n: i + 1, status: 'revoked', text: `Friend ${i + 1}: taken back by staff` };
    return { n: i + 1, status: 'ineligible', text: `Friend ${i + 1}: cannot count (${f.r.ref.reason || 'not eligible'})` };
  };
  const view = (a) => {
    const pid = profileOf(a);
    if (!C.enabled || !validPid(pid)) return null;
    const r = recOf(pid, true);
    const friends = friendsOf(pid).sort((x, y) => x.r.ref.at - y.r.ref.at).map(friendLine);
    const run = runningOf(a);
    return {
      link: linkOf(pid), code: codeOf(pid),
      counted: friends.filter((f) => f.status === 'counted').length, friends,
      queue: r.queue.map((b, i) => ({ kind: b.kind, mult: b.mult, leftMs: b.leftMs, running: i === 0 && !!run })),
      waitingBehind: !!(r.queue.length && behind(a)),
      carry: hasCarry(pid), carryLive: hasCarry(pid) && !!carryId(),
      canEnter: canEnter(a, pid) === '', referredBy: r.ref ? r.ref.status : null,
      rules: { qualifyHours: C.qualifyHours, qualifyDays: C.qualifyDays, boostHours: C.boostHours, firstMult: C.firstMult, laterMult: C.laterMult, welcomeMult: C.welcomeMult, queueCap: C.queueCap },
    };
  };
  const describe = (a) => {
    const v = view(a);
    if (!v) return 'Referrals are not open yet.';
    const lines = [`Your referral link: ${v.link} (code ${v.code}). A friend who joins with it and plays ${C.qualifyHours} hours on ${C.qualifyDays} different days counts.`];
    lines.push(v.friends.length ? `Friends: ${v.friends.map((f) => f.text).join('; ')}.` : 'No friends have joined with your link yet.');
    if (v.queue.length) lines.push(`Boosts: ${v.queue.map((b) => `${pct(b.mult)} ${hm(b.leftMs)}${b.running ? ' (running)' : ''}`).join(', ')}${v.waitingBehind ? ', waiting behind your other skill boost' : ''}.`);
    if (v.carry) lines.push(v.carryLive ? 'Carry weight: +100, yours for good.' : 'Carry weight: +100 earned; it arrives with a coming update.');
    return lines.join(' ');
  };

  // '' when this player may still enter a code, else why not
  const canEnter = (a, pid) => {
    const r = recOf(pid, false);
    if (r && r.ref) return 'You have already been referred.';
    if (preexisting.has(pid) || !(pid > (store.maxPidAtLive === undefined ? -1 : store.maxPidAtLive))) return 'Referral codes are for accounts made after referrals opened.';
    if (r && r.ms >= C.commandWindowHours * HOUR) return `A code can be entered only in your first ${C.commandWindowHours} hours of play.`;
    return '';
  };
  const enterCode = (a, code) => {
    const pid = profileOf(a);
    if (!validPid(pid)) return 'Your account cannot take a referral.';
    const why = canEnter(a, pid);
    if (why) return why;
    const c = String(code).trim().toUpperCase();
    if (!CODE_RE.test(c) || store.codes[c] === undefined) return 'That is not a referral code.';
    const accountAt = typeof discordOf === 'function' ? accountCreatedAt(discordOf(a)) : 0;
    const res = bind({ referee: pid, code: c, at: Date.now(), via: 'command', accountAt, fresh: true });
    flush();
    if (!res.ok) return res.why === 'self' ? 'That is your own code.' : res.why === 'seen' ? 'Referral codes are for new accounts.' : 'That code could not be used.';
    return `Thank you! Your friend will be credited once you have played ${C.qualifyHours} hours on ${C.qualifyDays} different days.${res.ineligible ? ' (Your Discord account is too new for it to count for them.)' : ''}`;
  };

  registerChatCommand('referral', (a, args) => {
    const body = String(args || '').trim();
    if (!C.enabled) return personal(a, 'Referrals are not open yet.');
    if (!body) return personal(a, describe(a));
    const m = /^(profile|revoke)\s+(\d+)\s*(.*)$/i.exec(body);
    if (m) {
      const pid = Number(m[2]);
      if (m[1].toLowerCase() === 'profile') {
        if (!isAdmin(a)) return personal(a, 'That is for staff.');
        const r = recOf(pid, false);
        if (!r) return personal(a, `Profile ${pid} has no referral record.`);
        const fr = friendsOf(pid).map((f) => `${f.pid}:${f.r.ref.status}`).join(', ') || 'none';
        return personal(a, `Profile ${pid}: code ${r.code || '-'}; ${r.ref ? `referred by ${r.ref.by} (${r.ref.via}, ${r.ref.status}${r.ref.reason ? `, ${r.ref.reason}` : ''})` : 'not referred'}; played ${hm(r.ms)}${r.days && r.days.length ? ` on ${r.days.length} day(s)` : ''}; friends ${fr}; queue ${r.queue.map((b) => `${pct(b.mult)} ${hm(b.leftMs)}`).join(', ') || 'empty'}${hasCarry(pid) ? '; carry weight' : ''}.`);
      }
      if (!isLeadStaff(a)) return personal(a, 'That is for a Lead GM and above.');
      const was = revoke(pid, m[3], who(a));
      flush();
      if (was === null) return personal(a, `Profile ${pid} was not referred.`);
      if (was === 'already') return personal(a, `Profile ${pid}'s referral was already revoked.`);
      return personal(a, `Profile ${pid}'s referral (was ${was}) is revoked, and its boosts are taken back.`);
    }
    if (/^[a-z0-9]{8}$/i.test(body)) return personal(a, enterCode(a, body));
    if (isAdmin(a)) {
      const t = findAnyByName(body);
      if (t > 0) return personal(a, `${display(t)}: profile ${profileOf(t)}. Type /referral profile ${profileOf(t)}.`);
    }
    personal(a, 'Type /referral for your link, or /referral <code> to enter a friend\'s code.');
  }, { help: 'your referral link, your invited friends and your boosts' });

  // The Character Journal: a Referrals tab for a front that can draw it (journalTab:referrals); the status line meanwhile
  const sections = globalThis.__dboJournalSections && typeof globalThis.__dboJournalSections === 'object' ? globalThis.__dboJournalSections : (globalThis.__dboJournalSections = {});
  sections.referrals = { visible: () => C.enabled, view: (a) => view(a), label: () => 'Referrals' };
  const addStatus = (key, order, fn) => { try { if (typeof globalThis.__dboRegisterStatus === 'function') globalThis.__dboRegisterStatus(key, order, fn); } catch (e) { /* gamemode older than /status */ } };
  addStatus('referral', 62, (a) => {
    const pid = profileOf(a);
    if (!C.enabled || !validPid(pid)) return null;
    const b = runningOf(a);
    return `Referral link: ${linkOf(pid)}${b ? `; ${kindText(b)} boost ${pct(b.mult)}, ${hm(b.leftMs)} of play left` : ''}`;
  });

  every('referrals', C.sampleSeconds * 1000, tick);
  every('referralsRead', C.readSeconds * 1000, () => { readBindings(); });
  every('referralsFlush', C.flushSeconds * 1000, flush);
  flush();

  const all = Object.values(store.profiles);
  log(`referrals ${C.enabled ? 'on' : 'off'}: ${Object.keys(store.codes).length} code(s), ${all.filter((r) => r && r.ref).length} referred, ${all.filter((r) => r && r.ref && r.ref.status === 'qualified').length} counted; carry weight ${carryId() ? 'live' : 'waiting for its record'}`);
  return { tick, readBindings, bind, revoke, view, enterCode, codeOf, flush, runningOf, C };
};
