// DragonBreak Online: the player log's rules (playerlog.js). Pure data and functions, no mp, so the harnesses can test
// them alone. Required by playerlog.js after its require.cache entry is deleted, so a deploy never keeps old rules.
//
// What is in here:
//   EVENT_TYPES   every event type: priority, the place it carries, its switch default and the fields it may hold. The
//                 schema is an allow-list: validate() keeps only the keys listed for the type, each cut to its kind, and
//                 counts what it dropped (key names only, which come from code). No type has a text, message, note,
//                 reason or args field; the one text-like field is act.text, for audit verbs reviewed as clean.
//   clean()       every string: control characters and line breaks out, IP addresses, URLs, e-mails and mentions
//                 replaced, cut to its kind's length.
//   AUDIT_VERBS   the audit line registry (clean, parsed or excluded) and their parsers; AUDIT_SITES pins every audit(
//                 call site to a reviewed class (tests/playerlog-audit-harness.js fails on a new or changed one).
//   COMMAND_SCHEMA, CHAT_VERBS, PACKET_TYPES, CONSOLE_VERBS, REFUSAL_RX: what the command wrapper and the packet tap keep.
// Never chat (Jake, 13 Oct: "Dont cover chat"): no hook sits on a chat path, CHAT_VERBS is refused as a belt, and no
// field can hold what a player wrote.
'use strict';

const VERSION = 1;

// ---- clean(): every string that reaches the disk ----------------------------------------------------------------------
// Control characters and line breaks become a space; the invisible format characters are taken out, so one placed inside an
// address or an @everyone cannot split it past the patterns below (review P-R7: the soft hyphen, the Hangul fillers, the word
// joiners, the variation selectors and the tag block U+E0000-E007F, a surrogate pair here since these patterns have no u flag)
const RX_CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const RX_INVIS = /(?:[\u00ad\u034f\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufe00-\ufe0f\ufeff\uffa0]|\udb40[\udc00-\udc7f])+/g;
const RX_IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
// IPv6: a run of hex groups with "::" or with three colons or more (a time "14:30:05" has two, a desc "a764b:X.esm" one)
const RX_V6 = /(?<![0-9a-z:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:(?<=:)\d{1,3}(?:\.\d{1,3}){3})?(?![0-9a-z:])/gi;
const RX_URL = /\b(?:[a-z][a-z0-9+.-]{1,9}:\/\/|www\.)[^\s<>"]*|\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.(?:com|net|org|gg|io|ru|de|uk|xyz|me|tv|co|app|dev|info|link|site|online|ly|be|to|cc|us|eu|fr|nl|pl|br)\b(?:\/[^\s<>"]*)?/gi;
const RX_MAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+/gi;
const RX_MENTION = /<(?:@[!&]?|#|a?:\w{1,32}:)\d{0,22}>/g;
const RX_EVERYONE = /@(everyone|here)\b/gi;
// The forwarder's token shapes (scrub.py TOKEN and LONGHEX): a bot token, and a run of 32 hex digits or more
const RX_TOKEN = /[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}|mfa\.[A-Za-z0-9_-]{60,}/g;
const RX_LONGHEX = /\b[0-9a-f]{32,}\b/gi;
const clean = (v, max) => {
  if (v === undefined || v === null) return '';
  let s = typeof v === 'string' ? v : String(v);
  if (s.length > 4096) s = s.slice(0, 4096);
  s = s.replace(RX_INVIS, '')
    .replace(RX_CTRL, ' ')
    .replace(RX_TOKEN, '[token]')
    .replace(RX_MAIL, '[email]')
    .replace(RX_URL, '[link]')
    .replace(RX_IPV4, '[ip]')
    .replace(RX_LONGHEX, '[token]')
    .replace(RX_V6, (m) => ((m.match(/:/g) || []).length >= 3 || m.includes('::') ? '[ip]' : m))
    .replace(RX_MENTION, '[mention]')
    .replace(RX_EVERYONE, '@ $1')
    .replace(/ {2,}/g, ' ')
    .trim();
  const n = Number(max) > 0 ? Number(max) : 64;
  return s.length > n ? s.slice(0, n) : s;
};

// ---- kinds ----------------------------------------------------------------------------------------------------------------
// A field's kind is a string (below), E(...) an enum, L(...) a list of enum values, O({...}) a nested object, A(kind, max)
// an array, or COUNTS (code-made keys to numbers).
const E = (...vals) => ({ e: new Set(vals) });
const L = (...vals) => ({ l: new Set(vals) });
const O = (spec) => ({ o: spec });
const A = (kind, max) => ({ a: kind, max: max || 20 });
const COUNTS = { counts: true };
const RX = {
  hex: /^[0-9a-f]{1,8}$/,
  desc: /^[0-9a-f]{1,8}:[A-Za-z0-9 _.'()+-]{1,64}\.es[mpl]$/i,
  tag: /^[A-Z0-9?]{4}$/,
  did: /^\d{1,22}$/,
  ver: /^[0-9][0-9a-z.\-]{0,20}$/i,
  code: /^[A-Za-z0-9_:.-]{1,40}$/,
  zid: /^[a-z0-9_-]{1,32}$/i,
  gen: /^[a-z0-9]{1,12}$/,
  jid: /^[0-9a-f]{8,40}$/,
  role: /^[a-z_]{1,20}$/,
};
const NUM_MAX = 1e13;
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && Math.abs(n) <= NUM_MAX ? n : undefined; };
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) <= NUM_MAX ? Math.round(n * 100) / 100 : undefined; };
const toHex = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? (v >>> 0).toString(16) : undefined;
  const s = String(v || '').toLowerCase().replace(/^0x/, '');
  return RX.hex.test(s) ? s : undefined;
};
const NAME = { s: 48 };
const NAME64 = { s: 64 };
const TEXT = { s: 200 };

// ---- shared shapes ------------------------------------------------------------------------------------------------------
const OWNER = O({ p: 'int', c: 'tag', n: NAME, d: 'did', why: E('companion', 'summon', 'warband') });
const PARTY = O({ r: 'role', p: 'int', c: 'tag', n: NAME, sn: NAME, a: 'hex', d: 'did', amb: 'one', staff: 'code',
  npc: NAME, base: NAME, kind: 'code', owner: OWNER, dist: 'int' });
const PARTIES = A(PARTY, 12);
const NEAR = A(O({ p: 'int', c: 'tag', n: NAME, sn: NAME, dist: 'int', staff: 'code' }), 10);
const ITEM = O({ b: 'desc', i: NAME, k: 'int', x: 'one', named: 'one', tmp: 'num', ench: NAME64, chg: 'int', soul: 'int', poi: NAME, poiN: 'int' });
const ITEMS = A(ITEM, 60);
const PLACE = O({ w: 'desc', cell: NAME64, zone: 'zid', x: 'int', y: 'int', z: 'int' });
const OWN = E('self', 'owner', 'assignee', 'household', 'renter', 'faction', 'treasury', 'dungeon', 'searched', 'public');
const ACCESS = E('owner', 'key', 'assignee', 'shared', 'manager', 'staff', 'lockpick', 'raid', 'unlocked', 'unknown');
const TIER = E('senior', 'developer', 'leadgm', 'gm', 'trialgm', 'none');
const SIDE = O({ hits: 'int', dmg: 'num', by: A(NAME, 8) });
const REFUSAL_REASONS = ['god', 'ethereal', 'offline_body', 'login_grace', 'bound', 'paralysed', 'armour_change', 'damage_cap',
  'spell_rate', 'dungeon_ally', 'warband', 'companion_pvp', 'silver', 'recovering', 'downed', 'shout_not_given',
  'friendly_lethal', 'duel_pause', 'duel_rules', 'duel_beaten', 'duel_scaled', 'duel_outsider', 'anticheat', 'asylum', 'in_editor', 'silver_test', 'frenzy_downed', 'frenzy_spared', 'unknown'];

// The anticheat kinds a sec.signal may carry (anticheat.js acFlag and the fork's onAnticheat through it; ANTI-CHEAT DESIGN
// 17 Oct). playerlog-taps.js's anticheat hook writes these and no other kind.
const AC_SIGNAL_KINDS = ['speed_sustained', 'speed_sustained60', 'speed_blink', 'speed_slow', 'snapback_ignored', 'magicka_free', 'stamina_free',
  'magicka_debt', 'stamina_debt', 'vitals_nonfinite', 'power_unmatched', 'spellhit_nocast'];

// ---- the event types (DESIGN.md 1.5) ------------------------------------------------------------------------------------
// p: priority (0 never dropped before the hard cap, 1, 2 first to go); place: 'pos' (cell and coordinates), 'cell' (cell
// only) or none; near: carries nr; on: the switch default (gamemode-config.json playerLog.types overrides it)
const T = (p, place, f, opts) => Object.assign({ p, place: place || '', near: false, on: true, f }, opts || {});
const EVENT_TYPES = {
  // meta
  // fresh: the state was new, so the server process started (after a stop or a crash), not a hot reload (review C-R6)
  'sys.start': T(0, '', { gen: 'gen', ver: 'code', cfg: 'hex', hooks: 'int', why: E('load', 'resume'), fresh: 'bool' }),
  'sys.stop': T(0, '', { reason: E('disabled', 'stopfile', 'sigterm', 'errors', 'load_failed') }),
  'sys.error': T(0, '', { site: 'code', n: 'int', cls: 'code' }),
  'sys.dropped': T(0, '', { reason: E('cap', 'disk_low', 'write_error', 'enospc', 'off'), counts: COUNTS }),
  'sys.schema': T(0, '', { keys: COUNTS, types: COUNTS }),
  'sys.audit_unknown': T(0, '', { verbs: COUNTS }),
  // account and session
  // gold and bank per character, and total: how many characters the profile has, so a list cut at 24 never reads as the rest
  // deleted (13 Oct, gold review)
  'account.snapshot': T(0, '', { chars: A(O({ a: 'hex', c: 'tag', n: NAME, slot: 'int', dead: 'bool', perma: 'bool', staff: 'bool', created: 'int', j: 'jid', gold: 'int', bank: 'int' }), 24),
    total: 'int' }),
  'session.login': T(0, 'pos', { slot: 'int', tier: TIER, staffChar: 'bool', gold: 'int', bank: 'int', userId: 'int', client: 'ver', sp: 'ver', reselect: 'bool' }),
  'session.logout': T(0, 'pos', { reason: E('menu_quit', 'crash_likely', 'afk_likely', 'kicked', 'suspended', 'slept', 'permadeath', 'server_stop', 'unknown'),
    sec: 'int', gold0: 'int', gold1: 'int', bank0: 'int', bank1: 'int', silentSec: 'int', journalOpen: 'bool', resync: 'bool', cached: 'bool' }),
  'session.switch': T(0, '', { to: O({ a: 'hex', c: 'tag', n: NAME }) }),
  'session.char_menu': T(1, '', {}),
  'session.char_create': T(0, '', { slot: 'int' }),
  'session.char_created': T(0, '', { race: NAME, sex: E('male', 'female'), heightPct: 'int' }),
  'session.char_delete': T(0, '', { slot: 'int', c: 'tag', n: NAME }),
  'session.client': T(1, '', { v: 'ver', sp: 'ver' }),
  'session.afk': T(2, '', { op: E('away', 'back'), min: 'int' }),
  'session.perm': T(0, '', { tierFrom: TIER, tierTo: TIER, rolesChanged: 'bool' }),
  'session.kick': T(0, '', { kind: E('command', 'panel', 'demotion', 'suspension', 'sleep', 'permadeath', 'afk', 'discord_ban', 'ban_enforce') }),
  'session.ban': T(0, '', { kind: E('ban', 'tempban', 'unban', 'suspend', 'lift', 'warn', 'strike', 'overturn', 'refused', 'review'), hours: 'int', until: 'int', entry: 'int' }),
  'session.guard': T(2, '', { kind: E('login_grace', 'spawn_miss', 'crashloop_moved', 'crash_down_forgiven', 'crash_down_not_forgiven', 'crash_shield', 'crash_shield_dropped', 'redress', 'starter_kit', 'playtest_returned', 'beast_breaker'), n: 'int' }),
  // character
  'char.rename': T(0, '', { from: NAME, to: NAME }),
  'char.appearance': T(1, '', { kind: E('creation', 'edit', 'reroll', 'chargen', 'refused', 'opened', 'details', 'kept_free', 'not_saved', 'write_failed', 'head_swap'), gold: 'int', raceFrom: NAME, raceTo: NAME, sexChanged: 'bool' }),
  'char.mask': T(1, '', { on: 'bool' }),
  'char.beast': T(1, '', { form: 'code', op: E('take', 'revert', 'grant', 'remove'), why: 'code' }),
  'char.supernatural': T(0, '', { kind: 'code', op: E('infected', 'became', 'cured', 'rite', 'feed_given', 'feed_taken', 'feed_asked', 'feed_refused', 'crown', 'rank', 'restored', 'lost', 'removed', 'given', 'cleared') }),
  'char.level': T(1, '', { level: 'int', spent: O({ attr: E('health', 'magicka', 'stamina'), n: 'int' }) }),
  'char.mastery': T(1, '', { skill: 'code', op: E('take_up', 'set_aside', 'level', 'rank', 'lock'), from: 'int', to: 'int' }),
  'char.knowledge': T(1, '', { kind: E('school', 'spell', 'manual', 'technique', 'skillbook', 'schematic', 'teach', 'tome', 'recipe', 'shouts'), what: NAME64, op: 'code' }),
  'char.deity': T(1, '', { op: E('chose', 'turned', 'blessing', 'offering', 'reset', 'reset_failed', 'reset_refused'), deity: NAME, gold: 'int' }),
  'char.misc': T(2, '', { kind: E('title', 'racial_power', 'story_edited', 'hunger_set'), label: NAME, value: 'int' }),
  // movement and world
  'move.cell': T(1, 'cell', { from: PLACE, to: PLACE, own: OWN, access: ACCESS }),
  'move.zone': T(1, 'cell', { from: 'zid', to: 'zid' }),
  'move.teleport': T(1, 'pos', { reason: E('gate', 'unstuck', 'staff_tp', 'fixloc', 'gm_goto', 'panel_tp', 'summon', 'dungeon', 'playtest', 'creation', 'temple', 'crash', 'spawnwatch', 'anticheat', 'unknown'), dist: 'int' }),
  'move.door': T(2, 'cell', { door: 'hex', dest: NAME64, allowed: 'bool', own: OWN, access: ACCESS }, { near: true }),
  'move.dungeon': T(1, 'cell', { op: E('claim', 'enter', 'leave', 'end', 'boss', 'moved_out'), dungeon: NAME64, difficulty: NAME, members: PARTIES, why: 'code' }),
  'move.map': T(2, '', { n: 'int', names: A(NAME, 5) }),
  // items and gold
  'item.move': T(1, '', { kind: E('put', 'take'), ref: 'hex', base: NAME, item: ITEM, packBefore: 'int', packAfter: 'int', contBefore: 'int', contAfter: 'int' }, { disk: true }),
  'item.container': T(1, 'pos', { ref: 'hex', base: NAME, own: OWN, access: ACCESS, took: ITEMS, put: ITEMS, dur: 'int', refused: 'int' }, { near: true }),
  'item.access_refused': T(1, 'cell', { ref: 'hex', kind: E('container', 'door'), own: OWN, why: E('locked', 'not_yours', 'rented', 'business', 'treasury', 'closed_house', 'place_rule', 'unknown'), n: 'int' }, { near: true }),
  'item.snapshot': T(2, '', { at: E('logout', 'down'), items: A(ITEM, 250), gold: 'int', bank: 'int' }, { disk: true }),
  // carried gold and bank when the slow poll finds them changed (13 Oct, gold review): the forum's account totals
  'item.gold': T(1, '', { gold: 'int', bank: 'int' }, { disk: true }),
  'law.search': T(0, '', { op: E('requested', 'accepted', 'refused', 'timeout', 'ended') }, { near: true }),
  'item.pickup': T(1, 'cell', { item: ITEM, ref: 'hex' }),
  'item.harvest': T(2, 'cell', { item: ITEM, k: 'int' }),
  'item.drop': T(1, 'cell', { item: ITEM }),
  'item.trade': T(0, '', { gave: ITEMS, got: ITEMS }),
  'item.loot': T(1, 'cell', { source: E('player_body', 'animal_body', 'dungeon_body', 'dungeon_chest_gold', 'camp', 'skinning', 'coin_purse', 'wisp', 'reading', 'scholar_gift', 'blackreach_chest'), items: ITEMS, gold: 'int', shares: A(O({ p: 'int', c: 'tag', gold: 'int' }), 12) }),
  'item.craft': T(1, '', { product: ITEM, k: 'int', inputs: ITEMS, fuel: ITEMS, station: NAME }),
  'item.brew': T(1, '', { potion: ITEM, tier: 'int', inputs: ITEMS }),
  'item.extras': T(1, '', { kind: E('temper', 'enchant', 'recharge', 'disenchant', 'soul'), item: ITEM, soul: 'int' }),
  'item.salvage': T(1, '', { item: ITEM, station: NAME, rank: 'int', out: ITEMS }),
  'item.consume': T(2, '', { item: ITEM, kind: E('food', 'drink', 'potion', 'poison', 'ingredient', 'scroll', 'other') }),
  'item.ammo': T(2, '', { item: ITEM, k: 'int', windowSec: 'int' }),
  'item.equip': T(2, '', { on: ITEMS, off: ITEMS }),
  'item.grant': T(0, '', { items: ITEMS, via: E('panel', 'console', 'gift', 'manual', 'masktest', 'kit', 'beast_item'), gold: 'int' }),
  'item.sweep': T(0, '', { kind: E('gearstrip', 'sprstrip', 'gearswap', 'gearrestore', 'restitution'), removed: ITEMS, refunds: ITEMS, case: 'code', n: 'int', gold: 'int' }),
  'item.mail': T(1, '', { op: E('parcel_sent', 'parcel_collected', 'supply_posted', 'supply_delivered', 'supply_taken_down', 'supply_refunded'), gold: 'int', items: ITEMS, tax: 'int', fee: 'int', id: 'int' }),
  'item.courier': T(1, '', { op: E('posted', 'took', 'delivered', 'robbed', 'opened', 'insured', 'lost', 'cleared', 'returned', 'reached'), job: 'int', items: ITEMS, gold: 'int', pay: 'int' }),
  'item.bank': T(0, '', { op: E('deposit', 'withdraw', 'treasury', 'vault_rent', 'vault_fee', 'vault_arrears', 'vault_open', 'vault_owed', 'vault_warn', 'vault_end',
    'vault_store', 'vault_take', 'vault_seize', 'vault_seize_item', 'vault_staff_take', 'vault_restore'), gold: 'int', balance: 'int', treasury: NAME,
    zone: 'zid', tier: 'code', n: 'int', i: NAME64, b: 'hex' }),
  'item.bank_write': T(1, '', { reason: E('wage', 'tax', 'ledger_sale', 'restitution', 'credit', 'charge', 'other'), from: 'int', to: 'int' }),
  'item.buy': T(1, '', { what: NAME64, price: 'int', seller: E('synod', 'tome_shop', 'ledger', 'other') }),
  'item.fee': T(1, '', { what: E('bed', 'rent', 'deposit', 'purchase', 'chest_rent', 'appearance', 'charter', 'commission', 'board_post', 'offering', 'pigeon', 'ledger'), gold: 'int', to: NAME }),
  'item.income': T(1, '', { source: E('contract', 'champion', 'charter', 'commission', 'supply', 'courier', 'rent_share', 'business', 'racial', 'ledger_sale', 'other'), gold: 'int', items: ITEMS }),
  'item.key': T(1, '', { op: E('offered', 'accepted', 'cut', 'taken_back', 'to_ring'), house: 'hex' }),
  'item.rack': T(1, '', { op: E('racked', 'took', 'manager_took', 'returned', 'changed_hands'), weapon: NAME, home: 'hex' }),
  'item.theft': T(0, 'pos', { kind: E('robbery', 'pickpocket', 'raid', 'body_search', 'courier_robbed'), outcome: E('took', 'caught', 'nothing', 'refused', 'timeout', 'demanded', 'left'),
    gold: 'int', items: ITEMS, home: 'hex', container: 'hex', keyTaken: 'bool', parcel: 'bool', handOverFailed: 'bool' }, { near: true }),
  'item.relog': T(0, '', { grew: A(O({ b: 'hex', i: NAME, pack: A('int', 2), cont: A('int', 2) }), 12) }),
  'item.flow': T(1, '', { kind: E('scholar_gift', 'beast_item', 'revival_draught', 'manual_used', 'manacles_on', 'manacles_off', 'rite_soulgem', 'pick_snapped', 'rope_used', 'rope_returned'), item: ITEM, k: 'int' }),
  'item.unexplained': T(1, '', { item: ITEM, before: 'int', after: 'int' }),
  // combat
  'combat.hit': T(2, '', { dir: E('dealt', 'taken'), src: NAME, dmg: 'num', eng: 'num', hp0: 'num', hp1: 'num', flags: L('blk', 'pow', 'bash', 'snk', 'spell') }, { on: false }),
  'combat.damage': T(2, '', { dir: E('dealt', 'taken'), src: NAME, hits: 'int', dmg: 'num', eng: 'num', blk: 'int', pow: 'int', bash: 'int', snk: 'int', hp0: 'num', hp1: 'num', maxHp: 'num', from: 'int', to: 'int' }, { disk: true }),
  'combat.fight': T(1, 'cell', { dealt: SIDE, taken: SIDE, hp0: 'num', hp1: 'num', from: 'int', to: 'int', outcome: E('ended', 'downed', 'killed', 'fled', 'logout'),
    first: E('me', 'them'), t1me: 'int', t1them: 'int', att1me: 'int', att1them: 'int', refused: COUNTS, party: 'bool', pvp: 'bool', kills: 'int',
    link: O({ kind: E('robbery_demand', 'robbery', 'capture', 'search'), by: E('me', 'them'), t: 'int' }) }, { near: true }),
  'combat.refused': T(2, '', { reason: E(...REFUSAL_REASONS), n: 'int', windowSec: 'int' }, { disk: true }),
  'combat.cast': T(2, '', { spells: A(O({ s: NAME, n: 'int' }), 20), windowSec: 'int' }, { disk: true }),
  'combat.effect': T(2, '', { kind: E('stagger', 'disarm', 'dismay', 'push', 'paralysis', 'rune', 'howl', 'calm', 'frenzy', 'sun', 'feed_drain', 'other'), sec: 'int', pct: 'num' }),
  'combat.heal': T(2, '', { src: NAME, hpGain: 'num', windowSec: 'int' }),
  'combat.health_loss': T(2, 'cell', { pct: 'num', cause: E('fall_likely', 'dot_or_environment', 'unknown'), dz: 'int', merged: 'int' }, { disk: true }),
  'combat.down': T(0, 'pos', { cause: E('hit', 'no_attacker', 'staff_kill', 'rite', 'execution'), src: NAME, dmg: 'num', dist: 'int', lastHits: A(O({ src: NAME, dmg: 'num', t: 'int', p: 'int', c: 'tag', npc: NAME }), 3) }, { near: true }),
  'combat.wake': T(0, '', { how: E('gave_up', 'bled_out', 'revived_heal', 'revived_draught', 'recovered', 'crash_forgiven', 'crash_shield', 'captured', 'chill', 'unknown'), downSec: 'int', chillMin: 'int' }),
  'combat.finish': T(0, 'pos', {}, { near: true }),
  'combat.death_final': T(0, 'pos', { kind: E('permadeath', 'execution', 'war', 'rite') }, { near: true }),
  'combat.kill': T(1, '', { victim: O({ npc: NAME, base: NAME, kind: 'code', owner: OWNER }), champion: 'bool', src: NAME, byCompanion: 'bool' }),
  'combat.kill_player': T(0, 'pos', { war: 'bool', src: NAME }, { near: true }),
  'combat.capture': T(0, 'pos', { op: E('cuffed', 'roped', 'carried', 'put_down', 'released', 'broke_free', 'slipped', 'cut_free', 'left_tied', 'led', 'jail_uncuffed', 'restrained') }, { near: true }),
  'combat.offline_body': T(1, '', { op: E('logout_in_fight', 'hit_refused') }),
  // law and social
  'law.jail': T(0, '', { op: E('imprisoned', 'served', 'escaped', 'extended', 'released', 'cell_picked', 'zone_added', 'zone_removed'), minutes: 'int', jail: NAME }, { near: true }),
  'law.execution': T(0, '', { op: E('asked', 'approved', 'refused', 'started', 'done') }),
  'law.concordat': T(0, '', { op: E('arrest', 'jail', 'refused') }),
  'social.party': T(1, '', { op: E('invite', 'accept', 'decline', 'leave', 'kick', 'lead', 'expedition_leave', 'disband'), size: 'int' }),
  'social.faction': T(1, '', { op: E('invite', 'join', 'leave', 'kick', 'rank', 'leader', 'storage', 'hall', 'override', 'limit', 'ranks', 'challenge') }),
  'social.court': T(1, '', { op: E('appoint', 'dismiss', 'offer', 'accept', 'decline', 'withdraw'), zone: 'zid' }),
  'social.nobility': T(1, '', { op: E('grant', 'revoke') }),
  'social.realm': T(1, '', { op: E('tax_rate', 'wage', 'forgave_wages', 'assessed', 'bought_from_hold', 'war_declared', 'death_accept', 'death_refuse', 'peace_offer', 'peace_refuse',
    'treaty_offer', 'treaty_accept', 'treaty_refuse', 'capital', 'war_kill', 'raid_start'), pct: 'int', gold: 'int', war: 'code', weeks: 'int', ref: 'hex', fief_holder: 'bool' }),
  'social.housing': T(1, '', { op: E('claim', 'abandon', 'revoke', 'lock', 'unlock', 'rename', 'cut_key', 'take_key', 'rekey', 'transfer', 'grant', 'grant_container', 'assign', 'unassign', 'share', 'unshare', 'staff_override', 'other'), property: 'hex', ok: 'bool' }),
  'social.property': T(1, '', { op: E('list', 'unlist', 'interest', 'offer', 'accept', 'rent', 'buy', 'sell', 'pay', 'leave', 'evict', 'grace', 'remind', 'fief', 'overdue', 'lapsed', 'treasury'), key: 'code', gold: 'int' }),
  'social.rest': T(2, '', { op: E('rent', 'keep', 'unkeep', 'sleep', 'wake', 'collect'), bed: 'code', gold: 'int' }),
  'social.business': T(1, '', { op: E('open', 'note', 'rent', 'chest', 'collect', 'ledger', 'staff_add', 'staff_remove', 'rename', 'close', 'archive'), claim: 'hex', gold: 'int' }),
  'social.letter': T(1, '', { signed: E('own', 'unsigned', 'forged'), gold: 'int', items: ITEMS }),
  'social.report': T(1, '', { kind: E('bug', 'gmcall', 'gmcall_add', 'gmcall_cancel', 'ticket'), ref: 'code', op: 'code' }),
  'social.dossier': T(1, '', { op: E('written', 'struck') }),
  'social.player_menu': T(2, '', { action: 'code' }),
  'social.companion': T(2, '', { op: E('spawned', 'command', 'dismissed', 'released', 'ended'), kind: 'code', base: NAME }),
  'social.contract': T(1, '', { op: E('take', 'complete', 'abandon', 'post'), kind: 'code', k: 'int', zone: 'zid', gold: 'int' }),
  'social.commission': T(1, '', { op: E('post', 'take', 'done', 'refuse', 'rule', 'cancel', 'abandon', 'expire', 'unjudged'), id: 'int', reward: 'int' }),
  'social.charter': T(1, '', { op: E('draft', 'pitch_set', 'seat', 'kind', 'invite', 'confirm', 'leave', 'submit', 'withdraw', 'approve', 'deny', 'edit', 'dissolve', 'disband_ask', 'disband_ok', 'disband_no', 'paid', 'lapsed', 'other'), number: 'int', gold: 'int' }),
  'social.lock': T(1, '', { op: E('picked', 'failed', 'cancel', 'refused'), why: E('fast', 'far', 'expired', 'superseded', 'inconsistent', 'replay', 'nonce', 'other'), snaps: 'int', level: 'int', target: 'hex', own: OWN }),
  // with the anticheat kinds (AC_SIGNAL_KINDS): the kind, the fold count n, the numbers
  'sec.signal': T(0, '', { kind: E('minigame_refused', 'mismatch', 'console_blocked', 'relog_grew', 'movement_refused', 'lockpick_refused', ...AC_SIGNAL_KINDS), game: 'code',
    // the minigame judges' own refusal codes (gamemode.js reading and skinning, labour.js, minigames.js, prayer.js, struggle.js)
    why: E('fast', 'far', 'replay', 'nonce', 'expired', 'superseded', 'inconsistent', 'speed', 'tries', 'attempts', 'clock', 'flood', 'range', 'order', 'extra',
      'submit', 'future', 'late', 'mismatch', 'malformed', 'cooldown', 'away', 'count', 'early', 'faltered', 'overlap', 'overtime', 'parse', 'precise', 'released',
      'rested', 'shape', 'slow', 'stall', 'other'), n: 'int', nums: O({ dxy: 'num', dz: 'num', speed: 'num', budget: 'num', enforced: 'bool',
      limit: 'num', ratio: 'num', window: 'num', casts: 'int', cost: 'num', debt: 'num', cls: 'code' }) }),
  // commands, console and staff
  'cmd.run': T(1, '', { name: 'code', sub: 'code', nums: A('num', 3), route: E('chat', 'upanel', 'journal', 'quiet', 'xmenu', 'warband', 'console'), outcome: E('ok', 'refused', 'error', 'async'), via: E('alias', 'nested'), mirror: 'bool' }),
  'cmd.info': T(2, '', { name: 'code', n: 'int' }),
  'cmd.refused': T(2, '', { reason: E('too_long', 'unknown', 'not_staff', 'lead_only'), name: 'code' }),
  'cmd.console': T(0, '', { cmd: 'code', ref: 'hex', form: NAME, k: 'int', rights: 'bool', local: 'bool', blocked: 'bool' }),
  'staff.action': T(0, '', { action: 'code', via: E('panel', 'command', 'console', 'journal', 'audit'), params: O({ hours: 'int', amount: 'num', count: 'int', item: NAME, skill: 'code', tier: 'code', mode: 'code', kind: 'code', school: 'code', level: 'int' }), outcome: E('ok', 'refused', 'error', 'sent') }),
  'staff.view': T(1, '', { what: E('charstats', 'schools', 'gearswap', 'discipline', 'dossier', 'journal', 'boost', 'playtime', 'tokens', 'fixloc', 'whereami') }),
  'staff.world': T(1, '', { action: E('broadcast', 'announce', 'clock', 'weather', 'timescale', 'place', 'zone', 'war', 'schedule', 'mode', 'jail_zone', 'rolename', 'feedpair', 'drift', 'diag', 'dungeon', 'raid'), n: 'int' }),
  // audit verbs reviewed as clean (Appendix A): act.<VERB>, identity normalised, quoted text collapsed
  'act.*': T(1, '', { text: TEXT }),
};
const typeOf = (ev) => {
  if (typeof ev !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(EVENT_TYPES, ev)) return EVENT_TYPES[ev];
  if (ev.startsWith('act.') && AUDIT_VERBS[ev.slice(4)] && AUDIT_VERBS[ev.slice(4)].cls === 'clean') return EVENT_TYPES['act.*'];
  return null;
};

// ---- validation (in the flush tick, off the hot path) ----------------------------------------------------------------------
const bump = (m, k) => { if (m) m.set(k, (m.get(k) || 0) + 1); };
const value = (kind, v, path, dropped) => {
  if (v === undefined || v === null) return undefined;
  if (typeof kind === 'string') {
    switch (kind) {
      case 'int': return toInt(v);
      case 'num': return toNum(v);
      case 'bool': return v === true || v === 1 ? true : v === false || v === 0 ? false : undefined;
      case 'one': return v ? 1 : undefined;
      case 'hex': return toHex(v);
      case 'desc': { const s = String(v); return RX.desc.test(s) ? s : undefined; }
      default: { const re = RX[kind]; if (!re) return undefined; const s = String(v); return re.test(s) ? s : undefined; }
    }
  }
  if (kind.s) { const s = clean(v, kind.s); return s ? s : undefined; }
  if (kind.e) return kind.e.has(v) ? v : undefined;
  if (kind.l) { if (!Array.isArray(v)) return undefined; const out = v.filter((x) => kind.l.has(x)).slice(0, 8); return out.length ? out : undefined; }
  if (kind.counts) {
    if (!v || typeof v !== 'object') return undefined;
    const out = {}; let n = 0;
    for (const [k, c] of (v instanceof Map ? v.entries() : Object.entries(v))) {
      if (n >= 40) break;
      if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(k)) { bump(dropped, `${path}._bad`); continue; }
      const x = toInt(c); if (x === undefined) continue;
      out[k] = x; n++;
    }
    return n ? out : undefined;
  }
  if (kind.a) {
    if (!Array.isArray(v)) return undefined;
    const out = [];
    for (const x of v.slice(0, kind.max)) { const y = value(kind.a, x, path, dropped); if (y !== undefined) out.push(y); }
    return out.length ? out : undefined;
  }
  if (kind.o) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {}; let n = 0;
    for (const k of Object.keys(v)) {
      const sub = kind.o[k];
      if (!sub) { bump(dropped, `${path}.${k}`); continue; }
      const y = value(sub, v[k], `${path}.${k}`, dropped);
      if (y !== undefined) { out[k] = y; n++; }
    }
    return n ? out : undefined;
  }
  return undefined;
};
const TOP = { v: 'int', t: 'int', g: 'gen', s: 'int', ev: 'code', p: 'int', c: 'tag', n: NAME, sn: NAME, a: 'hex', d: 'did',
  at: PLACE, o: PARTIES, nr: NEAR, src: 'code', q: E('inferred') };
// rec -> a new, clean record, or null for an unknown type. dropped: Map 'type.key' -> count (names from code only);
// unknownTypes: Map type -> count (a type name is from code, but it is cut and shaped all the same)
const validate = (rec, dropped, unknownTypes) => {
  if (!rec || typeof rec !== 'object') return null;
  const spec = typeOf(rec.ev);
  if (!spec) { bump(unknownTypes, /^[a-z_.*A-Z-]{1,40}$/.test(String(rec.ev)) ? String(rec.ev) : '_bad'); return null; }
  const out = {};
  for (const k of Object.keys(rec)) {
    if (k === 'f') continue;
    const kind = TOP[k];
    if (!kind) { bump(dropped, `${rec.ev}.${k}`); continue; }
    const y = value(kind, rec[k], `${rec.ev}.${k}`, dropped);
    if (y !== undefined) out[k] = y;
  }
  const f = {};
  if (rec.f && typeof rec.f === 'object') {
    for (const k of Object.keys(rec.f)) {
      const kind = spec.f[k];
      if (!kind) { bump(dropped, `${rec.ev}.f.${k}`); continue; }
      const y = value(kind, rec.f[k], `${rec.ev}.f.${k}`, dropped);
      if (y !== undefined) f[k] = y;
    }
  }
  out.f = f;
  // Coordinates only for the pos types (privacy: no continuous position)
  if (out.at && spec.place !== 'pos') { delete out.at.x; delete out.at.y; delete out.at.z; }
  if (out.at && !spec.place) delete out.at;
  if (out.nr && !spec.near) delete out.nr;
  return out;
};

// ---- parties in audit lines (Appendix A normalisation) ---------------------------------------------------------------------
// who():     Name #TAG (profile N, <@id>)     display():  Name #TAG
// The name is taken from the words before the #TAG; the template's own words before it (a verb, "by") are cut off by the
// resolver, which reads the character's own name from the game (playerlog-taps.js), never from the line.
const W = "[^\\s#()\\[\\]\"<>:;,]+";
const RX_WHO = new RegExp(`((?:${W} ){0,5}?${W}) #([A-Z0-9?]{4}) \\(profile (-?\\d{1,9})(?:, <@(\\d{1,22})>)?\\)`, 'g');
const RX_DISPLAY = new RegExp(`((?:${W} ){0,5}?${W}) #([A-Z0-9]{4})\\b(?! \\(profile)`, 'g');
const partiesOf = (text, withDisplay) => {
  const out = [];
  // pre: the line up to the name's end (the role maps read the words before the name, which the capture may hold)
  for (const m of text.matchAll(RX_WHO)) out.push({ name: m[1], tag: m[2], profile: Number(m[3]), discord: m[4] || '', at: m.index, end: m.index + m[0].length, pre: text.slice(Math.max(0, m.index - 80), m.index + m[1].length) });
  if (withDisplay) {
    for (const m of text.matchAll(RX_DISPLAY)) {
      if (out.some((p) => m.index >= p.at && m.index < p.end)) continue;
      out.push({ name: m[1], tag: m[2], profile: null, discord: '', at: m.index, end: m.index + m[0].length, pre: text.slice(Math.max(0, m.index - 80), m.index + m[1].length) });
    }
    out.sort((x, y) => x.at - y.at);
  }
  return out;
};
// Text a player or staff member wrote is cut before anything else reads the line: each "quoted" string becomes "…", and
// a quote left unmatched takes the rest of the line with it. A party name is never read from the line (above), so a quote
// inside someone's text can at worst make a parser see the #TAG of a real character, never carry the text out.
const unquote = (text) => {
  let s = String(text).replace(/"[^"\n]{0,600}"/g, '\u0001');
  const i = s.indexOf('"');
  if (i >= 0) s = s.slice(0, i);
  return s.replace(/\u0001/g, '"…"');
};
const gold = (text, rx) => { const m = String(text || '').match(rx); if (!m) return undefined; const v = m.slice(1).find((x) => x !== undefined); const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; };
// "2x Iron Ingot, 1x Bread" (post.js itemsText) -> items with record names
const itemsFromText = (s) => {
  const out = [];
  for (const part of String(s || '').split(/, (?=\d+x )/)) {
    const m = part.trim().match(/^(\d{1,7})x (.{1,48})$/);
    if (m) out.push({ i: m[2].trim(), k: Number(m[1]) });
  }
  return out.slice(0, 60);
};
// "Iron Sword, Leather Boots" (robbery.js label(), raids.js label()): record names
const namesFromText = (s) => String(s || '').split(/, | and /).map((x) => x.trim()).filter((x) => x && x.length <= 48 && !/^\d+ gold$/.test(x)).slice(0, 40).map((i) => ({ i, k: 1 }));
const num = (s) => { if (s === undefined || s === null) return undefined; const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : undefined; };

// ---- the audit verb registry (Appendix A) ---------------------------------------------------------------------------------
// cls: 'clean' -> act.<VERB> with normalised text; 'parsed' -> parse(text, P, raw, roles) gives domain events from anchored
// groups only; 'excluded' -> nothing (a direct hook covers it). roles(i, pre): the role of party i from the text just
// before it. Every parser reads unquote(line), cut by the verb's own `cut`: quoted text never reaches a regex.
// A parser's event: { ev, actor, f, others: [[party, role]], ... } where a party is an index into P, or { profile, tag? } for
// one named by profile alone (the server's adminLog, the housing and board lines); actor -1: nobody.
// Each pattern names the words just before a party's name (" robbed "); it is tested against the line up to the end of
// that name, with up to six name words after it
const NAME_WORDS = '(?:[^\\s#]+ ){0,5}[^\\s#]+$';
const R_BY = (map) => {
  const compiled = map.map(([rx, role]) => [new RegExp(`(?:${rx.source.replace(/\$$/, '')})${NAME_WORDS}`), role]);
  return (i, pre) => { for (const [rx, role] of compiled) if (rx.test(pre)) return role; return i === 0 ? 'actor' : 'other'; };
};
const ev = (name, actor, f, others, extra) => Object.assign({ ev: name, actor, f: f || {}, others: others || [] }, extra || {});
const rest = (P, actor, role) => P.map((p, i) => [i, role || 'other']).filter(([i]) => i !== actor);
const opOf = (text, table) => { for (const [rx, op] of table) if (rx.test(text)) return op; return null; };
const byProfile = (n) => (Number.isFinite(n) && n >= 0 ? { profile: n } : null);

const AUDIT_VERBS = {};
const clean_ = (verbs, extra) => { for (const v of verbs.split(/\s+/).filter(Boolean)) AUDIT_VERBS[v] = Object.assign({ cls: 'clean' }, extra || {}); };
const excluded = (verbs, why) => { for (const v of verbs.split(/\s+/).filter(Boolean)) AUDIT_VERBS[v] = { cls: 'excluded', why }; };
const parsed = (verb, def) => { AUDIT_VERBS[verb] = Object.assign({ cls: 'parsed' }, def); };

// C: clean. Every interpolation of every site is identity, a number, an enum, a config name or a record name (the reviewer
// confirms each site; tests/playerlog-audit-harness.js pins them and fails a clean site whose template holds a quote)
clean_(`SCHOOLS MANUAL SKILLBOOK SCHEMATIC READ CONTRACT CHAMPION CHILL REVIVE FEED BEAST BLOODCROWN BLOOD
  HUNT RITE SILVER DUNGEON CHESTGOLD MINE CHOP ALCHEMY SMELT TAILOR REGION FORGENEVER ARTIFACT ORCISH RACECRAFT FACTIONGEAR DRAGON LOCK
  UNSTUCK JAIL CONCORDAT EXECUTION OFFERING PRAYER REST WELL CAMP PLAYTIME PLAYTEST REROLL TICKET CRASH-DOWN CRASHLOOP
  RUINBUTTON TAX SUPPLY BOOST STAFF APPEARANCE RECIPE BREW TREASURY ENCH-RESTORE ENCH-LEARNED-REPAIR CLOCK SPELL
  CITIZEN ELECTION BLACKREACH PURSE`);
// Name #TAG parties with no profile (display()): resolved by name and tag, never by the tag alone
clean_('LEVEL ROPE STRUGGLE', { display: true });
// The client-judged minigame mismatches: clean, and a security signal
clean_('LABOUR-MISMATCH LOCKPICK-MISMATCH PRAYER-MISMATCH RITE-MISMATCH SKINNING-MISMATCH STRUGGLE-MISMATCH', { signal: 'mismatch', display: true });
// The role maps (Appendix A: "the first party is the actor" is wrong for these)
AUDIT_VERBS.SMITH = { cls: 'clean', roles: R_BY([[/ made $/, 'target'], [/ (?:by|from) (?:staff )?$/, 'staff']]) };
AUDIT_VERBS.SPELL.roles = R_BY([[/ taught $/, 'student']]);
// REVIVE <revived> by <reviver> (downed.js:468), CHILL <woken> lifted by <lifter> (:287): the one who acted is the actor
// and the other the target, so the marks read the right way round (review C, recommended); "by nobody" leaves the revived
// player as the only party, and so the actor
const BY_ACTS = new RegExp(`(?: by )${NAME_WORDS}`);
AUDIT_VERBS.REVIVE.roles = (i, pre) => (BY_ACTS.test(pre) ? 'actor' : 'target');
AUDIT_VERBS.CHILL.roles = (i, pre) => (BY_ACTS.test(pre) ? 'actor' : 'target');
AUDIT_VERBS.EXECUTION.roles = R_BY([[/ by $/, 'by'], [/ of $/, 'victim'], [/beheads $/, 'victim'], [/: $/, 'actor']]);
AUDIT_VERBS.UNSTUCK.roles = R_BY([[/ staff $/, 'staff']]);
AUDIT_VERBS.BOOST.roles = R_BY([[/ (?:extended|granted) $/, 'target']]);
// APPEARANCE <staff> granted <target> a free appearance change (appearance.js /grantappearance): the one given it is the target
AUDIT_VERBS.APPEARANCE.roles = R_BY([[/ granted $/, 'target']]);
AUDIT_VERBS.CONCORDAT.roles = R_BY([[/-> $/, 'target'], [/ arrested $/, 'target'], [/ jailed $/, 'target']]);
// CONCORDAT ARREST <who> (<rank title>) arrested ...: the title is m.shown || m.title (thalmor.js:144), a rank name the
// faction's leader can rename (guilds.js editRanks), so text a player wrote; the group after the first party goes
// (privacy review P-R5). The template is unchanged, so its AUDIT_SITES pin stays
AUDIT_VERBS.CONCORDAT.cut = (text) => text.replace(/^(CONCORDAT ARREST (?:[^\s#()]+ ){0,5}?[^\s#()]+ #[A-Z0-9?]{4} \(profile -?\d{1,9}(?:, <@\d{1,22}>)?\)) \([^()]*\)/, '$1');
// CHAMPION <champion> in <zone> killed by <display(), ...>: Name #TAG parties with no profile (review C, recommended)
AUDIT_VERBS.CHAMPION.display = true;
AUDIT_VERBS.JAIL.roles = R_BY([[/ imprisoned $/, 'target'], [/ to $/, 'target']]);
AUDIT_VERBS.BEAST.roles = R_BY([[/ (?:to|from) $/, 'target']]);
// FRENZY <werewolf> for N s, first on <target> (frenzy.js): ids, numbers and fixed reasons only
clean_('FRENZY');
AUDIT_VERBS.FRENZY.roles = R_BY([[/ killed by $/, 'by'], [/ first on $/, 'target'], [/ for bringing down $/, 'target'], [/ \(GM $/, 'staff'], [/: staff $/, 'staff']]);
// GUARDS <who> placed|removed guard post <hold> #n, ran a jail test, brought down by the watch of <hold> (guards.js): ids, holds, numbers
clean_('GUARDS');
// APIARY <who> harvested <kind> <ref>: <items> (apiaries.js): ids and item names
clean_('APIARY');
AUDIT_VERBS.FEED.roles = R_BY([[/ asked $/, 'target'], [/ let $/, 'target'], [/ refused $/, 'target'], [/ feed on $/, 'target']]);
AUDIT_VERBS.ROPE.roles = R_BY([[/ cut $/, 'target'], [/ of $/, 'captor']]);
AUDIT_VERBS.STRUGGLE.roles = R_BY([[/ of $/, 'captor']]);
// SCHOOLS <giver> granted <target> N <school> level(s): a to b (<role>); <reason> (schools.js grant): the giver is a gift's "by"
// and the reason its reason, both staff-written (GIFT is excluded for them), so both go; the target and the levels stay
const WHO_RX = '(?:[^\\s#]+ ){0,5}[^\\s#]+ #[A-Z0-9?]{4} \\(profile -?\\d{1,9}(?:, <@\\d{1,22}>)?\\)';
const SCHOOLS_GRANT = new RegExp(`^SCHOOLS [\\s\\S]{1,200}? granted (${WHO_RX} \\d+ [^:]{1,60} levels?: \\d+ to \\d+ \\([^()]*\\));[\\s\\S]*$`);
AUDIT_VERBS.SCHOOLS.cut = (text) => text.replace(SCHOOLS_GRANT, 'SCHOOLS staff granted $1');
// SPELL TRIM ... shouts: <state>; by <by>: <why> (spells.js staff trim): by and why are written by staff in config, so they go
AUDIT_VERBS.SPELL.cut = (text) => text.replace(/^(SPELL TRIM [\s\S]*?, shouts: (?:untouched|none granted|grant kept \(it cannot be kept in part\)|grant taken off|grant could not be taken off)); by [\s\S]*$/, '$1');
// true when unquote(raw) lost the end of the line (a quote left unmatched takes the rest with it), or parseAudit's cap did:
// the line then ends in someone's words, so a cut that keeps the server's own end of the line has none to keep
const endLost = (raw) => { const s = String(raw || ''); return s.length >= 600 || s.replace(/"[^"\n]{0,600}"/g, '').includes('"'); };
// CONTRACT <official> set <hold> <price|budget|standing> <typed>: <sentence> (contracts.js setTerms): the chat passes every
// word typed after the term and setTerms reads only the first one or two, so the rest is an official's own words (review
// F2/PLA-2, 22 Oct): they go. The server's sentence stays (it says the tier, the gold or on/off): the one after the last
// ": <hold>", kept only when it is word for word one setTerms writes and the end of the line is not lost, so typed words with
// a colon, a fake sentence or a quote in them never pass. With no such sentence nothing after the term is kept, and a set
// line of any other shape keeps nothing at all
const CONTRACT_SET = new RegExp(`^(CONTRACT ${WHO_RX} set (.{1,60}?) (price|budget|standing))(?= )`);
const CONTRACT_SAID = {
  price: /^ now pays \d{1,12} gold a kill for (?:pests|dangerous beasts|deadly beasts) \(tier [123]; was \d{1,12}\)\. Contracts already taken keep their pay\.$/,
  budget: /^'s standing contracts may now commit \d{1,12} gold a week \(was \d{1,12}\); -?\d{1,12} is left this week\.$/,
  standing: /^ posts (?:standing contracts again|no standing contracts; those up now come down and their gold goes back to the treasury\. Contracts already taken run on)\.$/,
};
AUDIT_VERBS.CONTRACT.cut = (text, raw) => {
  const h = text.match(CONTRACT_SET);
  if (!h) return /^CONTRACT [\s\S]*?\) set /.test(text) ? 'CONTRACT' : text;
  const [, head, hold, term] = h;
  const at = text.lastIndexOf(`: ${hold}`);
  const said = at > h[0].length ? text.slice(at + 2 + hold.length) : '';
  return !endLost(raw) && CONTRACT_SAID[term].test(said) ? `${head}: ${hold}${said}` : head;
};
// CITIZEN STAFF <by> released|withdrew|could not release <name> ... (character <hex>...(staff release <id>[: <why>])) and
// CITIZEN STAFF <by>: staff release <id>[: <why>] found no citizenship of profile N to release (citizenship.js releaseTell):
// the by, the id and the why are what staff wrote in a config entry (citizenship.staffReleases), not an identity from who();
// releaseCheck only takes Discord mentions and ids out, so a by or a why shaped like a character made it a party and the line
// reached their post (PRIV-2, 23 Oct). The by becomes "staff" (the line's own word for an entry with none) and "a staff
// release" stands for the id and the why, as "a ticket" does in STAFFREF; the character's name, the hold, the character id
// and the profile stay. The by and the why are free text on both sides of those, so a line is kept only when it reads one
// way: its end is not lost (an unmatched quote or the 600 cap; audit() itself cuts a body at 500 and adds "...", which no
// shape below reads either), one shape fits, and its by can end at one place only (a by or a why that copies the line's own
// words keeps nothing). Any other CITIZEN STAFF line keeps nothing, but a Lead GM's revoke (CITIZEN STAFF <who()> revoked
// ...) names them as every staff line does and is not cut; its names hold no quote, so a by and a why quoted together never
// pass as one. Other CITIZEN lines are not cut, and the templates are unchanged, so their AUDIT_SITES pins stay
const CIT_NAME = '[^#():;"…]{1,64}';
const CIT_HOLD = '[^#():;"…]{1,60}';
const CIT_W = '[^\\s#():;"…]+';
const CIT_REVOKE = new RegExp(`^CITIZEN STAFF (?:${CIT_W} ){0,5}${CIT_W} #[A-Z0-9?]{4} \\(profile -?\\d{1,9}(?:, <@\\d{1,22}>)?\\) revoked the citizenship of ${CIT_HOLD} from ${CIT_NAME} \\(character [0-9a-f]{1,8}\\)$`);
const CIT_TAG = 'staff release [A-Za-z0-9._:-]{1,64}(?:: [\\s\\S]*)?';
const CIT_RELEASE = [
  [` released (${CIT_NAME}) from the citizenship of (${CIT_HOLD}) \\(character ([0-9a-f]{1,8}); ${CIT_TAG}\\)`, ' released $2 from the citizenship of $3 (character $4; a staff release)'],
  [` withdrew (${CIT_NAME})'s request for the citizenship of (${CIT_HOLD}) \\(character ([0-9a-f]{1,8}); ${CIT_TAG}\\)`, " withdrew $2's request for the citizenship of $3 (character $4; a staff release)"],
  [` could not release (${CIT_NAME}) from the citizenship of (${CIT_HOLD}) \\(character ([0-9a-f]{1,8})\\): it comes from a faction or court based there and lasts while that membership does \\(${CIT_TAG}\\)`,
    ' could not release $2 from the citizenship of $3 (character $4): it comes from a faction or court based there and lasts while that membership does (a staff release)'],
  [`: ${CIT_TAG} found no citizenship of profile (\\d{1,9}) to release`, ': a staff release found no citizenship of profile $2 to release'],
].map(([s, to]) => [new RegExp(`^CITIZEN STAFF ([\\s\\S]{1,200}?)${s}$`), new RegExp(`^CITIZEN STAFF ([\\s\\S]{1,200})${s}$`), `CITIZEN STAFF staff${to}`]);
// CITIZEN <name> (character <hex>) is an outlaw of <hold>[: citizenship taken], barred until <date> (<why>)[; still a citizen
// through a faction or court based there] (citizenship.js __dboCitizenOutlaw): its one caller, rebellion.js's failed rising,
// gives "the failed rising <name>", a name a player chose (charters.js checkName; REBELLION is excluded for it), so "a failed
// rising" stands for it, as the ELECTION void line's faction names go. The line names no party today, so it gives no event;
// the character, the hold, the date and both flags stay for the day it names the character with who(). Any other end, or a
// lost one, keeps the head only, and an outlaw line the cut cannot read keeps nothing
const CIT_OUTLAW = new RegExp(`^(CITIZEN ${CIT_NAME} \\(character [0-9a-f]{1,8}\\) is an outlaw of ${CIT_HOLD}(?:: citizenship taken)?, barred until \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC)(?: ([\\s\\S]*))?$`);
const CIT_OUTLAW_WHY = /^\((?:the failed rising [^#():;"…]{1,80}|a failed rising)\)((?:; still a citizen through a faction or court based there)?)$/;
AUDIT_VERBS.CITIZEN.cut = (text, raw) => {
  if (!text.startsWith('CITIZEN STAFF ')) {
    if (!/ is an outlaw of /.test(text)) return text;
    const o = text.match(CIT_OUTLAW);
    if (!o) return 'CITIZEN';
    const w = o[2] !== undefined && !endLost(raw) ? o[2].match(CIT_OUTLAW_WHY) : null;
    return w ? `${o[1]} (a failed rising)${w[1]}` : o[1];
  }
  if (endLost(raw)) return 'CITIZEN STAFF';
  if (CIT_REVOKE.test(text)) return text;
  const fit = CIT_RELEASE.filter(([first]) => first.test(text));
  if (fit.length !== 1) return 'CITIZEN STAFF';
  const [first, last, to] = fit[0];
  return text.match(first)[1].length === text.match(last)[1].length ? text.replace(first, to) : 'CITIZEN STAFF';
};
// STAFF ENCHANT <staff> enchanted <their own|<owner>'s> <piece>[ (named "<new>")]: <ench> [<hex> <edid>] <effects>
// (staffenchant.js apply): <piece> is the inventory entry's custom name first (nameOfEntry), a name a player or an earlier
// /enchant wrote, and it is not quoted (review F3, 22 Oct). It goes, as everywhere (the design keeps only that a piece is
// named; BODY is excluded for this): "piece" stands for it, and "(named "…")" still says a new name was given. The
// enchantment's name, form id, editor id and effects stay: the end of the line after its last ": " (record names and
// numbers, never a colon or a bracket), and only when the end of the line is not lost, so a name with a colon, a bracket, a
// fake end or a quote in it never passes. With no such end only who enchanted whose piece is kept; a line the cut cannot
// read keeps nothing. Other STAFF lines are not cut
const ENCHANT_HEAD = new RegExp(`^(STAFF ENCHANT ${WHO_RX} enchanted (?:their own|${WHO_RX}'s)) `);
const ENCHANT_END = /: ([A-Za-z0-9 ]{1,80} \[[0-9a-f]{1,8} [A-Za-z0-9_]{1,100}\](?: [A-Za-z0-9 .,-]{0,300})?)$/;
AUDIT_VERBS.STAFF.cut = (text, raw) => {
  if (!text.startsWith('STAFF ENCHANT ')) return text;
  const h = text.match(ENCHANT_HEAD);
  if (!h) return 'STAFF ENCHANT';
  const rest = text.slice(h[0].length);
  const e = endLost(raw) ? null : rest.match(ENCHANT_END);
  if (!e) return `${h[1]} piece`;
  return `${h[1]} piece${/ \(named "…"\)$/.test(rest.slice(0, e.index)) ? ' (named "…")' : ''}: ${e[1]}`;
};
// ELECTION STAFF <staff> struck the vote of <voter> in <hold> (round N): <reason> (citizenship.js strikeVote): the reason is
// everything the Lead GM typed after the voter in /strikevote, their own words, so it goes, and a character it names is
// never a party; who struck whose vote, where and in which round stay. A strike line the cut cannot read keeps nothing.
// ELECTION <hold>: the vote of <name> (profile N, round N) <is void|was already counted; staff review it>: left <faction> <t>
// before voting and joined <faction> <t> after (voidRejoin, the faction guard): a faction's name can be one a player chose (a
// charter's or a rising's, charters.js checkName; GUILD and REBELLION are excluded for them), so both names go and the two
// times stay; any other end, or a lost one, keeps the head only. Other ELECTION lines are not cut. The templates are
// unchanged, so their AUDIT_SITES pins stay
const ELECTION_STRUCK = new RegExp(`^(ELECTION STAFF ${WHO_RX} struck the vote of (?:(?:[^\\s#()]+ ){0,5}?[^\\s#()]+(?: #[A-Z0-9?]{4})?|profile \\d{1,9}) in [^():]{1,60} \\(round \\d{1,9}\\))(?=: |$)`);
const ELECTION_VOID = /^(ELECTION [^:]{1,60}: the vote of (?:[^\s#()]+ ){0,5}?[^\s#()]+ \(profile \d{1,9}, round \d{1,9}\) (?:is void|was already counted; staff review it))(?:: ([\s\S]*))?$/;
const ELECTION_WHY = /^left .{1,64}? (\d{1,6} h \d{1,2} m) before voting and joined .{1,64}? (\d{1,6} h \d{1,2} m) after$/;
AUDIT_VERBS.ELECTION.cut = (text, raw) => {
  if (/^ELECTION STAFF [\s\S]* struck the vote of /.test(text)) { const h = text.match(ELECTION_STRUCK); return h ? h[1] : 'ELECTION STAFF'; }
  if (!/^ELECTION [^:]{1,60}: the vote of /.test(text)) return text;
  const v = text.match(ELECTION_VOID);
  if (!v) return 'ELECTION';
  const w = v[2] !== undefined && !endLost(raw) ? v[2].match(ELECTION_WHY) : null;
  return w ? `${v[1]}: left a faction ${w[1]} before voting and joined one ${w[2]} after` : v[1];
};
// staffguard.js: a staff member's tool used on another player, as APPEARANCE and BOOST (the staff member acts, the character
// worked on is the target, so it is in both their posts)
//   STAFFREF <staff> <kind> on <target|profile N> under <ref> (target(), the gate of a rename, faction, office or citizenship
//   change) and STAFFREF <staff> works on <target> under <ref> for N minutes (/staffref): <ref> is "GM call #n" (an open
//   call, checked), "GM call #n (held)", or "ticket <id>", and a ticket's id is whatever the staff member typed after
//   ticket: or as /staffref's first word (parseRef, never checked against a ticket), so it goes and "a ticket" stands for
//   it. Who, the kind, whom, the call and the minutes stay; any other end, or a lost one, keeps who worked on whom only, and
//   a line the cut cannot read keeps nothing
//   STAFFGUARD <staff> used a staff tool (<kind>) on the staff account of <target> and STAFFCHAR <staff> marked|unmarked
//   <target> as a staff character: identities and the code's own words only (the name or #TAG typed after /staffchar only
//   finds the character)
clean_('STAFFREF STAFFGUARD STAFFCHAR');
const STAFFREF_HEAD = new RegExp(`^(STAFFREF ${WHO_RX} [a-z]{1,20} on (?:${WHO_RX}|profile -?\\d{1,9})) under `);
const STAFFREF_END = /^(?:(GM call #\d{1,9}(?: \(held\))?)|ticket \S{1,60})( for \d{1,6}(?:\.\d{1,3})? minutes)?$/;
AUDIT_VERBS.STAFFREF.cut = (text, raw) => {
  const h = text.match(STAFFREF_HEAD);
  if (!h) return 'STAFFREF';
  const e = endLost(raw) ? null : text.slice(h[0].length).match(STAFFREF_END);
  return e ? `${h[1]} under ${e[1] || 'a ticket'}${e[2] || ''}` : h[1];
};
AUDIT_VERBS.STAFFREF.roles = R_BY([[/ on $/, 'target']]);
AUDIT_VERBS.STAFFGUARD.roles = R_BY([[/ the staff account of $/, 'target']]);
AUDIT_VERBS.STAFFCHAR.roles = R_BY([[/ (?:marked|unmarked) $/, 'target']]);
// Duels: display() names in the reasons ("Rowan #PGDB yielded"); the one beaten, killed or challenged is the target
clean_('DUEL', { display: true, roles: R_BY([[/ (?:against|beat|killed|challenge to) $/, 'target']]) });
// Record, config and dungeon names, hex refs and numbers only
clean_('EBONY BOSS GOLD LEVERPUZZLE SCRIBE WORLDEDIT');
AUDIT_VERBS.HOUSING = { cls: 'clean', roles: R_BY([[/ to $/, 'target']]) };
AUDIT_VERBS.PARTAKE = { cls: 'clean', roles: R_BY([[/ (?:ate of|asked|allowed) $/, 'target']]) };
clean_('TRAPS', { display: true });

// X: excluded (no event from the audit tap; a direct hook covers the action, without the text)
excluded('JOIN LEAVE', 'the session hooks');
excluded('PIGEON', 'the letter: social.letter comes from the A2 hook');
excluded('BODY', 'items by custom name: the A2 loot hook');
excluded('ANNOUNCE', 'broadcast text: the command wrapper');
excluded('THALMOR', 'dossier notes: the A2 dossier hook');
excluded('SCHEDULE', 'staff-written reasons: the command wrapper');
excluded('GIFT', 'staff-written reasons');
excluded('ROLENAME', 'staff-written titles: the command wrapper');
excluded('PLACE', 'staff-written set names: the command wrapper');
excluded('LEDGER', 'ledger names: the command wrapper');
excluded('ORPHAN', 'staff only');
excluded('DISCORD', 'roles: session.perm');
// anticheat.js: a Lead GM's /anticheat off|on <part> (the part and the word from fixed lists) is clean; the daily counts
// name no player
clean_('ANTICHEAT', { display: true });
excluded('ANTICHEAT-DAILY', 'counts per kind only, no player');
excluded('WWBREAKER VLBREAKER', 'the beastform breaker names who dropped');
excluded('REMOTE', 'the remote staff console (console.js): staff command text and a Discord handle; the command wrapper records the run (route console)');
// Lines that carry words a player or staff member wrote, with no parser yet: nothing from the audit tap, as before they were
// classified (a parser can bring their parties in later)
excluded('WRITTEN', 'a written work\'s title, quoted');
excluded('EVENT', 'the event announcement\'s text');
excluded('GUILD', 'player guild names, a GM\'s reason');
excluded('BOUNTY', 'the reason a ruler gave for a bounty');
excluded('FACTION-RANK FACTION-MERGE', 'config-run faction upkeep at load (guilds.js addRanks, mergeRosters): faction names, rank titles and stored member names, no who()');
excluded('EXPOSURE', 'staff only: who was seen changing into a beast, its witnesses and a GM\'s reason');
excluded('LEADERSHIP', 'staff only: a double still seated days after the step-down notice; its seats are rank titles a faction\'s leader or a Lead GM renames, player-named charters and risings, and office names staff can rename');
excluded('REBELLION', 'player-named risings and a secret petition\'s code');
excluded('REFERRAL', 'staff only: profiles by number, staff reasons, PC sharing');
excluded('SHOP', 'business names and the failure reasons');
excluded('BURGLARY FENCE', 'home labels, raid evidence and reasons');

// S: parsed. Only anchored groups survive: parties (resolved in the game), ops from fixed tables, numbers, hex refs.
// The court, said by staff or an official: office titles are never kept (rolenames can make them staff-written), nor
// zone names
const COURT = [[/ appointed /, 'appoint'], [/ dismissed .* as /, 'dismiss'], [/ offered .* the post of /, 'offer'], [/ withdrew the offer /, 'withdraw'], [/ declined the post /, 'decline']];
const courtParse = (text, P) => {
  const op = opOf(text, COURT);
  if (!op || !P.length) return null;
  if (op === 'decline' || op === 'withdraw') return [ev('social.court', 0, { op })];
  return [ev('social.court', 0, { op }, rest(P, 0, 'target'), { mirror: true })];
};
// The server's adminLog ("GM profile N (tier) <verb> ... <Name> (profile M)"): the verb from this table, the IP never read
const ADMINLOG = [[/^profile \d+(?: \([a-z]+\))? was refused /, 'refused'], [/ teleported to location /, 'tp_location'], [/ teleported to npc zone /, 'tp_zone'],
  [/ teleported to /, 'tp'], [/ summoned /, 'summon'], [/ kicked /, 'kick'], [/ killed /, 'kill'], [/ deleted the character /, 'delete_character'],
  [/ lifted the ban /, 'unban'], [/ banned /, 'ban'], [/ granted \d+ mastery hour/, 'mastery_hours'], [/ reset the craft and hours /, 'mastery_reset'],
  [/ renamed /, 'rename'], [/ set \S+ to tier \d+ for /, 'mastery_tier'], [/ dropped \S+ for /, 'mastery_drop'], [/ set \S+ to \d+ for /, 'school_level'],
  [/ spawned \d+x /, 'spawn'], [/ gave the \S+ disease /, 'disease'], [/ ran beast form /, 'beast'], [/ gave every shout /, 'shouts'], [/ gave /, 'give'],
  [/ added npc zone /, 'zone_add'], [/ deleted npc zone /, 'zone_delete'], [/ reset npc zone /, 'zone_reset'], [/ turned mode /, 'mode']];
const GM_LINES = [[/ kicked .* via \/kick$/, 'kick'], [/ opened chargen for /, 'chargen'], [/ renamed /, 'rename'], [/ teleported to .* via \/tp$/, 'tp'],
  [/ set hunger of /, 'sethunger'], [/ wiped \d+ character/, 'wipechars'], [/ cleared the .* body breaker for /, 'beast_breaker'],
  [/ removed (?:vampirism|lycanthropy) from /, 'remove_supernatural'], [/ cured the .* fever of /, 'cure_fever']];
const adminLogParse = (text) => {
  // the IP form of a lifted ban ("/ ip <addr>") is cut before anything is read
  const t = text.replace(/ \/ ip .*$/i, '').replace(/ ip [0-9a-f.:\[\]]+.*$/i, '').slice(3);
  const staff = byProfile(num((t.match(/^profile (\d{1,9})/) || [])[1]));
  const target = byProfile(num((t.replace(/^profile \d+(?: \([a-z]+\))?/, '').match(/\(profile (\d{1,9})/) || [])[1]));
  if (!staff) return [];
  const action = opOf(t, ADMINLOG) || 'panel';
  const amount = action === 'mastery_hours' ? num((t.match(/ granted (\d+) mastery/) || [])[1]) : action === 'spawn' ? num((t.match(/ spawned (\d+)x /) || [])[1]) : undefined;
  const out = [ev('staff.action', staff, { action, via: 'panel', outcome: action === 'refused' ? 'refused' : 'ok', params: amount !== undefined ? { amount } : undefined }, target ? [[target, 'target']] : [], { mirror: !!target })];
  if (target && action === 'kick') out.push(ev('session.kick', target, { kind: 'panel' }, [[staff, 'staff']]));
  if (target && action === 'ban') out.push(ev('session.ban', target, { kind: 'ban' }, [[staff, 'staff']]));
  if (target && action === 'unban') out.push(ev('session.ban', target, { kind: 'unban' }, [[staff, 'staff']]));
  if (target && action === 'summon') out[0].travel = { party: target, reason: 'summon' };
  if (action === 'tp' || action === 'tp_location' || action === 'tp_zone') out[0].travel = { party: staff, reason: 'panel_tp' };
  return out;
};
parsed('GM', {
  parse: (text, P) => {
    if (/^GM profile \d+/.test(text)) return adminLogParse(text);
    if (/ \/system: /.test(text)) return P.length ? [ev('staff.world', 0, { action: 'broadcast' })] : [];
    if (/ admin panel: /.test(text)) return [];   // the packet tap has these, with the fields allowed
    const court = courtParse(text, P);
    if (court) return court;
    if (!P.length) return [];
    if (/ set the NPC spawn placement | set the split repair | set the drift switch /.test(text)) return [ev('staff.world', 0, { action: 'drift' })];
    if (/ set .* remote body /.test(text)) return [ev('staff.world', 0, { action: 'diag' })];
    if (/ ended the lease on /.test(text)) return [ev('staff.world', 0, { action: 'dungeon' })];
    const action = opOf(text, GM_LINES);
    if (!action) return [];
    const f = { action, via: 'command', outcome: 'ok' };
    if (action === 'sethunger') f.params = { amount: num((text.match(/ to (\d+)$/) || [])[1]) };
    if (action === 'wipechars') {
      f.params = { count: num((text.match(/ wiped (\d+) /) || [])[1]) };
      const t = byProfile(num((text.match(/ of profile (\d{1,9})/) || [])[1]));
      return [ev('staff.action', 0, f, t ? [[t, 'target']] : [], { mirror: !!t })];
    }
    // /rename: the target is "(#TAG, profile N)" after the names; the names come from char.rename
    if (action === 'rename') {
      const m = text.match(/\(#([A-Z0-9]{4}), profile (\d{1,9})\)$/);
      const t = m ? { tag: m[1], profile: Number(m[2]) } : null;
      return [ev('staff.action', 0, f, t ? [[t, 'target']] : [], { mirror: !!t })];
    }
    const out = [ev('staff.action', 0, f, rest(P, 0, 'target'), { mirror: P.length > 1 })];
    if (action === 'kick' && P.length > 1) out.push(ev('session.kick', 1, { kind: 'command' }, [[0, 'staff']]));
    if (action === 'tp') out[0].travel = { party: 0, reason: 'gm_goto' };
    return out;
  },
});
parsed('OFFICIAL', { parse: (text, P) => courtParse(text, P) || [] });
// The finishing blow and a permadeath (clean lines in Appendix A): kept as the combat types they are, the victim first
parsed('FINISHED', {
  roles: R_BY([[/ by $/, 'by']]),
  parse: (text, P, raw, roles) => { const by = roles.indexOf('by'); return P.length ? [ev('combat.finish', 0, {}, by > 0 ? [[by, 'by']] : [])] : []; },
});
// BANK and TEACH name factions by id or name, and a chartered faction's id is a slug of its player-chosen name
// (charters.js slug): kept as structured events without them
parsed('BANK', {
  parse: (text, P) => {
    if (!P.length) return [];
    let m = text.match(/ (deposited|withdrew) (\d{1,9}) gold \(balance (\d{1,12})\)$/);
    if (m) return [ev('item.bank', 0, { op: m[1] === 'deposited' ? 'deposit' : 'withdraw', gold: Number(m[2]), balance: Number(m[3]) })];
    m = text.match(/ paid (\d{1,9}) gold into the /);
    if (m) return [ev('item.bank', 0, { op: 'treasury', gold: Number(m[1]) })];
    // Vaults (bank.js, pinned 16 Oct after the bank review): item names come from the game's records, never from players
    const Z = '([a-z0-9_-]{1,32})';
    if ((m = text.match(new RegExp(` paid (\\d{1,9}) gold \\(\\d{1,9} banked, \\d{1,9} carried\\) to ${Z} for (renting|vault arrears|a week)`))))
      return [ev('item.bank', 0, { op: m[3] === 'renting' ? 'vault_rent' : m[3] === 'a week' ? 'vault_fee' : 'vault_arrears', gold: Number(m[1]), zone: m[2] })];
    if ((m = text.match(new RegExp(` rents a ([a-z]{1,24}) vault \\(\\d{1,6} weight\\) in ${Z}(?:, was [a-z]{1,24})?, paid (\\d{1,9})$`))))
      return [ev('item.bank', 0, { op: 'vault_open', tier: m[1], zone: m[2], gold: Number(m[3]) })];
    if ((m = text.match(new RegExp(` owes (\\d{1,9}) gold for the ${Z} vault \\((\\d{1,4}) week`))))
      return [ev('item.bank', 0, { op: 'vault_owed', gold: Number(m[1]), zone: m[2], n: Number(m[3]) })];
    if ((m = text.match(new RegExp(` warned of the ${Z} seizure `)))) return [ev('item.bank', 0, { op: 'vault_warn', zone: m[1] })];
    if ((m = text.match(new RegExp(` gave up the ([a-z]{1,24}) vault in ${Z}$`)))) return [ev('item.bank', 0, { op: 'vault_end', tier: m[1], zone: m[2] })];
    if ((m = text.match(new RegExp(` stored (\\d{1,9})x (.{1,64}?) \\(([0-9a-f]{1,8})\\) in ${Z} \\(`))))
      return [ev('item.bank', 0, { op: 'vault_store', n: Number(m[1]), i: m[2], b: m[3], zone: m[4] })];
    if ((m = text.match(new RegExp(` took (\\d{1,9})x (.{1,64}?) \\(([0-9a-f]{1,8})\\) out of ${Z}$`))))
      return [ev('item.bank', 0, { op: 'vault_take', n: Number(m[1]), i: m[2], b: m[3], zone: m[4] })];
    if ((m = text.match(new RegExp(` ${Z}: (\\d{1,9})x (.{1,64}?) \\(([0-9a-f]{1,8})\\) at \\d{1,9} = (\\d{1,12})$`))) && / SEIZED /.test(text))
      return [ev('item.bank', 0, { op: 'vault_seize_item', zone: m[1], n: Number(m[2]), i: m[3], b: m[4], gold: Number(m[5]) })];
    if ((m = text.match(new RegExp(` ${Z}: ([a-z]{1,24}) vault, \\d{1,4} kind\\(s\\) of goods sold for \\d{1,12} gold, (\\d{1,12}) to `))) && / SEIZED /.test(text))
      return [ev('item.bank', 0, { op: 'vault_seize', zone: m[1], tier: m[2], gold: Number(m[3]) })];
    if ((m = text.match(/ STAFF took (\d{1,9})x ([0-9a-f]{1,8}) from the vaults of /))) return [ev('item.bank', 0, { op: 'vault_staff_take', n: Number(m[1]), b: m[2] })];
    if ((m = text.match(new RegExp(` RESTORED .* ${Z}: seizure `)))) return [ev('item.bank', 0, { op: 'vault_restore', zone: m[1] })];
    // The gem counter and the gem fee of big deeds (bank.js, Nat 25 Oct): gem names come from the game's records; a deed's reason is never read
    if (/^BANK GEMS /.test(text)) {
      if ((m = text.match(new RegExp(` sold (\\d{1,9})x (.{1,64}?) \\(([0-9a-f]{1,8})\\) to ${Z} for (\\d{1,12}) gold from its treasury`))))
        return [ev('item.bank', 0, { op: 'gem_sell', n: Number(m[1]), i: m[2], b: m[3], zone: m[4], gold: Number(m[5]) })];
      if ((m = text.match(new RegExp(` bought (\\d{1,9})x (.{1,64}?) \\(([0-9a-f]{1,8})\\) from ${Z} for (\\d{1,12}) gold `))))
        return [ev('item.bank', 0, { op: 'gem_buy', n: Number(m[1]), i: m[2], b: m[3], zone: m[4], gold: Number(m[5]) })];
      if (/ paid \d{1,9}x /.test(text)) return [ev('item.bank', 0, { op: 'gem_fee' })];
      // The retune's limits (Nat, 25 Oct): a sale refused by the daily cap (character or account) or the hold's reserve
      if ((m = text.match(new RegExp(` refused at ${Z}: (the daily cap|the account's daily cap|the treasury reserve) `))))
        return [ev('item.bank', 0, { op: 'gem_refused', zone: m[1], why: m[2] === 'the treasury reserve' ? 'reserve' : m[2] === 'the daily cap' ? 'cap' : 'account_cap' })];
      return [];
    }
    return [];
  },
});
parsed('TEACH', {
  roles: R_BY([[/ to $/, 'student']]),
  cut: / at .*$/,
  parse: (text, P, raw, roles) => {
    const s = roles.indexOf('student');
    if (!P.length || s < 0) return [];
    const what = (text.match(/ taught [0-9a-f]{1,8}:\S+ (.{1,64}?) to /) || [])[1];
    return [ev('char.knowledge', 0, { kind: 'teach', what, op: 'taught' }, [[s, 'student']])];
  },
});
parsed('PERMADEATH', { parse: (text, P) => (P.length ? [ev('combat.death_final', 0, { kind: 'permadeath' })] : []) });
// PERM: a staff tier or the Discord roles changed (the role ids are never kept)
const TIERS_ = ['senior', 'developer', 'leadgm', 'gm', 'trialgm', 'none'];
parsed('PERM', {
  parse: (text, P) => {
    if (!P.length) return [];
    const m = text.match(/ admin tier ([a-z]{2,10}) -> ([a-z]{2,10})$/);
    if (m) return [ev('session.perm', 0, { tierFrom: TIERS_.includes(m[1]) ? m[1] : undefined, tierTo: TIERS_.includes(m[2]) ? m[2] : undefined })];
    return / discord roles changed/.test(text) ? [ev('session.perm', 0, { rolesChanged: true })] : [];
  },
});
parsed('NAME', {
  // NAME profile N renamed "<old>" -> "<new>" (names are identity); the refused names (raw typed text) are dropped
  parse: (text, P, raw) => {
    if (/ refused /.test(text)) return [];
    let m = raw.match(/^NAME profile (\d{1,9}) renamed "([^"\n]{1,48})" -> "([^"\n]{1,48})"$/);
    if (m) return [ev('char.rename', { profile: Number(m[1]), name: m[3] }, { from: m[2], to: m[3] })];
    m = raw.match(/ named themselves "([^"\n]{1,48})" \(was "([^"\n]{0,48})", [a-z ]{1,24}\)$/);
    if (m && P.length) return [ev('char.rename', 0, { from: m[2] || undefined, to: m[1] })];
    return [];
  },
});
parsed('BOARD', {
  // a notice: only the poster's profile and the gold survive; the note (": "...) and a mask's name are cut
  cut: /: "|\(as "|: .*$/,
  parse: (text) => {
    const pid = byProfile(num((text.match(/\[profile (\d{1,9})\]/) || [])[1]));
    return pid ? [ev('item.fee', pid, { what: 'board_post', gold: gold(text, /(\d{1,9}) gold/) })] : [];
  },
});
parsed('GMCALL', {
  // the call text, the close note and the coordinates are cut
  cut: /: .*$| \([0-9a-f]{1,8}:[^)]*\)/,
  parse: (text, P) => {
    const n = num((text.match(/^GMCALL #(\d{1,9})/) || [])[1]);
    const op = opOf(text, [[/ opened by /, 'opened'], [/ added$/, 'added'], [/ withdrawn by /, 'withdrawn'], [/ taken by /, 'taken'], [/ went to /, 'went_to'],
      [/ released by /, 'released'], [/ closed by /, 'closed']]);
    if (!op || !P.length) return [];
    const ref = n !== undefined ? `call${n}` : undefined;
    if (op === 'opened' || op === 'added' || op === 'withdrawn') return [ev('social.report', 0, { kind: op === 'opened' ? 'gmcall' : op === 'added' ? 'gmcall_add' : 'gmcall_cancel', ref, op })];
    return [ev('staff.action', 0, { action: `gmcall_${op}`, via: 'command', outcome: 'ok' }, rest(P, 0, 'target'), { mirror: P.length > 1 })];
  },
});
parsed('COMMISSION', {
  // the work text is cut
  cut: /: .*$/,
  parse: (text, P) => {
    const id = num((text.match(/#(\d{1,9})/) || [])[1]);
    const op = opOf(text, [[/ posted #/, 'post'], [/ took #/, 'take'], [/ marked #\d+ done/, 'done'], [/ refused the work /, 'refuse'], [/ ruled #/, 'rule'],
      [/ took down #/, 'cancel'], [/ abandoned #/, 'abandon'], [/ expired untaken/, 'expire'], [/ was never judged/, 'unjudged']]);
    if (!op || !P.length) return [];
    const reward = op === 'post' ? gold(text, / (\d{1,9}) gold held/) : gold(text, /(\d{1,9}) gold/);
    return [ev('social.commission', 0, { op, id, reward })];
  },
});
parsed('CHARTER', {
  // numbers, ops, fees and parties only: faction names, pitches, edits, flags and reasons are cut
  cut: /: .*$| \(flags: .*$| \(\S+\)$/,
  parse: (text, P) => {
    const number = num((text.match(/^CHARTER #(\d{1,9})/) || [])[1]);
    const op = opOf(text, [[/ drafted by /, 'draft'], [/ pitch set by /, 'pitch_set'], [/ seat (?:cleared|set) by /, 'seat'], [/ kind set by /, 'kind'], [/ invited /, 'invite'],
      [/ confirmed as /, 'confirm'], [/ left as a co-founder/, 'leave'], [/ submitted by /, 'submit'], [/ withdrawn by /, 'withdraw'], [/ approved by /, 'approve'],
      [/ denied by /, 'deny'], [/ edited by /, 'edit'], [/ dissolved by /, 'dissolve'], [/^CHARTER disband of .* asked by /, 'disband_ask'],
      [/^CHARTER disband of .* approved by /, 'disband_ok'], [/^CHARTER disband of .* denied by /, 'disband_no'], [/^CHARTER paid /, 'paid']]);
    if (!op || !P.length) return [];
    const g = op === 'paid' ? gold(text, /paid (\d{1,9}) gold/) : undefined;
    return [ev('social.charter', 0, { op, number, gold: g }, rest(P, 0, op === 'invite' ? 'target' : 'other'), { mirror: op === 'invite' })];
  },
});
parsed('DISCIPLINE', {
  // DISCIPLINE <kind> #n on <target> (profile N)... by <staff>: <reason>; the reason is cut
  // a refusal keeps its end, 'suspended until <date> (#n)' or (from 25 Oct) 'banned permanently (#n)': nobody's words are in it
  cut: /: (?!suspended until|banned permanently).*$| \(config .*$/,
  roles: R_BY([[/ on $/, 'target'], [/ by $/, 'staff'], [/^DISCIPLINE refused $/, 'target'], [/^DISCIPLINE $/, 'target']]),
  parse: (text, P, raw, roles) => {
    if (/^DISCIPLINE refused /.test(text)) return P.length ? [ev('session.ban', 0, { kind: 'refused', entry: num((text.match(/\(#(\d{1,9})\)/) || [])[1]) })] : [];
    if (/ has \d+ strikes in \d+ days/.test(text)) return P.length ? [ev('session.ban', 0, { kind: 'review' })] : [];
    const m = text.match(/^DISCIPLINE (warn|strike|suspend|ban|lift|overturn)\b \S*#(\d{1,9}) on /);
    if (!m) return [];
    const t = roles.indexOf('target'), s = roles.indexOf('staff');
    if (t < 0) return [];
    const hours = num((text.match(/ for (\d{1,5}) ?h\b/) || [])[1]);
    return [ev('session.ban', t, { kind: m[1], entry: Number(m[2]), hours }, s >= 0 ? [[s, 'staff']] : [])];
  },
});
// BAN Discord <ban|unban> (<via>) on <target> (profile N)... by <moderator>: <reason> (gamemode.js __dboDiscordBan); the reason is cut
parsed('BAN', {
  cut: /: .*$/,
  roles: R_BY([[/ on $/, 'target'], [/ by $/, 'staff']]),
  parse: (text, P, raw, roles) => {
    const m = text.match(/^BAN Discord (ban|unban) \((?:guild ban|ban role)\) on /);
    const t = roles.indexOf('target'), s = roles.indexOf('staff');
    if (!m || t < 0) return [];
    return [ev('session.ban', t, { kind: m[1] }, s >= 0 ? [[s, 'staff']] : [])];
  },
});
// COURIER and POST keep their item lists: post.js itemsText names items from the record only (nameOfItem)
parsed('COURIER', {
  roles: R_BY([[/ robbed from $/, 'victim'], [/ by $/, 'robber']]),
  parse: (text, P, raw, roles) => {
    const job = num((text.match(/#(\d{1,9})/) || [])[1]);
    const items = itemsFromText((text.match(/: (\d+x .*?)(?: \(worth |, paid |; insured | and \d+ gold| back to |$)/) || [])[1]);
    if (/ robbed from /.test(text)) {
      const v = roles.indexOf('victim'), r = roles.indexOf('robber');
      if (r < 0) return [];
      return [ev('item.theft', r, { kind: 'courier_robbed', outcome: 'took', items }, v >= 0 ? [[v, 'victim']] : [])];
    }
    const op = opOf(text, [[/ posted #/, 'posted'], [/ took #/, 'took'], [/ delivered #/, 'delivered'], [/ opened the robbed parcel /, 'opened'],
      [/ insurance paid /, 'insured'], [/ insurance \(\d+\) not paid/, 'insured'], [/ are lost$| the goods are lost$/, 'lost'], [/ cleared #/, 'cleared'], [/ back to /, 'returned'], [/ reached /, 'reached']]);
    if (!op || !P.length) return [];
    const pay = gold(text, /, pay (\d{1,9})|\(pay (\d{1,9})|, paid (\d{1,9})$/);
    return [ev('item.courier', 0, { op, job, items, gold: gold(text, /(\d{1,9}) gold/), pay }, rest(P, 0, 'other'))];
  },
});
parsed('POST', {
  // "from <m.from>" is a signature, maybe forged: cut
  cut: / from .*$/,
  parse: (text, P) => {
    if (!P.length) return [];
    // a letter burned with a parcel its reader cannot carry (gamemode.js updateLetter) is no parcel collected
    if (/ burned a letter /.test(text)) return [];
    const sent = / sent /.test(text);
    const items = itemsFromText((text.match(/ (?:sent|collected) (?:.*? )?(?:\d+ gold, )?(\d+x .*?)(?: \(tax |$)/) || [])[1]);
    return [ev('item.mail', 0, { op: sent ? 'parcel_sent' : 'parcel_collected', gold: gold(text, /(\d{1,9}) gold/), items, tax: gold(text, /\(tax (\d{1,9})/) }, sent ? rest(P, 0, 'recipient') : [], { mirror: sent })];
  },
});
parsed('ROBBERY', {
  // the key's name (H.ringSteal: a player-chosen property name) is cut; only that a key went is kept
  cut: /; key .*$/,
  roles: R_BY([[/robbed $/, 'victim'], [/-> $/, 'victim'], [/ demands from $/, 'victim']]),
  parse: (text, P, raw, roles) => {
    const r = roles.indexOf('actor'), v = roles.indexOf('victim');
    if (r < 0) return [];
    const others = v >= 0 ? [[v, 'victim']] : [];
    if (/ demands from /.test(text)) return [ev('item.theft', r, { kind: 'robbery', outcome: 'demanded' }, others, { link: 'robbery_demand' })];
    if (/ robbed /.test(text)) {
      const items = namesFromText((text.match(/; items \[([^\]]{0,600})\]/) || [])[1]);
      return [ev('item.theft', r, { kind: 'robbery', outcome: 'took', gold: gold(text, /: (\d{1,9}) gold of/), items, keyTaken: /; key /.test(raw) || undefined, parcel: /; a courier parcel/.test(text) || undefined }, others, { link: 'robbery' })];
    }
    const outcome = /accepted, but the robber had left|the robber left before/.test(text) ? 'left' : /no answer|no panel/.test(text) ? 'timeout' : 'refused';
    return [ev('item.theft', r, { kind: 'robbery', outcome }, others)];
  },
});
parsed('RAID', {
  // faction names (chartered factions have player-chosen names) are never read; the home's owner comes from its ref
  parse: (text, P) => {
    const m = text.match(/^RAID break-in by .*? at (?:container ([0-9a-f]{1,8}) of )?home ([0-9a-f]{1,8}) \(.*?\): (.*)$/);
    if (m && P.length) {
      const what = m[3] === 'nothing' ? '' : m[3];
      return [ev('item.theft', 0, { kind: 'raid', outcome: what ? 'took' : 'nothing', gold: gold(what, /^(\d{1,9}) gold/), items: namesFromText(what), home: m[2], container: m[1] }, [], { homeOwner: m[2] })];
    }
    if (/ raids /.test(text) && P.length) return [ev('social.realm', 0, { op: 'raid_start' })];
    return [];
  },
});
parsed('THEFT', {
  // the item label is entry.name first (a custom name, pickpocket.js:90): the parties and the outcome only; the item comes
  // from the A2 steal() hook
  parse: (text, P) => {
    if (P.length < 2) return [];
    const outcome = / was caught /.test(text) ? 'caught' : / found nothing /.test(text) ? 'nothing' : / picked /.test(text) ? 'took' : null;
    if (!outcome) return [];
    return [ev('item.theft', 0, { kind: 'pickpocket', outcome, handOverFailed: / HAND-OVER FAILED/.test(text) || undefined }, [[P.length - 1, 'victim']], { pickpocket: true })];
  },
});
parsed('WARBAND', {
  // the side name (typed by a GM) is cut
  cut: / fights for .*$| for (?!\S+ NPC).*$| charges for .*$/,
  parse: (text, P) => {
    if (!P.length) return [];
    if (/ set \d+ NPC\(s\) on /.test(text) && P.length > 1) return [ev('staff.action', 0, { action: 'warband_attack', via: 'command', outcome: 'ok', params: { count: num((text.match(/ set (\d+) NPC/) || [])[1]) } }, [[1, 'target']], { mirror: true })];
    return [ev('staff.world', 0, { action: 'raid', n: num((text.match(/ (?:raised|settled|of|dismissed|cleared) (\d{1,5})/) || [])[1]) })];
  },
});
parsed('WEAPONRACK', {
  // the weapon's name in the text is not kept (A2 gives it from the record)
  parse: (text, P) => {
    if (!P.length) return [];
    const op = opOf(text, [[/ racked /, 'racked'], [/^WEAPONRACK hold manager /, 'manager_took'], [/ took /, 'took'], [/^WEAPONRACK returned /, 'returned']]);
    if (!op) return [];
    return [ev('item.rack', 0, { op, home: (text.match(/ in home ([0-9a-f]{1,8})/) || [])[1] })];
  },
});
parsed('KEYRING', {
  // the key's name (a player-chosen property name) is quoted, so unquote() has already taken it
  parse: (text, P) => {
    if (!P.length) return [];
    const op = opOf(text, [[/ offered /, 'offered'], [/ accepted /, 'accepted'], [/ cut a key to /, 'cut'], [/ took back /, 'taken_back']]);
    if (!op) return [];
    return [ev('item.key', 0, { op, house: op === 'cut' || op === 'taken_back' ? (text.match(/ ([0-9a-f]{1,8})$/) || [])[1] : undefined }, op === 'offered' ? rest(P, 0, 'target') : [], { mirror: op === 'offered' })];
  },
});
parsed('BUSINESS', {
  // the business name is never read: the op, the claim and the gold
  parse: (text, P) => {
    if (!P.length) return [];
    const op = opOf(text, [[/ collected \d+ gold /, 'collect'], [/: chest [0-9a-f]+ for rent /, 'chest'], [/ (?:extended|rented) chest /, 'rent'], [/ placed .* ledger /, 'ledger'],
      [/ closed .*\(claim /, 'close'], [/ the previous record .* was archived/, 'archive'], [/ opened /, 'open']]);
    if (!op) return [];
    const g = op === 'collect' ? gold(text, / collected (\d{1,9}) gold/) : op === 'rent' ? gold(text, /, (\d{1,9}) gold/) : op === 'chest' ? gold(text, / at (\d{1,9}) gold a day/) : undefined;
    return [ev('social.business', 0, { op, claim: (text.match(/claim ([0-9a-f]{1,8})/) || [])[1], gold: g })];
  },
});
parsed('PROPERTY', {
  parse: (text, P) => {
    const op = opOf(text, [[/ acts as the fief holder /, 'fief'], [/ listed /, 'list'], [/ took .* off the market/, 'unlist'], [/ asked to rent /, 'interest'], [/ offered /, 'offer'],
      [/ rented /, 'rent'], [/ up for sale /, 'sell'], [/the treasury of .* took /, 'treasury'], [/ bought /, 'buy'], [/ paid \d+ rent /, 'pay'], [/ no longer holds rented /, 'lapsed'],
      [/ left .*; deposit returned/, 'leave'], [/ evicted /, 'evict'], [/ a week's grace /, 'grace'], [/ reminded /, 'remind'], [/ fell overdue/, 'overdue']]);
    if (!op || !P.length) return [];
    return [ev('social.property', 0, { op, gold: gold(text, / (?:for|at) (\d{1,9}) (?:gold|deposit)| paid (\d{1,9}) rent/) })];
  },
});
parsed('FACTION', {
  // faction names (charter-made, player-chosen) and rank titles are never read: the op and the parties
  parse: (text, P) => {
    if (!P.length) return [];
    const op = opOf(text, [[/ invited /, 'invite'], [/ joined /, 'join'], [/ removed .* from /, 'kick'], [/ named .* of /, 'leader'], [/ made .* of /, 'rank'],
      [/ left /, 'leave'], [/ added .* to /, 'join'], [/ set the ranks of /, 'ranks'], [/ (?:cleared|set) the storage of /, 'storage'],
      [/ (?:shared|unshared|marked|unmarked) /, 'hall'], [/ by challenge$/, 'challenge']]);
    if (!op) return [];
    const role = op === 'invite' || op === 'rank' || op === 'leader' || (op === 'join' && / added /.test(text)) || op === 'challenge' ? 'target' : 'other';
    return [ev('social.faction', 0, { op }, rest(P, 0, role), { mirror: role === 'target' })];
  },
});
parsed('FACTION-LIMIT', {
  parse: (text, P) => {
    if (!P.length) return [];
    // "OVERRIDE by <who>: <target> into ..." names the staff member as text; the target is the party
    if (/ OVERRIDE by /.test(text)) return [ev('social.faction', 0, { op: 'override' })];
    return [ev('social.faction', 0, { op: 'override' }, rest(P, 0, 'target'))];
  },
});
parsed('WAR', {
  // leader actions on the actor's post; faction names and territory names are never read
  roles: R_BY([[/ killed $/, 'victim']]),
  parse: (text, P, raw, roles) => {
    // a war's id is a number (realm.js nextId)
    const war = (text.match(/^WAR (\d{1,9})[: ]/) || [])[1];
    if (/ killed .* in a war to the death/.test(text)) {
      const k = roles.indexOf('actor'), v = roles.indexOf('victim');
      if (k < 0) return [];
      return [ev('social.realm', k, { op: 'war_kill', war }, v >= 0 ? [[v, 'victim']] : [], { mirror: true })];
    }
    if (!P.length) return [];
    const op = opOf(text, [[/ offers a \d+-week peace treaty/, 'treaty_offer'], [/ accepted the treaty/, 'treaty_accept'], [/ refused the treaty/, 'treaty_refuse'],
      [/ declared by /, 'war_declared'], [/ accepted a war to the death/, 'death_accept'], [/ refused a war to the death/, 'death_refuse'], [/ offers peace /, 'peace_offer'],
      [/ refused peace/, 'peace_refuse'], [/^WAR capital of /, 'capital']]);
    if (!op) return [];
    const warId = /^treaty|^capital/.test(op) ? undefined : war;
    return [ev('social.realm', 0, { op, war: warId, weeks: num((text.match(/ a (\d{1,3})-week /) || [])[1]), gold: gold(text, /\((\d{1,9}) gold from /) })];
  },
});
parsed('REALM', { parse: (text, P) => (P.length && / made .* the capital of /.test(text) ? [ev('social.realm', 0, { op: 'capital' })] : []) });
parsed('SUPERNATURAL', {
  parse: (text, P) => {
    if (!P.length) return [];
    if (/^SUPERNATURAL GM /.test(text)) {
      if (/ set the standing feeding bite /.test(text)) return [ev('staff.world', 0, { action: 'feedpair' })];
      if (P.length < 2) return [];
      if (/ cleared the rite wait for /.test(text)) return [ev('char.supernatural', 1, { kind: 'rite', op: 'cleared' }, [[0, 'staff']])];
      // /curse <who> <what>: what only from the command's own list (supernatural.js)
      const CURSES = ['vampire', 'purevampire', 'werewolf', 'blessedwerewolf', 'infectvampire', 'infectwerewolf', 'cure', 'crown', 'fever', 'bloody', 'wash', 'riteclear', 'restore'];
      if (/ \/curse /.test(text)) { const w = (text.match(/ ([a-z]{3,16})$/) || [])[1]; return [ev('char.supernatural', 1, { kind: CURSES.includes(w) ? w : 'curse', op: 'given' }, [[0, 'staff']])]; }
      return [];
    }
    const kind = (text.match(/\b(vampire|werewolf)\b/) || [])[1] || 'supernatural';
    if (/ is no longer a /.test(text)) return [ev('char.supernatural', 0, { kind, op: 'cured' })];
    if (/ became a /.test(text)) return [ev('char.supernatural', 0, { kind, op: 'became' })];
    if (/ restored from permadeath /.test(text)) return [ev('char.supernatural', 0, { kind: 'permadeath', op: 'restored' })];
    if (/ given .* by GM /.test(text)) return [ev('char.supernatural', 0, { kind: 'disease', op: 'given' })];
    if (/ made a .* by GM /.test(text)) return [ev('char.supernatural', 0, { kind, op: 'given' })];
    return [];
  },
});
parsed('DEITY', {
  // "refused a deity reset of "<typed>"" loses the typed text with its quotes
  parse: (text, P) => {
    if (!P.length) return [];
    if (/ was refused a deity reset/.test(text)) return [ev('char.deity', 0, { op: 'reset_refused' })];
    if (/ reset of .* FAILED/.test(text)) return [ev('char.deity', P.length > 1 ? 1 : 0, { op: 'reset_failed' })];
    if (/ reset /.test(text)) return [ev('char.deity', P.length > 1 ? 1 : 0, { op: 'reset' })];
    // " (<faith>)" after the god since the faiths (prayer.js, 19 Oct): a config name, not kept
    const m = text.match(/ (turned to|took) ([A-Za-z' -]{1,48})(?: \([A-Za-z' -]{1,48}\))?$/);
    return m ? [ev('char.deity', 0, { op: m[1] === 'took' ? 'chose' : 'turned', deity: m[2] })] : [];
  },
});
parsed('CONSOLE', {
  // the first word only, from the allow-list; mp's text argument goes before anything else is read
  cut: (text) => text.replace(/(\): mp\b[^,]{0,80}),.*$/, '$1'),
  parse: (text, P) => {
    if (!P.length) return [];
    const m = text.match(/\): ([A-Za-z]{1,24})\b/);
    const word = m ? m[1].toLowerCase() : '';
    const cmd = CONSOLE_VERBS.has(word) ? word : 'other';
    const local = / \(local\)$/.test(text);
    const blocked = / (?:REFUSED|BLOCKED) \(no console rights\)/.test(text);
    const formed = cmd === 'additem' || cmd === 'placeatme' || cmd === 'equipitem';
    const form = formed ? (text.match(/, ([A-Za-z][A-Za-z '-]{1,40}) \([0-9a-f]{1,8}:/) || [])[1] : undefined;
    const ref = (text.match(/ ref ([0-9a-f]{1,8})\b/) || [])[1];
    const k = cmd === 'additem' ? num((text.match(/, (\d{1,7})$/) || [])[1]) : undefined;
    const out = [ev('cmd.console', 0, { cmd, local, blocked, rights: !blocked, form, ref, k }, rest(P, 0, 'target'), { mirror: P.length > 1 })];
    if (blocked) out.push(ev('sec.signal', 0, { kind: 'console_blocked', game: cmd }));
    return out;
  },
});
parsed('LEDGERSALE', {
  // o.what may be written by the seller: the gold and the parties only
  parse: (text, P) => (P.length ? [ev('item.buy', 0, { what: 'ledger sale', price: gold(text, /(\d{1,9}) gold/), seller: 'ledger' }, rest(P, 0, 'seller'), { mirror: P.length > 1 })] : []),
});
parsed('DISENCHANT', { parse: (text, P) => (P.length ? [ev('item.extras', 0, { kind: 'disenchant' })] : []) });
parsed('DISENCHANT-AMBIGUOUS', { parse: () => [] });
parsed('NOBILITY', {
  // free titles are never read
  parse: (text, P) => {
    if (!P.length) return [];
    return [ev('social.nobility', 0, { op: / revoked /.test(text) ? 'revoke' : 'grant' }, rest(P, 0, 'target'), { mirror: P.length > 1 })];
  },
});
// counts and the party only: a case id is a staff-written config key, so it is not kept
const sweep = (kind) => ({
  parse: (text, P) => {
    if (!P.length) return [];
    const n = num((text.match(/ (\d{1,7}) x /) || [])[1]);
    return [ev('item.sweep', 0, { kind, n, gold: kind === 'restitution' ? gold(text, / took (\d{1,9}) gold /) : undefined })];
  },
});
parsed('GEARSTRIP', sweep('gearstrip'));
parsed('SPRSTRIP', sweep('sprstrip'));
parsed('GEARSWAP', sweep('gearswap'));
parsed('GEARRESTORE', Object.assign(sweep('gearrestore'), { cut: / as "/ }));
parsed('RESTITUTION', sweep('restitution'));
parsed('ECONOMY', {
  // ruler and leader actions on the actor's post; faction names and rank titles are never read
  parse: (text, P) => {
    const a = text.match(/ assessed property ([0-9a-f]{1,8}) at (\d{1,9}) gold/);
    if (a && P.length) return [ev('social.realm', 0, { op: 'assessed', ref: a[1], gold: Number(a[2]), fief_holder: / \(fief holder\)/.test(text) || undefined }, [], { homeOwner: a[1] })];
    // a sale from the hold names the buyer as text (byWho): the actor is unknown here, the buyer's post gets it from the
    // property owner once the housing record changes hands
    if (/^ECONOMY property [0-9a-f]{1,8} sold for /.test(text)) return P.length ? [ev('social.realm', 0, { op: 'bought_from_hold', ref: (text.match(/property ([0-9a-f]{1,8})/) || [])[1], gold: gold(text, / sold for (\d{1,9}) gold/) })] : [];
    if (!P.length) return [];
    if (/'s tax rate to /.test(text)) return [ev('social.realm', 0, { op: 'tax_rate', pct: num((text.match(/ to (\d{1,3})%/) || [])[1]) })];
    if (/'s weekly wage for /.test(text)) return [ev('social.realm', 0, { op: 'wage', gold: num((text.match(/ to (\d{1,9})$/) || [])[1]) })];
    if (/ forgave \d+ gold of wages/.test(text)) return [ev('social.realm', 0, { op: 'forgave_wages', gold: gold(text, / forgave (\d{1,9}) gold/) })];
    return [];
  },
});

// The first word of an audit line, as the registry knows it
const auditVerbOf = (body) => {
  const s = String(body || '');
  if (s.startsWith('GM ')) return 'GM';
  if (s.startsWith('OFFICIAL ')) return 'OFFICIAL';
  const m = s.match(/^([A-Z][A-Z0-9-]{1,30})(?=[\s:]|$)/);
  return m ? m[1] : null;
};
// A verb is counted by name only when it has the shape of one from code (upper case); anything else counts as '_other'
// ('?' was a key COUNTS refuses, so sys.schema wrote itself again every minute: safety review, LOW)
const unknownVerbKey = (body) => { const m = String(body || '').match(/^([A-Z][A-Z0-9-]{1,23})(?=[\s:]|$)/); return m ? m[1] : '_other'; };
// body -> { verb, cls, events, parties, roles }. A parser that throws gives no event (counted by the caller as an error).
const parseAudit = (body) => {
  const raw = String(body || '').slice(0, 600);
  const verb = auditVerbOf(raw);
  const def = verb ? AUDIT_VERBS[verb] : null;
  if (!def) return { verb: null, unknown: unknownVerbKey(raw), events: [] };
  if (def.cls === 'excluded') return { verb, cls: 'excluded', events: [] };
  let text = unquote(raw);
  // a cut function also gets the raw line, to tell whether unquote lost its end (endLost)
  if (typeof def.cut === 'function') text = def.cut(text, raw);
  else if (def.cut) { const m = text.match(def.cut); if (m) text = text.slice(0, m.index); }
  text = text.replace(/\s+$/, '');
  const P = partiesOf(text, !!def.display || def.cls === 'parsed');
  const roles = P.map((p, i) => (def.roles ? def.roles(i, p.pre) : i === 0 ? 'actor' : 'other'));
  if (def.cls === 'clean') {
    if (!P.length) return { verb, cls: 'clean', events: [], parties: P, roles };
    // identity normalised: "(profile N, <@id>)" goes, the name and #TAG stay; quoted text is already "…". The verb goes too:
    // the forwarder prints it after the actor (review C-R4); the actor's own "Name #TAG" at the start is cut in the taps,
    // where the character's real name is known
    const norm = text.replace(/ \(profile -?\d{1,9}(?:, <@\d{1,22}>)?\)/g, '').slice(verb.length).replace(/^[\s:]+/, '');
    let actor = roles.indexOf('actor'); if (actor < 0) actor = 0;
    const events = [ev(`act.${verb}`, actor, { text: norm }, P.map((p, i) => [i, roles[i]]).filter(([i]) => i !== actor))];
    if (def.signal) events.push(ev('sec.signal', actor, { kind: def.signal, game: verb.replace(/-MISMATCH$/, '').toLowerCase() }));
    return { verb, cls: 'clean', events, parties: P, roles };
  }
  return { verb, cls: 'parsed', events: def.parse(text, P, raw, roles) || [], parties: P, roles };
};

// ---- the fork's trade summary (journalstats.js reads the same) ------------------------------------------------------------
// '[trade] "A" (profile 1, actor ff000014) gave [2x 0x12eb7 "Iron Sword" {extras}, 1x 0xf] to "B" (profile 2, actor ff000015)
// for [nothing]'. Names in quotes are never read (an item's custom name is player text); counts and base ids only.
// The list after "gave [" or "for [", brackets balanced (enchantmentEffects=[...] sits inside an item's {extras})
const listAfter = (s, word) => {
  const i = s.indexOf(`${word} [`);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i + word.length + 1; j < s.length; j++) {
    if (s[j] === '[') depth++;
    else if (s[j] === ']' && --depth === 0) return { text: s.slice(i + word.length + 2, j), end: j + 1 };
  }
  return null;
};
// "{health=1.2, enchantmentId=0x4605a, enchantmentEffects=[0x4605a 12.5 a0 d1; ...], chargePercent=80, soul=3, poisonId=0x..., poisonCount=2}"
const extrasOf = (t) => {
  if (!t) return null;
  const x = {};
  const hexOf = (k) => { const m = t.match(new RegExp(`${k}=0x([0-9a-f]{1,8})`)); return m ? parseInt(m[1], 16) >>> 0 : undefined; };
  const numOf = (k) => { const m = t.match(new RegExp(`${k}=(-?[0-9.]{1,12})`)); return m ? Number(m[1]) : undefined; };
  x.health = numOf('health'); x.enchantmentId = hexOf('enchantmentId'); x.chargePercent = numOf('chargePercent'); x.soul = numOf('soul');
  x.poisonId = hexOf('poisonId'); x.poisonCount = numOf('poisonCount');
  const fx = t.match(/enchantmentEffects=\[([^\]]{0,400})\]/);
  if (fx) x.enchantmentEffects = [...fx[1].matchAll(/0x([0-9a-f]{1,8}) (-?[0-9.]{1,12})/g)].slice(0, 3).map((m) => ({ effectId: parseInt(m[1], 16) >>> 0, magnitude: Number(m[2]) }));
  return x;
};
const parseTradeSummary = (summary) => {
  const s = String(summary || '').slice(0, 20000);
  // Every JSON string is blanked first, so a quoted name can hold neither a bracket nor a fake party
  const blank = s.replace(/"(?:[^"\\\n]|\\.){0,400}"/g, (m) => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"');
  const ids = [...blank.matchAll(/\(profile (-?\d{1,9}), actor ([0-9a-f]{1,8})\)/g)].map((m) => ({ profile: Number(m[1]), actor: parseInt(m[2], 16) >>> 0 }));
  const gave = listAfter(blank, 'gave');
  const got = gave ? listAfter(blank.slice(gave.end), 'for') : null;
  if (ids.length !== 2 || !gave || !got) return null;
  const items = (l) => [...l.matchAll(/(?:^|, )(\d{1,9})x 0x([0-9a-f]{1,8})(?: " *")?(?: \{([^{}]*)\})?/g)]
    .map((m) => ({ k: Number(m[1]), base: parseInt(m[2], 16) >>> 0, extras: extrasOf(m[3]) })).slice(0, 60);
  return { a: ids[0], b: ids[1], gave: items(gave.text), got: items(got.text) };
};

// ---- the client version line (G6): nothing else of a diagnostic line is read ---------------------------------------------
const RX_CLIENT = /^apr client v=([0-9][0-9a-z.\-]{0,20}) sp=([0-9.]{1,12})$/;
const parseClientVersion = (text) => { const m = String(text || '').match(RX_CLIENT); return m ? { v: m[1], sp: m[2] } : null; };

// ---- commands -----------------------------------------------------------------------------------------------------------
// Chat is never recorded: these are not registered commands (handleChat answers them inline), and the wrapper refuses them
// as a belt
const CHAT_VERBS = new Set(['say', 'low', 'whisper', 'wide', 'shout', 'me', 'melow', 'melong', 'my', 'mylow', 'mylong', 'do', 'dolow', 'dolong',
  'looc', 'ooc', 'ooclow', 'ooclong', 'pm', 'dm', 'to', 'too', 'admin', 'system']);
// name -> { subs: [first words kept], target: { from, to, lookup: 'online'|'any' } (word positions of the query in what follows
// the sub, or in all the words when no sub matched), nums: [positions of numbers, the same way; negative from the end],
// info: read-only (folded), staffView: a staff.view when it names a player, mirror: the line also goes to the target's post,
// world: a staff.world action instead of cmd.run }
// Anything not listed is recorded by its name alone.
const S_ = (subs) => subs.split(/\s+/).filter(Boolean);
const COMMAND_SCHEMA = {
  help: { info: true }, adminhelp: { info: true }, players: { info: true }, whoami: { info: true }, ping: { info: true }, status: { info: true },
  time: { info: true }, officials: { info: true }, champions: { info: true }, wildlife: { info: true }, playtest: { info: true }, whereami: { info: true },
  rest: { info: true }, sentence: { info: true }, forms: { info: true }, blood: { info: true }, hunt: { info: true }, nobility: { info: true },
  spells: { info: true }, tomes: { info: true }, commissions: { info: true }, contracts: { info: true }, expeditions: { info: true },
  load: { info: true }, staffstats: { info: true }, update: { info: true }, region: { info: true }, selftest: { info: true }, properties: { info: true },
  hunger: { info: true }, placed: { info: true }, bugs: { info: true, nums: [0] }, stats: { info: true },
  couriers: { subs: S_('clear'), nums: [0] }, level: { subs: S_('health magicka stamina'), nums: [0] },
  // staff actions on a player: the target is resolved before the run; their GM, STAFF and UNSTUCK audit lines (or the
  // packet tap) already reach the target's post, so these stay on the staff member's post
  kick: { target: { from: 0, lookup: 'online' } },
  tp: { target: { from: 0, lookup: 'online' } },
  chargen: { target: { from: 0, lookup: 'online' } },
  grantappearance: { target: { from: 0, lookup: 'online' } },
  rename: { target: { from: 0, to: 1, lookup: 'any' } },
  chars: { target: { from: 0, lookup: 'any' }, info: true },
  fixloc: { target: { from: 0, lookup: 'online' } },
  sethunger: { target: { from: 0, to: 1, lookup: 'online' }, nums: [-1] },
  wipechars: { target: { from: 0, lookup: 'any' } },
  staffdiag: { target: { from: 0, to: 1, lookup: 'online' }, nums: [1] },
  voicediag: { target: { from: 0, to: 1, lookup: 'online' }, nums: [1] },
  charstats: { target: { from: 0, lookup: 'any' }, info: true, staffView: 'charstats' },
  anticheat: { subs: S_('status off on recent') },
  acstate: { target: { from: 0, lookup: 'online' }, info: true },
  gearswap: { target: { from: 0, lookup: 'online' }, info: true, staffView: 'gearswap' },
  playtime: { target: { from: 0, lookup: 'any' }, info: true },
  tokens: { target: { from: 0, lookup: 'online' }, info: true },
  boost: { subs: S_('grant extend'), target: { from: 0, to: 1, lookup: 'online' }, nums: [1] },
  unstuck: { target: { from: 0, lookup: 'online' } },
  pigeonblock: { target: { from: 0, lookup: 'any' } },
  sign: { subs: S_('off') },
  curse: { target: { from: 0, to: 1, lookup: 'online' } },
  beastform: { target: { from: 0, to: 1, lookup: 'online' } },
  discipline: { target: { from: 0, to: 1, lookup: 'any' } },
  // /discipline's ban, suspend and lift under other words (discipline.js, 25 Oct): the #TAG first, as there; /bans is its list
  ban: { target: { from: 0, to: 1, lookup: 'any' } }, tempban: { target: { from: 0, to: 1, lookup: 'any' } }, unban: { target: { from: 0, to: 1, lookup: 'any' } },
  bans: { info: true },
  jail: { subs: S_('zone unzone list release extend'), target: { from: 0, to: 1, lookup: 'online' }, nums: [1] },
  smithing: { subs: S_('teach forget list test'), target: { from: 0, to: 1, lookup: 'online' } },
  // mirrored to the target's post (DESIGN.md 2.2.3): party invite/kick, teach, faction invite/kick, appoint/dismiss
  party: { subs: S_('invite accept decline leave kick lead list disband'), target: { from: 0, to: 1, lookup: 'online' }, mirror: true },
  faction: { subs: S_('invite accept decline leave kick rank leader remove storage hallmark hallunmark list info limit ranks override'), target: { from: 0, to: 1, lookup: 'any' }, mirror: true },
  appoint: { target: { from: 0, to: 1, lookup: 'any' }, mirror: true },
  dismiss: { target: { from: 0, to: 1, lookup: 'any' }, mirror: true },
  teach: { mirror: true },
  leave: {}, makesuper: { subs: S_('vampire werewolf') },
  vlremote: { subs: S_('on off clear') }, wwremote: { subs: S_('on off clear') },
  beast: { subs: S_('werewolf vampirelord revert') },
  // staff polymorph (beastform.js): the animal or the word, never a name (it takes none)
  polymorph: { subs: S_('chicken hare rabbit goat fox dog skeever mudcrab deer revert list on off') },
  manual: { subs: S_('grant list buy copy') },
  schools: { subs: S_('set reset view') },
  classteacher: {}, preacher: {},
  deity: { subs: S_('reset') }, pray: {}, offer: { nums: [0] },
  bank: { subs: S_('deposit withdraw pay'), nums: [0] },
  business: { subs: S_('open close rent collect ledger staff list') },
  tax: { nums: [0] },
  property: { subs: S_('list unlist rent buy sell pay leave evict grace remind mine offer'), nums: [0] },
  courier: { subs: S_('post take deliver list') },
  contract: { subs: S_('take abandon post list') }, commission: { subs: S_('post take done refuse rule cancel abandon list') },
  charter: { subs: S_('draft pitch seat kind invite confirm leave submit withdraw approve deny edit dissolve disband list') },
  ticket: { subs: S_('bug player appeal other') },
  gm: { subs: S_('list take goto release close quiet') }, callgm: {},
  bug: {},
  court: { subs: S_('offer accept decline withdraw list') },
  ledger: { subs: S_('place remove list') }, ledgerpoint: { subs: S_('add remove list') },
  war: { subs: S_('declare accept refuse peace treaty capital end list') },
  warband: { subs: S_('raise follow stay attack charge unleash settle dismiss side') },
  raid: { subs: S_('all clear') },
  npc: { subs: S_('remove info') }, dungeon: { subs: S_('end list') }, expedition: {},
  name: {}, reroll: {}, appearance: {}, struggle: {}, respawn: {}, chill: {}, rite: {}, feed: { subs: S_('on off') }, feedpair: { subs: S_('on off') },
  keys: {}, board: {}, monitor: {}, mv: {}, masktest: { nums: [0] }, factiongear: { subs: S_('test') }, tailoring: {}, syncenchant: {},
  // the staff real-names mode (playermenu.js): on, off or status, never a name
  realnames: { subs: S_('on off status') },
  forget: {}, concordat: {}, dossier: { subs: S_('add strike view') },
  // staff world commands: a staff.world action, never their text
  announce: { world: 'announce' }, event: { world: 'announce' }, schedule: { world: 'schedule' }, rolename: { world: 'rolename' },
  settime: { world: 'clock', nums: [0] }, timescale: { world: 'timescale', nums: [0] }, setweather: { world: 'weather' },
  placeundo: { world: 'place' }, placeexport: { world: 'place' },
  driftspawn: { world: 'drift' }, driftrepair: { world: 'drift' }, driftset: { world: 'drift' },
};
// gamemode's REFUSAL_TEXT plus the usage, lookup and gate answers (the outcome class is LIKELY quality)
const REFUSAL_RX = /\b(cannot|can't|can not|not allowed|too far|get closer|refused|denied|not ready|not yet|only an? |beyond your|still rests|not long ago|no longer|not enough|you do not|you don't|out of reach|too soon|stepped out|nothing worth|is not yours|not yours|must be|you need|come back in|worked out|try again|is beyond|usage:|no player|no such|admins only|unknown|not found|is for a lead gm)/i;
// Console verbs kept by name (first word); anything else is "other"
const CONSOLE_VERBS = new Set(['additem', 'equipitem', 'placeatme', 'disable', 'enable', 'markfordelete', 'mp', 'tgm', 'tcl', 'tai', 'tfc', 'setav', 'modav',
  'forceav', 'player', 'coc', 'cow', 'moveto', 'kill', 'resurrect', 'unlock', 'lock', 'setstage', 'additemmenu', 'removeallitems', 'setlevel', 'advlevel', 'psb', 'tmm', 'tg', 'tm']);
// The client packets the packet tap reads, and the only fields read of each (no name, reason or zone text)
// The shapes are the fork's own (review C-R2, C-R5, C-R7): searchSystem.ts {requestId, accepted}; housingSystem.ts reads
// propertyInfoRequest {target} when the menu opens; the client's companionService.ts sends {action, targetId|companionId}.
// craftedExtras ({workbench, gained, lost}, client claims the server may refuse) is not read: phase B.
const PACKET_TYPES = {
  characterSelectMenuRequest: [],
  characterSelectResult: ['action', 'slot'],
  propertyInfoRequest: ['target'],
  propertyRequest: ['action', 'target', 'recipient'],
  companionCommand: ['action'],
  captureRequest: ['target'],
  searchRequest: ['target'],
  searchConsentResult: ['accepted'],
  adminAction: ['action', 'target', 'mode', 'amount', 'hours', 'item', 'count', 'skill', 'tier', 'kind', 'school', 'level'],
};
// housingSystem.ts onPropertyRequest's actions -> the social.housing op
const PROPERTY_ACTIONS = new Map([['claim', 'claim'], ['abandon', 'abandon'], ['revoke', 'revoke'], ['lock', 'lock'], ['unlock', 'unlock'], ['rename', 'rename'],
  ['createkey', 'cut_key'], ['takekey', 'take_key'], ['revokekeys', 'rekey'], ['transfer', 'transfer'], ['grantcontainer', 'grant_container'],
  ['assign', 'assign'], ['unassign', 'unassign'], ['share', 'share'], ['unshare', 'unshare']]);
const COMPANION_COMMANDS = new Set(['follow', 'stay', 'attack', 'dismiss', 'release', 'wait', 'trade', 'spawn', 'perks']);
// adminSystem.ts's actions, as its handler compares them (anything else is 'other')
const ADMIN_ACTIONS = new Set(['teleportTo', 'teleportLoc', 'summon', 'kick', 'kill', 'ban', 'ipBan', 'tempBan', 'unban', 'deleteCharacter', 'rename', 'toggleMode',
  'giveItem', 'giveSpells', 'giveShouts', 'giveWerewolf', 'giveVampireLord', 'giveDisease', 'beastForm', 'setSchool', 'masteryGrant', 'masteryReset',
  'masterySetTier', 'masteryDrop', 'npcZoneAdd', 'npcZoneDelete', 'npcZoneReset', 'npcZoneTp']);
// The panel actions whose target is an online player's actor id, sent as hex (adminSystem.ts parseInt(target, 16))
const ADMIN_ACTOR_TARGET = new Set(['teleportTo', 'summon', 'kick', 'kill', 'ban', 'ipBan', 'tempBan', 'deleteCharacter', 'rename', 'masteryGrant', 'masteryReset',
  'masterySetTier', 'masteryDrop', 'giveItem', 'giveSpells', 'giveShouts', 'giveWerewolf', 'giveVampireLord', 'giveDisease', 'beastForm', 'setSchool']);

// ---- the pinned audit call sites --------------------------------------------------------------------------------------------
// "file verb hash class", one per audit( call with a literal template. tests/playerlog-audit-harness.js scans every non-test
// *.js and fails on a site that is new, changed, gone or classed differently, so new code cannot add text to the player log
// without a review. hash: FNV-1a of the template's text; verb <expr> for a template that starts with an expression.
const siteHash = (t) => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const AUDIT_SITES = `
alchemy.js ALCHEMY 53ff4ec4 clean
alchemy.js ALCHEMY 2b9554a6 clean
alchemy.js ALCHEMY bbc0785b clean
alchemy.js ALCHEMY 1f691b2b clean
alchemy.js DISENCHANT-AMBIGUOUS 95471a94 parsed
alchemy.js DISENCHANT 6a0e1f03 parsed
alchemy.js ENCH-RESTORE 76a26bc3 clean
alchemy.js ENCH-LEARNED-REPAIR 1b77b634 clean
anticheat.js ANTICHEAT-DAILY 1c03c505 excluded
anticheat.js ANTICHEAT ae791c2e clean
appearance.js APPEARANCE 856fcf43 clean
appearance.js APPEARANCE d9f800c2 clean
appearance.js APPEARANCE 2163cbb1 clean
appearance.js APPEARANCE 70c1bb2f clean
appearance.js APPEARANCE f32869e4 clean
appearance.js APPEARANCE af25360a clean
appearance.js APPEARANCE 996fe268 clean
appearance.js APPEARANCE 26338fc4 clean
appearance.js APPEARANCE 41478c6a clean
appearance.js APPEARANCE e32ecc46 clean
appearance.js APPEARANCE 5db735ef clean
appearance.js APPEARANCE 25b16683 clean
appearance.js APPEARANCE dc1453e1 clean
appearance.js APPEARANCE cc2a3d88 clean
appearance.js APPEARANCE 8dda1487 clean
appearance.js APPEARANCE c08fc0d2 clean
appearance.js APPEARANCE 8a7cc30f clean
appearance.js APPEARANCE fa5ed0fc clean
appearance.js APPEARANCE b80ac1f1 clean
appearance.js APPEARANCE b0525394 clean
bank.js BANK 462e889d parsed
bank.js BANK f4890f79 parsed
bank.js BANK 5efd151e parsed
bank.js BANK 8324fa85 parsed
bank.js BANK 8bc0ab15 parsed
bank.js BANK e87b3042 parsed
bank.js BANK 49f63759 parsed
bank.js BANK b3999936 parsed
bank.js BANK e33b0e75 parsed
bank.js BANK f4565b27 parsed
bank.js BANK 76082ae7 parsed
bank.js BANK 4c816f34 parsed
bank.js BANK dd237d73 parsed
bank.js BANK 92dd9b73 parsed
bank.js BANK ddbac33b parsed
bank.js BANK 3958b0d9 parsed
bank.js BANK 8ff19655 parsed
bank.js BANK 71d34c61 parsed
bank.js BANK ade0885b parsed
bank.js BANK f7927cf8 parsed
bank.js BANK b29e7db8 parsed
bank.js BANK 1a72f529 parsed
bank.js BANK 07a5b4f9 parsed
bank.js BANK d4d119df parsed
bank.js BANK 167dae12 parsed
bank.js BANK 1609b3b0 parsed
bank.js BANK 858f3e4b parsed
bank.js BANK 9a871c63 parsed
bank.js BANK 9603dfa8 parsed
bank.js BANK 385d28ea parsed
bank.js BANK b26ffbd5 parsed
blackreach.js BLACKREACH 3be01906 clean
beastform.js BEAST d8772b8c clean
beastform.js <expr> 403600c0 excluded
beastform.js GM 20c30028 parsed
beastform.js GM 47bd1cd1 parsed
beastform.js BEAST eadfbd8f clean
beastform.js BEAST 168eca78 clean
beastform.js BEAST d2c5f579 clean
beastform.js BEAST 4b982cb7 clean
bloodranks.js BLOOD 2e7d8b09 clean
business.js BUSINESS b0f9df0b parsed
business.js BUSINESS 7485beff parsed
business.js BUSINESS 2719609b parsed
business.js BUSINESS 69e987c3 parsed
business.js BUSINESS c048e7c9 parsed
business.js BUSINESS 8664bec6 parsed
business.js BUSINESS 9392aa64 parsed
business.js BUSINESS c982a506 parsed
business.js BUSINESS 45cf5839 parsed
business.js BUSINESS 9adabccc parsed
business.js BUSINESS 8aadb66a parsed
business.js BUSINESS 1cb283fe parsed
business.js BUSINESS a7c97b52 parsed
business.js TAX 4f9fe86e clean
champions.js CHAMPION c06a6bd9 clean
charlevel.js LEVEL e66d9173 clean
charlevel.js LEVEL 34ff7176 clean
charters.js CHARTER bbc7a352 parsed
charters.js CHARTER 12a5d3b9 parsed
charters.js CHARTER 334c3708 parsed
charters.js CHARTER 4055f151 parsed
charters.js CHARTER e019ba5c parsed
charters.js CHARTER 75830be8 parsed
charters.js CHARTER fd56ef7e parsed
charters.js CHARTER ed81fe3e parsed
charters.js CHARTER a757f467 parsed
charters.js CHARTER a9f2f7e2 parsed
charters.js CHARTER dcda03c6 parsed
charters.js CHARTER bce46b84 parsed
charters.js CHARTER e4f1ccbf parsed
charters.js CHARTER 08a9fe8d parsed
charters.js CHARTER 2fff1a8c parsed
charters.js CHARTER 81a16458 parsed
charters.js CHARTER 469ace86 parsed
charters.js CHARTER 15c398c6 parsed
charters.js CHARTER 5ac7f124 parsed
charters.js CHARTER 988f3604 parsed
charters.js CHARTER dfb1ffd1 parsed
charters.js CHARTER 0306d70c parsed
charters.js CHARTER bbc7a352 parsed
citizenship.js CITIZEN a42c0b01 clean
citizenship.js CITIZEN 9460e80f clean
citizenship.js CITIZEN 19b317f7 clean
citizenship.js CITIZEN 00476b3d clean
citizenship.js CITIZEN ae3858a3 clean
citizenship.js CITIZEN 3f205847 clean
citizenship.js CITIZEN 9798b2f7 clean
citizenship.js CITIZEN 748e8429 clean
citizenship.js CITIZEN c913006a clean
citizenship.js CITIZEN 6d9dc694 clean
citizenship.js CITIZEN 22100e82 clean
citizenship.js ELECTION f6fe19bb clean
citizenship.js ELECTION aedc91eb clean
citizenship.js ELECTION d4c72052 clean
citizenship.js ELECTION 4a9329f4 clean
citizenship.js ELECTION 19644858 clean
citizenship.js ELECTION 1284d29d clean
citizenship.js ELECTION a2b8d084 clean
citizenship.js ELECTION c4f1f300 clean
citizenship.js ELECTION 267a2b7c clean
citizenship.js ELECTION 96adbfc0 clean
citizenship.js ELECTION 5263eff4 clean
citizenship.js ELECTION 6c4f61dc clean
citizenship.js ELECTION ba56254e clean
citizenship.js ELECTION 3130c4e5 clean
citizenship.js ELECTION 8e12772e clean
citizenship.js ELECTION e9335d9a clean
citizenship.js ELECTION 51c738f7 clean
citizenship.js ELECTION a78d4be7 clean
citizenship.js ELECTION 8ca5a5d0 clean
citizenship.js ELECTION 3e5d350b clean
citizenship.js CITIZEN e6f03eeb clean
citizenship.js ELECTION 9607cadb clean
commissions.js COMMISSION 49e86f26 parsed
commissions.js COMMISSION 150fc5bd parsed
commissions.js COMMISSION af1c554e parsed
commissions.js COMMISSION f911c3a2 parsed
commissions.js COMMISSION 531d326f parsed
commissions.js COMMISSION db09dfa4 parsed
commissions.js COMMISSION ad987a21 parsed
commissions.js COMMISSION 0aa01cec parsed
commissions.js COMMISSION 0c709fad parsed
console.js REMOTE ffdec0aa excluded
console.js REMOTE e4fec94b excluded
console.js REMOTE 1ef926f8 excluded
console.js REMOTE 04d3b66a excluded
contracts.js CONTRACT 5686a09a clean
contracts.js CONTRACT b6341078 clean
contracts.js CONTRACT 1c58c02d clean
contracts.js CONTRACT aaccf4b3 clean
contracts.js CONTRACT bdffe91c clean
couriers.js COURIER 23513b81 parsed
couriers.js COURIER 2b9f065b parsed
couriers.js COURIER d0598bda parsed
couriers.js COURIER f645052f parsed
couriers.js COURIER 6531eaed parsed
couriers.js COURIER 24b29031 parsed
couriers.js COURIER 60ecf5d2 parsed
couriers.js COURIER 8c990b4e parsed
couriers.js COURIER 59b81015 parsed
couriers.js COURIER 47445b21 parsed
couriers.js COURIER a957e9db parsed
couriers.js COURIER 41434a7d parsed
couriers.js COURIER 4806f214 parsed
court.js <expr> 9d97c8d1 parsed
court.js OFFICIAL 86dad6bd parsed
court.js <expr> a74e62f0 parsed
discipline.js DISCIPLINE c313c33e parsed
discipline.js DISCIPLINE e5c533ad parsed
discipline.js DISCIPLINE e8c0f96e parsed
discipline.js DISCIPLINE eaf7762e parsed
discipline.js DISCIPLINE 95d68f5f parsed
discordroles.js DISCORD 22bc34df excluded
discordroles.js DISCORD b04ccd84 excluded
discordroles.js DISCORD 053e6b2c excluded
downed.js CHILL f3d035ef clean
downed.js CHILL 10e833b0 clean
downed.js REVIVE 713b3142 clean
downed.js CRASH-DOWN 2188d365 clean
downed.js CRASH-DOWN c74add50 clean
downed.js CRASH-DOWN 263c623a clean
downed.js CRASH-DOWN 3000ad8e clean
downed.js FINISHED 4794f063 parsed
downed.js FINISHED f87a1d05 parsed
downed.js RECIPE 83b08366 clean
downed.js BREW 53c051c5 clean
duel.js DUEL dd8f1e8f clean
duel.js DUEL 7039f20e clean
duel.js DUEL 5e8dc518 clean
duel.js DUEL 38a2bc86 clean
duel.js DUEL b0854696 clean
duel.js DUEL 1eafe7ef clean
duel.js DUEL 12f9ee7c clean
duel.js DUEL 78cccf60 clean
duel.js DUEL afa42cac clean
dungeons.js DUNGEON 612925dd clean
dungeons.js CRASHLOOP 9635f3d7 clean
dungeons.js DUNGEON f795c1c6 clean
dungeons.js DUNGEON 7179acec clean
dungeons.js CHESTGOLD 4c0c6909 clean
dungeons.js BOSS 437f03cb clean
dungeons.js GM 8c3bf53e parsed
dungeons.js EBONY db7845e7 clean
economy.js ECONOMY e15fb1e7 parsed
economy.js ECONOMY 24f6b1a2 parsed
economy.js ECONOMY b0eba156 parsed
economy.js ECONOMY 4f84a430 parsed
economy.js ECONOMY e93056cd parsed
economy.js ECONOMY c11d4c54 parsed
economy.js ECONOMY 2cdbb30f parsed
economy.js ECONOMY 8e9b5f21 parsed
execution.js EXECUTION e5653509 clean
execution.js EXECUTION 4c691b64 clean
execution.js EXECUTION 151542a7 clean
execution.js EXECUTION 10d27374 clean
execution.js EXECUTION 76ea358d clean
factiongear.js FACTIONGEAR 79b8dc7c clean
guards.js GUARDS f67e7ce9 clean
apiaries.js APIARY c7230e1c clean
guards.js GUARDS 47d2600f clean
guards.js GUARDS 393970fa clean
guards.js GUARDS 64f64081 clean
guards.js GUARDS 89ac5f53 clean
guards.js GUARDS c54052ef clean
frenzy.js FRENZY 317ea9b7 clean
frenzy.js FRENZY b5c35900 clean
frenzy.js FRENZY d855ce67 clean
frenzy.js FRENZY 1d2c9d85 clean
frenzy.js FRENZY d7ec59ad clean
gamemode.js STAFF 636d572c clean
gamemode.js STAFF 6fcfd67a clean
gamemode.js GM b82067a4 parsed
gamemode.js BAN 50b88b35 parsed
gamemode.js NAME 1dc3182f parsed
gamemode.js PERM cf246214 parsed
gamemode.js PERM c10e460a parsed
gamemode.js GM 82a0a368 parsed
gamemode.js GM 9386ec05 parsed
gamemode.js HOUSING 77d29769 clean
gamemode.js GM 6fbbe634 parsed
gamemode.js GM c3aa528e parsed
gamemode.js GM 806c63e4 parsed
gamemode.js PIGEON 08c63dcc excluded
gamemode.js POST 2a604861 parsed
gamemode.js GM 90ebebeb parsed
gamemode.js TREASURY 0cdffe5e clean
gamemode.js GOLD bc09604d clean
gamemode.js BANK c8ca81b1 parsed
gamemode.js GM 6146f51c parsed
gamemode.js JOIN 825709f7 excluded
gamemode.js LEAVE 671cb8b6 excluded
gamemode.js GM 121466f5 parsed
gamemode.js GM e7964fbd parsed
gamemode.js STAFF 13ee2995 clean
gamemode.js STAFF e30a10a1 clean
gamemode.js GM 2188c029 parsed
gamemode.js GM fc0d417f parsed
gamemode.js GM 15dd58a2 parsed
gamemode.js POST 50314046 parsed
gamemode.js BOARD b942ed32 parsed
gamemode.js <expr> 06af3bb2 parsed
gamemode.js <expr> 81ff2a3c parsed
gamemode.js READ 10c2287e clean
gamemode.js WELL ecdbc739 clean
gamemode.js UNSTUCK d8f634f3 clean
gamemode.js SKINNING-MISMATCH 25473bc6 clean
gamemode.js BODY 5e5a70cb excluded
gamemode.js CONSOLE 9f79f5f1 parsed
gamemode.js CONSOLE c26ae299 parsed
gamemode.js DRAGON 2d681b7f clean
gamemode.js PURSE dc7b3884 clean
gamemode.js ANNOUNCE e54bab47 excluded
gamemode.js OFFICIAL 9d4a3473 parsed
gameticket.js TICKET 77ab190c clean
gearstrip.js GEARSTRIP b2f2fbe7 parsed
gearstrip.js GEARSTRIP dbc0d2fc parsed
gearstrip.js GEARSTRIP 65292d67 parsed
gearstrip.js GEARSTRIP 49b64e3f parsed
gearswap.js GEARSWAP 56c1784a parsed
gearswap.js GEARSWAP b469a986 parsed
gearswap.js GEARSWAP a9ee526a parsed
gearswap.js GEARRESTORE 7b6eb5c9 parsed
gearswap.js GEARRESTORE 059c5afd parsed
gearswap.js GEARRESTORE 3f5caeb1 parsed
gifts.js GIFT f3d9a000 excluded
gmcall.js GMCALL 6825a400 parsed
gmcall.js GMCALL 208745b4 parsed
gmcall.js GMCALL d9bbbeb8 parsed
gmcall.js GMCALL 7e565d33 parsed
gmcall.js GMCALL abf76216 parsed
gmcall.js GMCALL 46558f70 parsed
gmcall.js GMCALL f6431a8b parsed
gmcall.js GMCALL a9eaaca2 parsed
gmcall.js GMCALL 4d962b08 parsed
greathunt.js HUNT 08c91559 clean
greathunt.js HUNT 4610cddc clean
greenpact.js PARTAKE 4cd5c56f clean
greenpact.js PARTAKE 934342b4 clean
greenpact.js PARTAKE 6dd41892 clean
guilds.js FACTION-LIMIT 80aca6c8 parsed
guilds.js FACTION-LIMIT ae8015bc parsed
guilds.js FACTION f8d4e175 parsed
guilds.js FACTION 6c77ee5e parsed
guilds.js FACTION 9196331b parsed
guilds.js FACTION 4b9dc721 parsed
guilds.js FACTION 733dfbb1 parsed
guilds.js FACTION c877bfe7 parsed
guilds.js FACTION 0737ce1b parsed
guilds.js FACTION 66dab042 parsed
guilds.js FACTION 36cf81a9 parsed
guilds.js FACTION c1301c32 parsed
guilds.js FACTION 87ee4dd3 parsed
guilds.js FACTION 9d54f47c parsed
guilds.js FACTION 20feef99 parsed
guilds.js FACTION bdc6897e parsed
guilds.js FACTION-RANK 77565f59 excluded
guilds.js FACTION-MERGE 03cc2a6a excluded
guilds.js FACTION-MERGE 2062ec33 excluded
jail.js JAIL 9a6540c2 clean
jail.js JAIL 9a6540c2 clean
jail.js JAIL 0e8664e2 clean
jail.js JAIL 5fc441ab clean
jail.js JAIL 1b911941 clean
jail.js JAIL ab248e05 clean
jail.js JAIL cca6b801 clean
jail.js JAIL 93c7d6d9 clean
journalnotes.js WRITTEN baf0dce7 excluded
keyring.js KEYRING b2ad5fc1 parsed
keyring.js KEYRING 0b8be016 parsed
keyring.js KEYRING 0b8be016 parsed
keyring.js KEYRING f333bd5d parsed
labour.js LABOUR-MISMATCH d7791950 clean
labour.js MINE 915776d9 clean
labour.js CHOP 6d22c150 clean
leadership.js LEADERSHIP 803e7d3b excluded
ledger.js LEDGER ba4ac58e excluded
ledger.js LEDGER 77274c80 excluded
ledgersale.js LEDGERSALE 57e2baf4 parsed
leverpuzzles.js LEVERPUZZLE 44a72fc8 clean
leverpuzzles.js LEVERPUZZLE 02bcc12b clean
leverpuzzles.js LEVERPUZZLE eb03d283 clean
lockpick.js LOCK 24f728b1 clean
lockpick.js LOCKPICK-MISMATCH 280b5b3c clean
lockpick.js LOCK 24f728b1 clean
manuals.js MANUAL c367d194 clean
manuals.js MANUAL d08c753a clean
manuals.js MANUAL 53f416fb clean
manuals.js MANUAL d753d3eb clean
manuals.js SKILLBOOK a5403e71 clean
manuals.js SCHEMATIC 121a751a clean
manuals.js SCHEMATIC 3ecb4848 clean
manuals.js MANUAL 9ff5ff92 clean
manuals.js MANUAL b71b7e27 clean
manuals.js MANUAL 2f06b826 clean
manuals.js MANUAL 8df0187e clean
mines.js MINE c3af4e8a clean
mines.js MINE 1b10e15b clean
mines.js MINE 9cd1fd91 clean
naming.js NAME 1cf7ac2d parsed
naming.js NAME c75b6e10 parsed
naming.js NAME d8ef2ef4 parsed
nobility.js NOBILITY 97cfe241 parsed
nobility.js NOBILITY 2022e40c parsed
orphans.js ORPHAN 79ab9d5e excluded
exposure.js EXPOSURE 5f33fd21 excluded
exposure.js EXPOSURE 1588aa8a excluded
exposure.js EXPOSURE 4f7323f3 excluded
exposure.js EXPOSURE 502fbe8b excluded
exposure.js EXPOSURE 7d6e979d excluded
exposure.js EXPOSURE 9d89712e excluded
outlaws.js BOUNTY 30a8bfe5 excluded
outlaws.js BOUNTY 16cb8c4f excluded
outlaws.js BOUNTY 2eaae5ee excluded
outlaws.js BOUNTY 2784331c excluded
outlaws.js BOUNTY 322b41f3 excluded
outlaws.js BOUNTY d5aa49c4 excluded
outlaws.js BOUNTY 12814a1a excluded
patrons.js REROLL 0fd5f13c clean
patrons.js REROLL 5adb2276 clean
pickpocket.js THEFT 6f851464 parsed
pickpocket.js THEFT ecb55f36 parsed
pickpocket.js THEFT cfffaf2c parsed
placement.js PLACE 924f75fa excluded
placement.js PLACE 847f921e excluded
placement.js PLACE 54b36d58 excluded
placement.js PLACE d64dc386 excluded
placement.js PLACE b9b1337f excluded
placement.js PLACE 7ea0e99b excluded
placement.js PLACE ba42366f excluded
placement.js PLACE 91dd31f6 excluded
placement.js PLACE 18721709 excluded
placement.js PLACE 9967e4b2 excluded
placement.js PLACE 958b8dce excluded
placement.js PLACE 58d5c714 excluded
placement.js PLACE b7914e97 excluded
placement.js PLACE 15bbb51c excluded
playerguilds.js GUILD bbed1c36 excluded
playerguilds.js GUILD 83f1a43c excluded
playerguilds.js GUILD 185bff53 excluded
playerguilds.js GUILD 2d1d0446 excluded
playerguilds.js GUILD c606be52 excluded
playerguilds.js GUILD f47eaa3c excluded
playerguilds.js GUILD 6fb1ce5c excluded
playerguilds.js GUILD de66f55a excluded
playerguilds.js GUILD c8ffe61b excluded
playerguilds.js GUILD 7365e4e9 excluded
playtest.js PLAYTEST 006bc8da clean
playtest.js PLAYTEST 37ce7390 clean
playtest.js PLAYTEST 6d1c5991 clean
playtest.js PLAYTEST 689db7a8 clean
playtesterboost.js BOOST 86d7eb6d clean
playtesterboost.js BOOST 7a3a00b0 clean
playtesterboost.js BOOST d1a90aa3 clean
playtime.js PLAYTIME 30702908 clean
post.js POST 41ef3109 parsed
post.js SUPPLY 4d947d04 clean
post.js SUPPLY 6faf9ba5 clean
post.js SUPPLY c7cc615d clean
post.js SUPPLY bedaa858 clean
prayer.js OFFERING dc4d1de1 clean
prayer.js PRAYER-MISMATCH 81a877ce clean
prayer.js PRAYER bcadb75c clean
prayer.js DEITY 94c053c8 parsed
prayer.js DEITY 359ee636 parsed
prayer.js DEITY 6fc5b703 parsed
prayer.js DEITY 4d3cb547 parsed
prayer.js DEITY 0e4ababa parsed
raids.js RAID fdb0a1f2 parsed
raids.js RAID 964a95d1 parsed
raids.js RAID 26d13fb4 parsed
realm.js REALM 1b608896 parsed
realm.js REALM b3cdee6b parsed
realm.js REALM 97d74408 parsed
realm.js WAR 02e57730 parsed
realm.js WAR 1d954b17 parsed
realm.js WAR db0da18a parsed
realm.js WAR 89eaa67a parsed
realm.js WAR ba7a8fea parsed
realm.js WAR b49e348d parsed
realm.js WAR 6baba944 parsed
realm.js WAR cf8cca6d parsed
realm.js WAR 6bad01ad parsed
realm.js WAR e33513bf parsed
rebellion.js REBELLION 2b0b3600 excluded
rebellion.js REBELLION 9696db09 excluded
rebellion.js REBELLION aeaa5259 excluded
rebellion.js REBELLION 9a3856fe excluded
rebellion.js REBELLION c59236c3 excluded
rebellion.js REBELLION 3fabdf32 excluded
rebellion.js REBELLION 10cf4ab3 excluded
rebellion.js REBELLION 58c222d2 excluded
rebellion.js REBELLION 28283c16 excluded
rebellion.js REBELLION c01ebfbb excluded
rebellion.js REBELLION 82c5bd37 excluded
rebellion.js REBELLION 7c1ca8ce excluded
rebellion.js REBELLION c2048083 excluded
rebellion.js REBELLION f79a46be excluded
rebellion.js REBELLION ff6cd85d excluded
rebellion.js REBELLION bd96e993 excluded
rebellion.js REBELLION 08f0a3e7 excluded
referrals.js REFERRAL 404c381c excluded
referrals.js REFERRAL e9e7820d excluded
referrals.js <expr> e559b0fa excluded
referrals.js <expr> 7c3b1074 excluded
referrals.js <expr> fba4d520 excluded
referrals.js <expr> d9616e46 excluded
referrals.js <expr> b0ebeb7c excluded
referrals.js REFERRAL 5d0a72fb excluded
referrals.js REFERRAL cf59389e excluded
referrals.js REFERRAL a21d92e8 excluded
referrals.js REFERRAL ec31533d excluded
referrals.js REFERRAL e3cd0b73 excluded
referrals.js REFERRAL 129b516e excluded
referrals.js REFERRAL 8f11972e excluded
referrals.js REFERRAL ad1239aa excluded
referrals.js REFERRAL 0a67f28f excluded
regions.js REGION a0b2cc46 clean
regions.js FORGENEVER d25fc68f clean
regions.js ARTIFACT e31183e3 clean
regions.js DRAGON 437085f5 clean
regions.js ORCISH b4078025 clean
regions.js RACECRAFT 6c57b214 clean
regions.js SMELT f53c6262 clean
rest.js REST 4946e270 clean
rest.js REST 1900507e clean
rest.js REST b3785710 clean
rest.js REST 8e58c60d clean
rest.js REST 788e8d28 clean
rest.js REST ba04dd69 clean
restitution.js RESTITUTION 2fe920c8 parsed
restitution.js RESTITUTION a3dc7345 parsed
restitution.js RESTITUTION 9fe1a93b parsed
restitution.js RESTITUTION 2c16ec14 parsed
robbery.js ROBBERY 11430e82 parsed
robbery.js ROBBERY 008a7770 parsed
robbery.js ROBBERY e3b9189d parsed
robbery.js ROBBERY 3985352b parsed
robbery.js ROBBERY 4198dff7 parsed
rolenames.js ROLENAME df611533 excluded
rope.js ROPE 0a0df508 clean
rope.js ROPE c23bb959 clean
ruinbuttons.js RUINBUTTON 8e219035 clean
ruinbuttons.js RUINBUTTON cfba0750 clean
schools.js SCHOOLS 258c3b1a clean
schools.js SCHOOLS adc19c5c clean
schools.js SCHOOLS 1c16d2bc clean
schools.js SCHOOLS d33fcf22 clean
schools.js SCHOOLS fd458d3e clean
schools.js SCHOOLS 38f0ba62 clean
schools.js SCHOOLS 9fb3fbbc clean
schools.js SCHOOLS e38e3945 clean
schools.js SCHOOLS f2391232 clean
schools.js SCHOOLS c0be7fec clean
schools.js SCHOOLS 11eda490 clean
schools.js SCHOOLS f4efbaa1 clean
schools.js SCHOOLS a1eb1100 clean
schools.js SCHOOLS 1d8e5d4d clean
schools.js SCHOOLS 73d40512 clean
schools.js SCHOOLS a020aca7 clean
schools.js SCHOOLS 97bc4f22 clean
schools.js SCHOOLS 25df858f clean
schools.js SCHOOLS a6e41f2b clean
schools.js SCHOOLS 626fbf9d clean
schools.js SCHOOLS 5feb23d3 clean
schools.js SCHOOLS 549393c1 clean
schools.js SCHOOLS 4655ae33 clean
schools.js SCHOOLS b23bb0d4 clean
schools.js SCHOOLS ed435ac5 clean
schools.js SCHOOLS 0b9a63c1 clean
schools.js SCHOOLS 1a808c9f clean
schools.js SCHOOLS 035066f1 clean
schools.js SCHOOLS 49620ca2 clean
schools.js SCHOOLS 4bf99e52 clean
schools.js SCHOOLS c9a90965 clean
schools.js SCHOOLS a8bfbc1d clean
scribing.js SCRIBE a910395c clean
scribing.js SCRIBE 7444798d clean
scribing.js SCRIBE aca01dfb clean
shops.js SHOP 78180277 excluded
shops.js SHOP b05fe7cd excluded
shops.js SHOP a9746335 excluded
shops.js SHOP e7913e19 excluded
shops.js SHOP a1b4c2e6 excluded
shops.js SHOP a196555e excluded
shops.js SHOP 88671fca excluded
silvertest.js SILVER 479492a5 clean
silvertest.js SILVER bb21bfdb clean
silvertest.js SILVER 2cefd1be clean
silvertest.js SILVER 102f3d42 clean
silvertest.js SILVER 7adf5989 clean
silvertest.js SILVER 92dd568b clean
silvertest.js SILVER 6b1d4eab clean
smithing.js SMITH 92d9d0d1 clean
smithing.js SMITH f0ad3f6e clean
smithing.js SMITH 642eeccc clean
smithing.js SMITH a36f3d9f clean
spells.js SPELL 8165ae73 clean
spells.js SPELL c975df88 clean
spells.js SPELL 7dd908fc clean
spells.js SPELL aaa9fe7a clean
spells.js SPELL 56699862 clean
spells.js SPELL e88fdb82 clean
spells.js SPELL b365d699 clean
spells.js SPELL 9dba290f clean
spells.js SPELL 8633406d clean
spells.js SPELL d923f500 clean
spells.js SPELL 3f46006a clean
spells.js SPELL 6eca2fef clean
spells.js TEACH acada6bd parsed
spells.js TEACH d52977b9 parsed
spells.js SPELL f950cf7a clean
spells.js SPELL 6eaecec5 clean
spells.js SPELL 970641d9 clean
sprstrip.js SPRSTRIP ac1572f1 parsed
sprstrip.js SPRSTRIP a7b3a299 parsed
sprstrip.js SPRSTRIP d281443a parsed
sprstrip.js SPRSTRIP 785ed462 parsed
staffenchant.js STAFF 9a94a0c4 clean
staffguard.js STAFFREF 793dd536 clean
staffguard.js STAFFGUARD 486826c9 clean
staffguard.js STAFFCHAR 25cceb6f clean
staffguard.js STAFFREF 44dc317b clean
stafftools.js EVENT 90e88695 excluded
struggle.js STRUGGLE-MISMATCH c97bbac2 clean
struggle.js STRUGGLE 4292b3ed clean
struggle.js STRUGGLE 64f21bae clean
supernatural.js SILVER 63135a13 clean
supernatural.js BLOODCROWN c2297893 clean
supernatural.js BLOODCROWN b02b396c clean
supernatural.js BLOODCROWN 6f3568be clean
supernatural.js SUPERNATURAL 3f6b1b4e parsed
supernatural.js SUPERNATURAL b538d135 parsed
supernatural.js SUPERNATURAL 20a78766 parsed
supernatural.js PERMADEATH d8f3928d parsed
supernatural.js SUPERNATURAL b0a3c71f parsed
supernatural.js RITE 994d3da4 clean
supernatural.js RITE 11804524 clean
supernatural.js RITE-MISMATCH a93b97ba clean
supernatural.js RITE 1f3ba523 clean
supernatural.js RITE 5975fe44 clean
supernatural.js RITE 660b5a7f clean
supernatural.js SUPERNATURAL 85d18a28 parsed
supernatural.js SUPERNATURAL 1b9b1278 parsed
supernatural.js SUPERNATURAL b66c9b3b parsed
supernatural.js SUPERNATURAL 43a4cd72 parsed
supernatural.js SUPERNATURAL 54a19c8c parsed
supernatural.js GM 3c8e58ad parsed
supernatural.js GM 4eae7552 parsed
supernatural.js FEED c6171020 clean
supernatural.js FEED 70f09eb9 clean
supernatural.js FEED 54466fd0 clean
supernatural.js FEED 9de7df49 clean
supernatural.js FEED aeb2f1ce clean
supernatural.js SUPERNATURAL bae7ad8d parsed
supernatural.js SUPERNATURAL 8ac6ad0d parsed
supernatural.js SUPERNATURAL 2462dde7 parsed
supernatural.js SUPERNATURAL ded670f2 parsed
supernatural.js SUPERNATURAL 644712c6 parsed
supernatural.js SUPERNATURAL 34ab901a parsed
supernatural.js SUPERNATURAL b84ebdba parsed
supernatural.js SUPERNATURAL 6a6a6673 parsed
tailoring.js TAILOR 4ccf2f80 clean
tenancy.js PROPERTY 8dbca314 parsed
tenancy.js PROPERTY e3463099 parsed
tenancy.js PROPERTY 647d7824 parsed
tenancy.js PROPERTY 4365689f parsed
tenancy.js PROPERTY d51b23c0 parsed
tenancy.js PROPERTY 7ad9b317 parsed
tenancy.js PROPERTY 34e3ba3c parsed
tenancy.js PROPERTY 240ca314 parsed
tenancy.js PROPERTY da8eaf5f parsed
tenancy.js PROPERTY c57d553f parsed
tenancy.js PROPERTY 6586c5cd parsed
tenancy.js PROPERTY e8386a32 parsed
tenancy.js PROPERTY f2ed1811 parsed
tenancy.js PROPERTY 78368fd7 parsed
tenancy.js PROPERTY eea5b910 parsed
tenancy.js PROPERTY ba2e199b parsed
tenancy.js PROPERTY e0424aa5 parsed
tenancy.js PROPERTY a49d27a0 parsed
tenancy.js PROPERTY 3aac3a2d parsed
tenancy.js PROPERTY abe74dbd parsed
thalmor.js CONCORDAT 230eceba clean
thalmor.js CONCORDAT 66fa43c2 clean
thalmor.js CONCORDAT f62ed9cc clean
thalmor.js THALMOR 3d505ba6 excluded
thalmor.js THALMOR 999d1114 excluded
thalmor.js THALMOR 07585056 excluded
thievery.js BURGLARY fe62ff8e excluded
thievery.js BURGLARY 49dc2b56 excluded
thievery.js BURGLARY 67de5545 excluded
thievery.js BURGLARY 4c2c0ebf excluded
thievery.js BURGLARY 22d39bbf excluded
thievery.js FENCE df1462fe excluded
thievery.js FENCE d03976b3 excluded
thievery.js FENCE 7b2563f4 excluded
thievery.js FENCE a7180fcc excluded
thievery.js FENCE 25f09718 excluded
thievery.js BURGLARY 9dfe8eb8 excluded
thievery.js FENCE 1e58a761 excluded
thievery.js FENCE 5d16d209 excluded
thievery.js BURGLARY cb247761 excluded
thievery.js BURGLARY d9137570 excluded
thievery.js FENCE 2382cb91 excluded
thievery.js FENCE e8887037 excluded
thievery.js FENCE cd3cdaca excluded
thievery.js BURGLARY 19e10e3e excluded
thievery.js BURGLARY fb5b3c67 excluded
thievery.js FENCE 2c29dac3 excluded
traps.js TRAPS e78eabea clean
updates.js SCHEDULE d379ec24 excluded
updates.js SCHEDULE 2e638d4c excluded
updates.js SCHEDULE 316703ad excluded
updates.js SCHEDULE 931bc6c2 excluded
updates.js SCHEDULE 970eb794 excluded
updates.js SCHEDULE b78035ce excluded
warband.js WARBAND e29bff83 parsed
warband.js WARBAND fb30cf9c parsed
warband.js WARBAND 3e0eb724 parsed
warband.js WARBAND b0c89794 parsed
warband.js WARBAND 344f1d8e parsed
warband.js WARBAND 08930733 parsed
warband.js WARBAND bf500dff parsed
warband.js WARBAND 7ac16355 parsed
warband.js WARBAND d2d7dc43 parsed
weaponracks.js WEAPONRACK d2aa0860 parsed
weaponracks.js WEAPONRACK 97d57c44 parsed
weaponracks.js WEAPONRACK 13b7bc1a parsed
weaponracks.js WEAPONRACK 09db1a85 parsed
weaponracks.js WEAPONRACK 24ff3109 parsed
wildlife.js CAMP 23958ca3 clean
worldclock.js CLOCK 976f9d7b clean
worldclock.js CLOCK 91485c97 clean
worldclock.js CLOCK ccc4cdd1 clean
worldedit.js WORLDEDIT 197a6260 clean
`.trim().split('\n').filter(Boolean).map((l) => { const [file, verb, hash, cls] = l.trim().split(/\s+/); return { file, verb, hash, cls }; });

module.exports = {
  VERSION, EVENT_TYPES, typeOf, clean, validate, REFUSAL_REASONS, AUDIT_SITES, siteHash, AC_SIGNAL_KINDS,
  AUDIT_VERBS, auditVerbOf, parseAudit, unquote, partiesOf, itemsFromText, namesFromText,
  parseTradeSummary, parseClientVersion,
  CHAT_VERBS, COMMAND_SCHEMA, REFUSAL_RX, CONSOLE_VERBS, PACKET_TYPES, PROPERTY_ACTIONS, COMPANION_COMMANDS, ADMIN_ACTIONS, ADMIN_ACTOR_TARGET,
};
