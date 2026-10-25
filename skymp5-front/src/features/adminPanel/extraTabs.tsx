import React, { useEffect, useMemo, useState } from 'react';

import Button from '../../constructorComponents/button';
import { Picker } from '../../components/Picker/Picker';
import { SearchBar, SearchChip, fuzzyFilter, useCursor, useFavourites, useRecent, useScrollIntoView } from '../../components/SearchBar/SearchBar';

// F7 admin panel additions (2026-09-16): player punishments and bans, skill tiers, item spawning, powers.
// Every action goes out as admin::action <action> <JSON fields>; the server checks rank and target.
// 2026-09-22: every tab picks its target from the same dropdown instead of a typed name, long lists reveal
// in pages instead of truncating, and the Powers tab drives beast forms directly (server\beastform.js).

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('adminPanel sendMessage', key, args);
  }
};

export const adminAction = (events: Record<string, string>, action: string, fields: Record<string, unknown>): void => {
  if (events.action) send(events.action, action, JSON.stringify(fields));
};

const adminRequest = (events: Record<string, string>, type: string, fields: Record<string, unknown>): void => {
  if (events.request) send(events.request, type, JSON.stringify(fields));
};

// Editor ids read as words: "DLC2ArmorNordicHeavyBoots" -> "Nordic Heavy Boots"
export const humanize = (edid: string): string =>
  String(edid || '')
    .replace(/^(DLC0?[12]|CYR|BSK|BS|CC[A-Z]{3}SSE\d+_?|dun|MQ\d*|TG\d*|DB\d*|MS\d*)/, '')
    .replace(/^(Armor|Clothes|Clothing|Weapon|Ench)(?=[A-Z])/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/(\D)(\d)/g, '$1 $2')
    .trim() || edid;

// ---- who an action happens to ------------------------------------------------------------------
// One entry per pickable character. An empty id means the admin themself, which every action treats
// as its default, so the picker always has something valid selected.
export interface TargetOption {
  id: string;      // actor id hex, '' for the admin
  label: string;
  beast?: BeastState;
}

export interface BeastState {
  werewolf: boolean;
  vampirelord: boolean;
  form: string | null;
  // From a newer server\beastform.js. creature says the shape is an animal rather than a beast form, so this
  // file needs no list of its own to tell them apart; since is when it was taken. Both absent on an older server
  creature?: boolean;
  since?: number | null;
}

// server\beastform.js __dboPolymorphPanel, through adminSystem.ts and adminMenuService's panelData
export interface PolymorphInfo {
  on: boolean;          // the Owners' switch
  setBy: string;        // 'admin', 'file', or '' when it has never been set
  forms: Array<{ key: string; name: string }>;   // the animals that may be taken right now
}

// One line of "who is an animal", built in index.tsx from the roster and the admin's own row
export interface PolymorphedRow {
  id: string;           // actor id hex, '' for the admin themselves
  label: string;
  form: string;
  name: string;         // what to call the shape: the server's name where it sent one
  minutes: number | null;
}

export const targetFields = (id: string): Record<string, unknown> => (id ? { target: id } : {});

export const TargetPicker = ({ targets, value, onChange, label }: {
  targets: TargetOption[]; value: string; onChange: (id: string) => void; label?: string;
}) => {
  // A target who logs out must not leave the picker pointing at nobody
  useEffect(() => {
    if (value && !targets.some((t) => t.id === value)) onChange('');
  }, [targets, value]);
  return (
    <label className="admin-panel__picker">
      <span className="admin-panel__label">{label || 'Acting on'}</span>
      <Picker className="admin-panel__select" value={value} onChange={onChange}
        options={targets.map((t) => ({ value: t.id, label: t.label }))} />
    </label>
  );
};

// Long lists reveal a page at a time instead of stopping dead at a cap
// step: how many one press adds (a server page); without it, as many again as are shown
export const MoreRow = ({ shown, total, onMore, step }: { shown: number; total: number; onMore: () => void; step?: number }) => (
  total <= shown ? null : (
    <div className="admin-panel__more">
      <span className="admin-panel__hint">{shown} of {total}</span>
      <Button text={'Show ' + Math.min(total - shown, step || shown) + ' more'} width={150} height={28} onClick={onMore} />
    </div>
  )
);

export interface PanelBan {
  id: string;
  profileId: number;
  name: string;
  ip: string;
  until: number;
  reason: string;
  by: string;
  at: number;
}

const BAN_LENGTHS: Array<[string, number]> = [['1 hour', 1], ['6 hours', 6], ['1 day', 24], ['3 days', 72], ['1 week', 168], ['30 days', 720]];

// Anything that cannot be undone asks once. The second press within five seconds does it.
export const Confirm = ({ text, width, disabled, onConfirm }: { text: string; width: number; disabled?: boolean; onConfirm: () => void }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => { if (disabled) setArmed(false); }, [disabled]);
  return (
    <Button
      text={armed ? 'Sure? ' + text : text}
      width={width} height={32} disabled={disabled}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    />
  );
};

// Set the selected character's god aside so they choose again (server prayer.js, Nate 2026-09-30). Lead GM and above; the
// server checks the rank again. It works on an offline row too: without a live actor the server finds the character by
// name, narrowed to the row's profile when two characters share it. The answer comes back like any other panel action.
export const DeityReset = ({ actor, name, profile, canSpawn }: { actor: string | null; name: string; profile: number; canSpawn: boolean }) => {
  if (!canSpawn) return null;
  return (
    <div className="admin-panel__actions">
      <Confirm text="Reset deity" width={150} disabled={!actor && !name} onConfirm={() => send('dbo:deityReset', actor || '', name || '', profile || 0)} />
      <span className="admin-panel__hint">Clears their god, blessing and conversion clock so they choose again</span>
    </div>
  );
};

// Extra buttons for the selected online player, plus the ban list
export const PlayerPunish = ({ events, target, name, canBan, canSpawn, bans }: {
  events: Record<string, string>; target: string | null; name: string; canBan: boolean; canSpawn: boolean; bans: PanelBan[];
}) => {
  const [hours, setHours] = useState('24');
  const hoursOk = Number(hours) > 0 && Number(hours) <= 8760;
  return (
    <div className="admin-panel__punish">
      <div className="admin-panel__actions">
        {canSpawn ? <Button text="Kill" width={96} height={32} disabled={!target} onClick={() => target && adminAction(events, 'kill', { target })} /> : null}
        {canBan ? <Confirm text="Delete character" width={170} disabled={!target} onConfirm={() => target && adminAction(events, 'deleteCharacter', { target })} /> : null}
        {canBan ? <Confirm text="IP ban" width={110} disabled={!target} onConfirm={() => target && adminAction(events, 'ipBan', { target })} /> : null}
      </div>
      {canBan ? (
        <div className="admin-panel__actions admin-panel__tempban">
          <span className="admin-panel__label">Temp ban{name ? ' ' + name : ''}</span>
          {BAN_LENGTHS.map(([label, h]) => (
            <button key={h} className={'admin-panel__chip' + (Number(hours) === h ? ' admin-panel__chip--on' : '')} onClick={() => setHours(String(h))}>{label}</button>
          ))}
          <input className="admin-panel__input admin-panel__input--short" value={hours} onChange={(e) => setHours(e.target.value)} title="Hours" />
          <span className="admin-panel__hint">hours</span>
          <Confirm text="Temp ban" width={130} disabled={!target || !hoursOk} onConfirm={() => target && adminAction(events, 'tempBan', { target, hours: Number(hours) })} />
        </div>
      ) : null}
      {bans.length ? (
        <div className="admin-panel__bans">
          <div className="admin-panel__section">Bans</div>
          {bans.map((b) => (
            <div key={b.id} className="admin-panel__row">
              <span className="admin-panel__cell admin-panel__cell--name">{b.name || 'profile ' + b.profileId}</span>
              <span className="admin-panel__cell admin-panel__cell--ip">{b.ip ? 'IP ' + b.ip : 'profile ' + b.profileId}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{b.until ? 'until ' + new Date(b.until).toLocaleString() : 'permanent'}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{b.by}</span>
              {canBan ? <Button text="Unban" width={90} height={28} onClick={() => adminAction(events, 'unban', { target: b.id })} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export interface MasteryTarget {
  name: string;
  target: string;
  detail: {
    skills: Array<{ id: string; label: string; chosen: boolean; rank: number; hours: number }>;
    tierNames: string[];
    tierHours: number[];
    maxChosen: number;
    schools?: Array<{ name: string; level: number; role: string; roleLabel: string }> | null; // fork server-f3-admin, from schools.js; null without it
  } | null;
}

export const SkillsTab = ({ events, masteryTarget, who, canSpawn }: {
  events: Record<string, string>; masteryTarget: MasteryTarget | null; who: string; canSpawn: boolean;
}) => {
  const load = (): void => adminRequest(events, 'adminMasteryRequest', targetFields(who));
  useEffect(() => { load(); }, [who]);
  const detail = masteryTarget && masteryTarget.detail;
  const target = masteryTarget ? masteryTarget.target : '';
  return (
    <div className="admin-panel__body">
      <div className="admin-panel__filters">
        <Button text="Reload" width={96} height={32} onClick={load} />
        <span className="admin-panel__hint">{masteryTarget ? (canSpawn ? 'Editing ' : 'Viewing ') + (masteryTarget.name || 'you') : 'Loading'}</span>
      </div>
      {!detail ? <div className="admin-panel__empty">No skill data yet</div> : (
        <div className="admin-panel__list admin-panel__list--skills">
          {detail.skills.map((sk) => (
            <div key={sk.id} className={'admin-panel__row' + (sk.chosen ? ' admin-panel__row--selected' : '')}>
              <span className="admin-panel__cell admin-panel__cell--name">{sk.label}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{sk.chosen ? (detail.tierNames[sk.rank] || '-') + ' · ' + sk.hours : 'not followed'}</span>
              {canSpawn ? (
                <span className="admin-panel__tiers">
                  {detail.tierNames.map((t, i) => (
                    <button key={t} className={'admin-panel__chip' + (sk.chosen && sk.rank === i ? ' admin-panel__chip--on' : '')}
                      onClick={() => adminAction(events, 'masterySetTier', { target, skill: sk.id, tier: i })}>{t}</button>
                  ))}
                </span>
              ) : null}
              {canSpawn && sk.chosen ? <Button text="Set aside" width={100} height={28} onClick={() => adminAction(events, 'masteryDrop', { target, skill: sk.id })} /> : null}
            </div>
          ))}
        </div>
      )}
      <span className="admin-panel__hint">
        {canSpawn ? `A tier puts the character at its first point; skills past the ${detail ? detail.maxChosen : 3}-skill limit are allowed. Set aside is a free respec.` : 'Changing skills is for a Lead GM and above.'}
      </span>
    </div>
  );
};

// ---- the Players tab's character care: the diseases (L1) and the school levels (N7), Lead GM and above -------------
const SCHOOL_ORDER = ['Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration'];
export const PlayerCare = ({ events, who, selfId, name, masteryTarget, canSpawn }: {
  events: Record<string, string>; who: string; selfId: string; name: string; masteryTarget: MasteryTarget | null; canSpawn: boolean;
}) => {
  const [levels, setLevels] = useState<Record<string, string>>({});
  useEffect(() => { if (canSpawn) adminRequest(events, 'adminMasteryRequest', targetFields(who)); }, [who, canSpawn]);
  // The detail for this target only; a late answer for someone else is not shown
  const want = who || selfId;
  const mine = masteryTarget && masteryTarget.detail && (!want || masteryTarget.target === want) ? masteryTarget : null;
  const schools = (mine && mine.detail && mine.detail.schools) || [];
  useEffect(() => { setLevels({}); }, [who, masteryTarget]);
  if (!canSpawn) return null;
  const fields = (extra: Record<string, unknown>): Record<string, unknown> => Object.assign({}, targetFields(who), extra);
  const sorted = SCHOOL_ORDER.map((n) => schools.find((x) => x.name === n)).filter(Boolean) as Array<{ name: string; level: number; role: string; roleLabel: string }>;
  return (
    <div className="admin-panel__care">
      <div className="admin-panel__power">
        <span className="admin-panel__label">Disease <span className="admin-panel__hint">for {name || 'you'}: the fever runs its days, then they turn</span></span>
        <div className="admin-panel__actions">
          <Confirm text="Sanguinare Vampiris" width={240} onConfirm={() => adminAction(events, 'giveDisease', fields({ kind: 'vampire' }))} />
          <Confirm text="Sanies Lupinus" width={200} onConfirm={() => adminAction(events, 'giveDisease', fields({ kind: 'werewolf' }))} />
        </div>
      </div>
      <div className="admin-panel__power">
        <span className="admin-panel__label">Curse <span className="admin-panel__hint">for {name || 'you'}: the whole curse at once, no fever; Cure makes them mortal</span></span>
        <div className="admin-panel__actions">
          <Confirm text="Vampire" width={130} onConfirm={() => adminAction(events, 'giveCurse', fields({ kind: 'vampire' }))} />
          <Confirm text="Pure-blood" width={140} onConfirm={() => adminAction(events, 'giveCurse', fields({ kind: 'purevampire' }))} />
          <Confirm text="Werewolf" width={140} onConfirm={() => adminAction(events, 'giveCurse', fields({ kind: 'werewolf' }))} />
          <Confirm text="Blessed werewolf" width={200} onConfirm={() => adminAction(events, 'giveCurse', fields({ kind: 'blessedwerewolf' }))} />
          <Confirm text="Cure" width={100} onConfirm={() => adminAction(events, 'giveCurse', fields({ kind: 'cure' }))} />
        </div>
      </div>
      <div className="admin-panel__power">
        <span className="admin-panel__label">Vampire stage <span className="admin-panel__hint">their thirst, 1 (fed) to 4 (starving); only on a vampire</span></span>
        <div className="admin-panel__actions">
          {[1, 2, 3, 4].map((n) => <Confirm key={n} text={`Stage ${n}`} width={110} onConfirm={() => adminAction(events, 'giveCurse', fields({ kind: 'stage', stage: n }))} />)}
        </div>
      </div>
      <div className="admin-panel__power">
        <span className="admin-panel__label">Schools of magic <span className="admin-panel__hint">0 to 100; a closed school set above 0 rests at that level</span></span>
        {!sorted.length ? <span className="admin-panel__hint">{!mine ? 'Loading their schools' : mine.detail && Array.isArray(mine.detail.schools) ? 'Not a mage yet: no school of magic has opened to them.' : 'Magic data unavailable.'}</span> : sorted.map((sc) => {
          const priest = sc.name === 'Restoration';
          const text = levels[sc.name] !== undefined ? levels[sc.name] : String(sc.level);
          const n = Number(text);
          const valid = text.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 100 && n !== sc.level;
          return (
            <div key={sc.name} className="admin-panel__school">
              <span className="admin-panel__school-name">{sc.name}</span>
              <span className="admin-panel__school-role">{sc.roleLabel || sc.role}</span>
              <input type="range" min={0} max={100} step={1} className="admin-panel__range" disabled={priest} value={Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : sc.level}
                onChange={(e) => setLevels(Object.assign({}, levels, { [sc.name]: e.target.value }))} />
              <input className="admin-panel__input admin-panel__input--short" disabled={priest} value={text}
                onChange={(e) => setLevels(Object.assign({}, levels, { [sc.name]: e.target.value }))} />
              {priest ? <span className="admin-panel__hint">follows Priest: set it on the Skills tab</span>
                : <Button text="Set" width={72} height={28} disabled={!valid} onClick={() => adminAction(events, 'setSchool', fields({ school: sc.name, level: n }))} />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface ItemCategory {
  id: string;
  label: string;
  items: Array<[string, string, string?]>; // desc, name, plugin
}

const PAGE = 200;

// The catalog is handed to the browser once as window.__dboAdminItems; itemsVersion changes when it arrives
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const catalog = (): ItemCategory[] | null => ((window as any).__dboAdminItems as ItemCategory[]) || null;

export const ItemsTab = ({ events, itemsVersion, who, canSpawn }: {
  events: Record<string, string>; itemsVersion: number; who: string; canSpawn: boolean;
}) => {
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [mod, setMod] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [count, setCount] = useState('1');
  const [shown, setShown] = useState(PAGE);
  const recent = useRecent('items');
  const favs = useFavourites('items');
  const categories = useMemo(catalog, [itemsVersion]);
  useEffect(() => { if (!categories) adminRequest(events, 'adminItemsRequest', {}); }, []);
  const plugins = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories || []) for (const it of c.items) if (it[2]) set.add(it[2]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categories]);
  // Search text per item (name, editor id, form), built once per catalog
  const index = useMemo(() => {
    const out: Array<{ desc: string; name: string; plugin: string; cat: string; catLabel: string; hay: string }> = [];
    for (const c of categories || []) for (const it of c.items) {
      const name = it[2] === undefined ? humanize(it[1]) : it[1];
      out.push({ desc: it[0], name, plugin: it[2] || '', cat: c.id, catLabel: c.label, hay: name + ' ' + it[1] + ' ' + it[0] });
    }
    return out;
  }, [categories]);
  const q = search.trim();
  // Typed text searches every category (fuzzy, best first); a chip narrows it, and with no text shows its whole list
  const matches = useMemo(() => fuzzyFilter(index.filter((r) => !mod || r.plugin === mod), q, (r) => r.hay), [index, q, mod]);
  const rows = useMemo(() => (cat ? matches.filter((r) => r.cat === cat) : q ? matches : []), [matches, cat, q]);
  useEffect(() => setShown(PAGE), [q, cat, mod]);
  const chips: SearchChip[] = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of matches) m[r.cat] = (m[r.cat] || 0) + 1;
    return [{ id: '', label: 'All', count: matches.length }].concat((categories || []).map((c) => ({ id: c.id, label: c.label, count: m[c.id] || 0 })).filter((c) => !q || c.count));
  }, [matches, categories, q]);
  const cursor = useCursor(Math.min(shown, rows.length));
  const pickedRow = index.find((r) => r.desc === picked) || null;
  const countOk = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 100000;
  const spawn = (desc?: string): void => {
    const item = desc || picked;
    if (!item || !countOk || !canSpawn) return;
    const row = index.find((r) => r.desc === item);
    if (row) recent.push({ id: row.desc, label: row.name });
    adminAction(events, 'giveItem', Object.assign({ item, count: Number(count) }, targetFields(who)));
  };
  // Enter picks the highlighted row, and spawns it when it is already picked
  const enter = (): void => {
    const r = rows[cursor.at];
    if (!r) return;
    if (picked === r.desc) spawn(r.desc); else setPicked(r.desc);
  };
  return (
    <div className="admin-panel__body">
      <SearchBar value={search} onChange={setSearch} placeholder="Search items by name or editor id" autoFocus
        chips={chips} chip={cat} onChip={setCat} plugins={plugins} plugin={mod} onPlugin={setMod}
        onMove={cursor.move} onEnter={enter} recent={recent.items} favourites={favs.items} onPick={(id) => setPicked(id)} />
      <div className="admin-panel__list admin-panel__list--items">
        {!categories ? <div className="admin-panel__empty">Loading items</div> : !rows.length ? (
          <div className="admin-panel__empty">{q || cat ? 'No items' : 'Type to search, or pick a category'}</div>
        ) : (
          rows.slice(0, shown).map((r, i) => <ItemRow key={r.desc} row={r} showCat={!cat} on={i === cursor.at} picked={r.desc === picked} fav={favs.has(r.desc)}
            onPick={() => { setPicked(r.desc); cursor.setAt(i); }} onSpawn={() => { setPicked(r.desc); spawn(r.desc); }} onFav={() => favs.toggle({ id: r.desc, label: r.name })} />)
        )}
        <MoreRow shown={Math.min(shown, rows.length)} total={rows.length} onMore={() => setShown(shown + PAGE)} />
      </div>
      {canSpawn ? (
        <div className="admin-panel__actions">
          <span className="admin-panel__label">{pickedRow ? pickedRow.name : 'Pick an item (double-click or Enter twice spawns)'}</span>
          <span className="admin-panel__label">Count</span>
          <input className="admin-panel__input admin-panel__input--short" value={count} onChange={(e) => setCount(e.target.value)} />
          <Button text="Spawn" width={110} height={32} disabled={!picked || !countOk} onClick={() => spawn()} />
        </div>
      ) : <span className="admin-panel__hint">Spawning items is for a Lead GM and above.</span>}
    </div>
  );
};

const ItemRow = ({ row, showCat, on, picked, fav, onPick, onSpawn, onFav }: {
  row: { desc: string; name: string; plugin: string; catLabel: string }; showCat: boolean; on: boolean; picked: boolean; fav: boolean;
  onPick: () => void; onSpawn: () => void; onFav: () => void;
}) => {
  const ref = useScrollIntoView(on);
  return (
    <div ref={ref} className={'admin-panel__row admin-panel__row--clickable' + (picked ? ' admin-panel__row--selected' : '') + (on ? ' admin-panel__row--cursor' : '')}
      onClick={onPick} onDoubleClick={onSpawn}>
      <button className={'admin-panel__star' + (fav ? ' admin-panel__star--on' : '')} title={fav ? 'Remove from favourites' : 'Add to favourites'}
        onClick={(e) => { e.stopPropagation(); onFav(); }}>{fav ? '\u2605' : '\u2606'}</button>
      <span className="admin-panel__cell admin-panel__cell--name">{row.name}</span>
      {showCat ? <span className="admin-panel__cell admin-panel__cell--discord">{row.catLabel}</span> : null}
      <span className="admin-panel__cell admin-panel__cell--discord">{row.plugin.replace(/\.(esp|esm|esl)$/i, '')}</span>
    </div>
  );
};

interface TeleportPoint {
  name: string;
  region: string;
  worldName: string;
}

const REGIONS = ['Skyrim', 'Cyrodiil', 'Morrowind', 'Hammerfell', 'Other', 'Custom'];

export const TeleportTab = ({ events, locationsVersion }: { events: Record<string, string>; locationsVersion: number }) => {
  const [region, setRegion] = useState('Cyrodiil');
  const [world, setWorld] = useState('');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const recent = useRecent('teleport');
  const favs = useFavourites('teleport');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = useMemo(() => ((window as any).__dboAdminLocations as TeleportPoint[]) || null, [locationsVersion]);
  useEffect(() => { if (!all) adminRequest(events, 'adminLocationsRequest', {}); }, []);
  const q = search.trim();
  // Typed text searches every region (fuzzy, best first), so a name you half remember is always findable
  const matches = useMemo(() => fuzzyFilter(all || [], q, (l) => l.name + ' ' + l.worldName + ' ' + l.region), [all, q]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of matches) m[l.region] = (m[l.region] || 0) + 1;
    return m;
  }, [matches]);
  // A region that the data has but REGIONS never listed would otherwise be unreachable except by search
  const regions = useMemo(() => {
    const known = REGIONS.filter((r) => counts[r]);
    return known.concat(Object.keys(counts).filter((r) => REGIONS.indexOf(r) === -1).sort());
  }, [counts]);
  useEffect(() => { if (!q && regions.length && !counts[region]) setRegion(regions[0]); }, [regions]);
  const inScope = useMemo(() => (region ? matches.filter((l) => l.region === region) : matches), [matches, region]);
  const worlds = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of inScope) m[l.worldName || '-'] = (m[l.worldName || '-'] || 0) + 1;
    return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b)).map((w) => ({ w, n: m[w] }));
  }, [inScope]);
  const rows = useMemo(() => {
    const list = world ? inScope.filter((l) => (l.worldName || '-') === world) : inScope;
    return q ? list : list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [inScope, world, q]);
  useEffect(() => { setShown(PAGE); }, [q, region, world]);
  useEffect(() => { if (world && !worlds.some((x) => x.w === world)) setWorld(''); }, [worlds]);
  const cursor = useCursor(Math.min(shown, rows.length));
  const go = (name: string): void => {
    if (!events.tpLoc) return;
    recent.push({ id: name, label: name });
    send(events.tpLoc, name);
  };
  const chips: SearchChip[] = (q ? [{ id: '', label: 'All', count: matches.length }] : []).concat(regions.map((r) => ({ id: r, label: r, count: counts[r] || 0 })));
  return (
    <div className="admin-panel__body">
      <SearchBar value={search} onChange={(v) => { setSearch(v); if (v.trim() && !search.trim()) setRegion(''); }} placeholder="Search every region" autoFocus
        chips={chips} chip={region} onChip={(r) => { setRegion(r); setWorld(''); }}
        onMove={cursor.move} onEnter={() => rows[cursor.at] && go(rows[cursor.at].name)}
        recent={recent.items} favourites={favs.items} onPick={go} />
      {worlds.length > 1 ? (
        <div className="admin-panel__filters admin-panel__filters--sub">
          <button className={'admin-panel__chip' + (world ? '' : ' admin-panel__chip--on')} onClick={() => setWorld('')}>All {inScope.length}</button>
          {worlds.map((x) => (
            <button key={x.w} className={'admin-panel__chip' + (x.w === world ? ' admin-panel__chip--on' : '')} onClick={() => setWorld(x.w)}>{x.w} {x.n}</button>
          ))}
        </div>
      ) : null}
      <div className="admin-panel__list">
        {!all ? <div className="admin-panel__empty">Loading locations</div> : rows.length === 0 ? <div className="admin-panel__empty">No locations</div> : (
          rows.slice(0, shown).map((l, i) => <LocationRow key={l.region + '|' + l.worldName + '|' + l.name} l={l} showRegion={!!q} on={i === cursor.at}
            fav={favs.has(l.name)} onFav={() => favs.toggle({ id: l.name, label: l.name })} onGo={() => go(l.name)} />)
        )}
        <MoreRow shown={Math.min(shown, rows.length)} total={rows.length} onMore={() => setShown(shown + PAGE)} />
      </div>
    </div>
  );
};

const LocationRow = ({ l, showRegion, on, fav, onFav, onGo }: { l: TeleportPoint; showRegion: boolean; on: boolean; fav: boolean; onFav: () => void; onGo: () => void }) => {
  const ref = useScrollIntoView(on);
  return (
    <div ref={ref} className={'admin-panel__row admin-panel__row--location' + (on ? ' admin-panel__row--cursor' : '')}>
      <button className={'admin-panel__star' + (fav ? ' admin-panel__star--on' : '')} title={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={onFav}>{fav ? '\u2605' : '\u2606'}</button>
      <span className="admin-panel__cell admin-panel__cell--name">{l.name}</span>
      <span className="admin-panel__cell admin-panel__cell--discord">{showRegion ? l.region + ' · ' : ''}{l.worldName}</span>
      <Button text="Teleport" width={112} height={30} onClick={onGo} />
    </div>
  );
};

// ---- powers ------------------------------------------------------------------------------------
const BEASTS: Array<{ key: 'werewolf' | 'vampirelord'; label: string; give: string }> = [
  { key: 'werewolf', label: 'Werewolf', give: 'giveWerewolf' },
  { key: 'vampirelord', label: 'Vampire Lord', give: 'giveVampireLord' },
];

// Names for the staff polymorph animals, used ONLY when the server sent none (an older beastform.js with no
// __dboPolymorphPanel). The live list comes from the server, because it is the animal table narrowed by what
// resolves in the load order and by config beastform.polymorph.forms: a list kept here would offer a shape the
// server refuses. 'rabbit' is a command alias rather than a form of its own and is kept for the same reason.
export const CREATURE_FORMS: Record<string, string> = {
  chicken: 'Chicken', rabbit: 'Rabbit', hare: 'Hare', goat: 'Goat', fox: 'Fox', dog: 'Dog', skeever: 'Skeever', mudcrab: 'Mudcrab', deer: 'Deer',
};

// A form's name: the server's where it sent one, else the fallback table, else the editor id read as words
export const creatureLabel = (form: string, forms?: Array<{ key: string; name: string }> | null): string => {
  const sent = forms && forms.find((f) => f.key === form);
  return (sent && sent.name) || CREATURE_FORMS[form] || humanize(form);
};

export const currentShape = (form: string, forms?: Array<{ key: string; name: string }> | null): string => {
  const name = form === 'vampirelord' ? 'Vampire Lord' : form === 'werewolf' ? 'werewolf' : creatureLabel(form, forms).toLowerCase();
  return 'Currently ' + (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
};

// "for 3 min", or nothing when the server sent no 'since' (an older beastform.js)
export const forMinutes = (minutes: number | null): string =>
  minutes === null || !(minutes >= 0) ? '' : ` for ${minutes} min`;

export const PowersTab = ({ events, who, beast, canSpawn, polymorph, polymorphed, selfBeast }: {
  events: Record<string, string>; who: string; beast?: BeastState; canSpawn: boolean;
  polymorph?: PolymorphInfo | null; polymorphed?: PolymorphedRow[]; selfBeast?: BeastState;
}) => {
  const fields = (extra?: Record<string, unknown>): Record<string, unknown> => Object.assign({}, targetFields(who), extra || {});
  const state = (key: 'werewolf' | 'vampirelord'): string => {
    if (!beast) return 'state unknown';
    if (beast.form === key) return 'transformed now';
    return beast[key] ? 'power held' : 'not granted';
  };
  const forms = polymorph ? polymorph.forms : null;
  // An animal shape is one the server marked as a creature; on an older server fall back to "a form that is
  // neither beast power", which is what this file used to decide by its own list
  const isAnimal = (b?: BeastState): boolean =>
    !!b && !!b.form && (b.creature === true || (b.creature === undefined && !BEASTS.some((x) => x.key === b.form)));
  // Polymorph changes only your own shape, so the picker ignores the target selector entirely (the server's
  // polymorphSelf action takes no target at all). It is closed while you are already in a shape.
  const myForm = selfBeast && selfBeast.form ? selfBeast.form : null;
  const pickable = !!polymorph && polymorph.on && canSpawn && !myForm;
  return (
    <div className="admin-panel__body">
      <div className="admin-panel__filters">
        <span className="admin-panel__hint">
          {beast ? (beast.form ? currentShape(beast.form, forms) : 'In their own shape') : 'Refresh to read their state'}
        </span>
      </div>
      <div className="admin-panel__powers">
        {/* Your own shape and the Owners' switch, which no chat command shows before you try */}
        {polymorph ? (
          <div className="admin-panel__power">
            <span className="admin-panel__label">
              Polymorph <span className="admin-panel__hint">
                {polymorph.on ? 'on' : 'off'}
                {polymorph.setBy ? ` (${polymorph.setBy === 'admin' ? 'set by an Owner' : `from ${polymorph.setBy}`})` : ''}
                {myForm ? `, you are ${/^[aeiou]/i.test(creatureLabel(myForm, forms)) ? 'an' : 'a'} ${creatureLabel(myForm, forms).toLowerCase()}` : ', you are in your own shape'}
              </span>
            </span>
            {canSpawn && myForm && isAnimal(selfBeast) ? (
              <div className="admin-panel__actions">
                <Button text="Revert me" width={118} height={32} onClick={() => adminAction(events, 'beastForm', { form: myForm, op: 'revert' })} />
              </div>
            ) : null}
          </div>
        ) : null}
        {/* The picker, fed by the server. Hidden entirely when the server sent no list rather than guessing one */}
        {polymorph && canSpawn ? (
          <div className="admin-panel__power">
            <span className="admin-panel__label">Take an animal shape <span className="admin-panel__hint">yourself only</span></span>
            <div className="admin-panel__actions">
              {forms && forms.length
                ? forms.map((f) => (
                  <Button key={f.key} text={f.name} width={110} height={32} disabled={!pickable}
                          onClick={() => adminAction(events, 'polymorphSelf', { form: f.key })} />
                ))
                : <span className="admin-panel__hint">No animal is open for polymorph on this server.</span>}
            </div>
          </div>
        ) : null}
        {/* Who is an animal right now, with a Revert for each. The server already accepts a creature key for
            op revert, so this needs no action of its own */}
        {canSpawn && polymorphed && polymorphed.length ? (
          <div className="admin-panel__power">
            <span className="admin-panel__label">In an animal shape now</span>
            <div className="admin-panel__actions">
              {polymorphed.map((r) => (
                <span key={r.id || 'me'} className="admin-panel__hint">
                  {r.label}: {r.name}{forMinutes(r.minutes)}
                  <Button text="Revert" width={96} height={28}
                          onClick={() => adminAction(events, 'beastForm', Object.assign({}, targetFields(r.id), { form: r.form, op: 'revert' }))} />
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {beast && isAnimal(beast) ? (
          <div className="admin-panel__power">
            <span className="admin-panel__label">{creatureLabel(beast.form as string, forms)} <span className="admin-panel__hint">transformed now</span></span>
            {canSpawn ? (
              <div className="admin-panel__actions">
                <Button text="Revert" width={96} height={32} onClick={() => adminAction(events, 'beastForm', fields({ form: beast.form, op: 'revert' }))} />
              </div>
            ) : null}
          </div>
        ) : null}
        {BEASTS.map((b) => (
          <div key={b.key} className="admin-panel__power">
            <span className="admin-panel__label">{b.label} <span className="admin-panel__hint">{state(b.key)}</span></span>
            {canSpawn ? (
              <div className="admin-panel__actions">
                <Button text="Grant power" width={132} height={32} onClick={() => adminAction(events, b.give, fields())} />
                <Button text="Transform now" width={140} height={32} onClick={() => adminAction(events, 'beastForm', fields({ form: b.key, op: 'now' }))} />
                <Button text="Revert" width={96} height={32} disabled={!!beast && beast.form !== b.key} onClick={() => adminAction(events, 'beastForm', fields({ form: b.key, op: 'revert' }))} />
                <Confirm text="Revoke" width={110} onConfirm={() => adminAction(events, 'beastForm', fields({ form: b.key, op: 'revoke' }))} />
              </div>
            ) : null}
          </div>
        ))}
        {/* Give all spells and Give all shouts, back after 8d07b6c3 removed them on 17 Oct. The server batches the
            spells a few a tick and caps both, and replies when the batch finishes, so these are Confirm rather than
            plain buttons: 252 spells is not something to hand out by a mis-click on the wrong target. */}
        {canSpawn ? (
          <div className="admin-panel__power">
            <span className="admin-panel__label">Everything <span className="admin-panel__hint">every tome spell, every shout a player can learn</span></span>
            <div className="admin-panel__actions">
              <Confirm text="Give all spells" width={180} onConfirm={() => adminAction(events, 'giveSpells', fields())} />
              <Confirm text="Give all shouts" width={180} onConfirm={() => adminAction(events, 'giveShouts', fields())} />
            </div>
          </div>
        ) : null}
        <span className="admin-panel__hint">
          {canSpawn
            ? 'To make a player a vampire or a werewolf in play, give the disease on the Players tab. Grant gives the vanilla power so it can be cast in game; Transform now changes shape from here, which does not need the cast to reach the server. Revoke takes the power back and reverts the shape. Polymorph changes your own shape only, never anyone else\'s, and the server ends it if you go indoors or into water, die, log out, or a player comes near whose game cannot show the animal. You can still revert anyone else from the list above.'
            : 'Powers are for a Lead GM and above. You can see who holds what.'}
        </span>
      </div>
    </div>
  );
};

// The Place tab's catalog is searched on the server (placement.js placeSearch) and arrives a page at a time, so all of it,
// Statics included, is reachable without loading 44,000 rows into the browser. placeMeta gives the categories, the mods
// and what this admin's tier may do.
export interface PlaceMeta {
  categories: Array<{ id: string; label: string; kind: 'npc' | 'object'; count: number }>;
  plugins: string[];
  rights: { place: boolean; hostile: boolean; others: boolean; tier: string; placeNeeds: string } | null;
}
// items: [desc, name, plugin, category, kind]
export interface PlaceResults { query: string; category: string; plugin: string; offset: number; total: number; items: Array<[string, string, string, string, 'npc' | 'object']> }

// The "Placed near me" list (server placement.js placeList), nearest first in the admin's own cell or world
export interface PlacedItem {
  id: string; base?: string; name: string; kind: 'npc' | 'object'; hostile?: boolean; dist: number; by?: number; at?: string;
  pos?: number[]; rot?: number[]; mine?: boolean; group?: string;
}
export interface PanelPlacements { items: PlacedItem[]; here: number; total: number; at: number }

// The saved sets (server placement.js placeSets)
export interface PlaceSet { name: string; count: number; by?: number; at?: string }

interface PlaceRow { desc: string; name: string; plugin: string; cat: string; kind: 'npc' | 'object' }
const SEARCH_DELAY_MS = 250;
// Rows per search page, as placement.js sends them
const SEARCH_PAGE = 100;
const SET_RADII = [10, 20, 40, 60];
// The Warband view (server warband.js viewOf, packet adminWarbandView; Nat 25 Oct, W1-W10)
export interface WarbandView {
  members: Array<{ id: string; name: string; alive: boolean; dist: number | null; fighting: boolean }>;
  counts: Array<{ name: string; count: number }>;
  placed: Array<{ id: string; name: string; hostile: boolean; alive: boolean; dist: number | null }>;
  players: Array<{ id: string; name: string; dist: number | null }>;
  npcs: Array<{ id: string; name: string; gm: string; foe: boolean; dist: number | null }>;
  stance: string; side: string; enemies: string[];
  plan: { calm: number; kept: string; unread: string };
  presets: Array<{ name: string; count: number; what: string }>;
  onLogout: string; maxBand: number; maxRaise: number;
  last: { text: string; at: number } | null; at?: number;
}
const WARBAND_COUNTS = [1, 2, 3, 5, 8, 10, 15, 20, 25];
type PlaceView = 'catalog' | 'placed' | 'sets' | 'warband';
const VIEWS: Array<[PlaceView, string]> = [['catalog', 'Catalog'], ['placed', 'Placed near me'], ['sets', 'Sets'], ['warband', 'Warband']];

export const PlaceTab = ({ events, placements, meta, results, sets, warband: band }: { events: Record<string, string>; placements: PanelPlacements | null; meta: PlaceMeta | null; results: PlaceResults | null; sets: PlaceSet[] | null; warband?: WarbandView | null }) => {
  const [view, setView] = useState<PlaceView>('catalog');
  const [placedPick, setPlacedPick] = useState<string | null>(null);
  const [setPick, setSetPick] = useState<string | null>(null);
  const [setNameInput, setSetNameInput] = useState('');
  const [setRadius, setSetRadius] = useState(20);
  const [bandCount, setBandCount] = useState(1);
  const [sideInput, setSideInput] = useState('');
  const [presetName, setPresetName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [mod, setMod] = useState('');
  const [picked, setPicked] = useState<PlaceRow | null>(null);
  const [hostile, setHostile] = useState(true);
  const recent = useRecent('place');
  const favs = useFavourites('place');
  useEffect(() => { adminRequest(events, 'adminPlaceMeta', {}); }, []);
  useEffect(() => { if (meta && meta.categories.length && !cat) setCat(meta.categories[0].id); }, [meta]);
  const q = search.trim().toLowerCase();
  // Typing waits a moment before asking the server, so a word is one search, not one per letter
  useEffect(() => {
    if (!q && !cat) return;
    const t = setTimeout(() => adminRequest(events, 'adminPlaceSearch', { query: q, category: q ? '' : cat, plugin: mod, offset: 0 }), q ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(t);
  }, [q, cat, mod]);
  // Only results for what is asked now; an older answer arriving late is not shown
  const current = results && results.query === q && results.category === (q ? '' : cat) && results.plugin === mod ? results : null;
  const rows: PlaceRow[] = useMemo(() => (current ? current.items.map((it) => ({ desc: it[0], name: it[1], plugin: it[2] || '', cat: it[3], kind: it[4] })) : []), [current]);
  const rights = meta && meta.rights;
  const cursor = useCursor(rows.length);
  // A recent or favourite pick carries its whole row, so it can be placed without searching for it again
  const pickSaved = (id: string): void => { try { const r = JSON.parse(id); if (r && r.desc) setPicked(r as PlaceRow); } catch (e) { /* an old entry */ } };
  const mayPlace = !rights || rights.place;
  const mayHostile = !rights || rights.hostile;
  const start = (row?: PlaceRow): void => {
    const r = row || picked;
    if (!r || !mayPlace) return;
    recent.push({ id: JSON.stringify(r), label: r.name });
    send('admin::place', JSON.stringify({ desc: r.desc, kind: r.kind, name: r.name, hostile: r.kind === 'npc' && hostile && mayHostile }));
  };
  const more = (): void => { if (current) adminRequest(events, 'adminPlaceSearch', { query: q, category: q ? '' : cat, plugin: mod, offset: current.items.length }); };
  const placed = placements ? placements.items : [];
  const placedRow = placed.find((r) => r.id === placedPick) || null;
  const placedAction = (type: string): void => { if (placedRow) adminRequest(events, type, { id: placedRow.id }); };
  // Another GM's placement needs the "others" right (older servers send no "mine": allowed, the server still checks)
  const mayChangeRow = !!placedRow && (placedRow.mine !== false || !rights || rights.others);
  // Edit: placement mode starts on the real thing's pose; Enter moves it there (PlacementService)
  const editPlaced = (): void => {
    if (!placedRow || !placedRow.base || !placedRow.pos) return;
    send('admin::placeedit', JSON.stringify({ id: placedRow.id, base: placedRow.base, kind: placedRow.kind, name: placedRow.name, hostile: !!placedRow.hostile, pos: placedRow.pos, rot: placedRow.rot || [0, 0, 0] }));
  };
  const placeAnother = (): void => {
    if (!placedRow || !placedRow.base || !mayPlace) return;
    send('admin::place', JSON.stringify({ desc: placedRow.base, kind: placedRow.kind, name: placedRow.name, hostile: placedRow.kind === 'npc' && !!placedRow.hostile && mayHostile }));
  };
  const setRows = sets || [];
  const warband = (text: string): void => adminRequest(events, 'adminWarband', { text });
  const bandNpc = picked && picked.kind === 'npc' ? picked : null;
  const catLabel = (id: string): string => ((meta && meta.categories.find((c) => c.id === id)) || { label: id }).label;
  // Opening a view asks the server for what it shows
  const open = (v: PlaceView): void => {
    setView(v);
    if (v === 'placed') adminRequest(events, 'adminPlacementsRequest', {});
    if (v === 'sets') adminRequest(events, 'adminPlaceSets', {});
    if (v === 'warband') adminRequest(events, 'adminWarbandView', {});
  };
  const viewBar = (
    <div className="admin-panel__filters">
      {VIEWS.map(([v, label]) => <Button key={v} text={label} width={v === 'placed' ? 150 : 104} height={28} disabled={view === v} onClick={() => open(v)} />)}
    </div>
  );

  let pane: JSX.Element;
  if (view === 'placed') {
    pane = (
      <div className="admin-panel__itempane">
        {viewBar}
        <div className="admin-panel__list admin-panel__list--items">
          {!placements ? <div className="admin-panel__empty">Loading what was placed</div> : placed.length === 0 ? (
            <div className="admin-panel__empty">Nothing placed here{placements.total ? ` (${placements.total} elsewhere)` : ''}</div>
          ) : (
            placed.map((r) => (
              <div key={r.id} className={'admin-panel__row admin-panel__row--clickable' + (r.id === placedPick ? ' admin-panel__row--selected' : '')}
                onClick={() => setPlacedPick(r.id)}>
                <span className="admin-panel__cell admin-panel__cell--name">{r.name}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{r.kind === 'npc' ? (r.hostile ? 'NPC, hostile' : 'NPC, friendly') : 'Object'}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{r.group ? r.group.split('#')[0] : ''}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{r.dist} m</span>
              </div>
            ))
          )}
        </div>
        <div className="admin-panel__actions">
          <span className="admin-panel__label">
            {placedRow ? placedRow.name : placements ? `${placements.here} here, ${placements.total} in all (nearest 50 shown)` : ''}
          </span>
          <Button text="Go to" width={96} height={32} disabled={!placedRow} onClick={() => placedAction('adminPlacementGoto')} />
          <Button text="Edit" width={90} height={32} disabled={!mayChangeRow || !placedRow || !placedRow.base} onClick={editPlaced} />
          <Button text="Place another" width={140} height={32} disabled={!placedRow || !placedRow.base || !mayPlace} onClick={placeAnother} />
          <Button text="Remove" width={104} height={32} disabled={!mayChangeRow} onClick={() => { placedAction('adminPlacementRemove'); setPlacedPick(null); }} />
          <Button text="Clear group" width={130} height={32} disabled={!mayChangeRow || !placedRow || !placedRow.group} onClick={() => { placedAction('adminPlaceGroupClear'); setPlacedPick(null); }} />
          <Button text="Undo" width={90} height={32} onClick={() => adminRequest(events, 'adminPlaceUndo', {})} />
          <Button text="Refresh" width={104} height={32} onClick={() => open('placed')} />
        </div>
      </div>
    );
  } else if (view === 'sets') {
    pane = (
      <div className="admin-panel__itempane">
        {viewBar}
        <div className="admin-panel__list admin-panel__list--items">
          {!sets ? <div className="admin-panel__empty">Loading the sets</div> : setRows.length === 0 ? (
            <div className="admin-panel__empty">No sets yet. Place things, stand among them and save them as a set below.</div>
          ) : (
            setRows.map((r) => (
              <div key={r.name} className={'admin-panel__row admin-panel__row--clickable' + (r.name === setPick ? ' admin-panel__row--selected' : '')}
                onClick={() => setSetPick(r.name)}>
                <span className="admin-panel__cell admin-panel__cell--name">{r.name}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{r.count} placement{r.count === 1 ? '' : 's'}</span>
              </div>
            ))
          )}
        </div>
        <div className="admin-panel__actions">
          <span className="admin-panel__label">{setPick || 'Pick a set'}</span>
          <Button text="Put down here" width={150} height={32} disabled={!setPick || !mayPlace} onClick={() => setPick && adminRequest(events, 'adminPlaceSetPlace', { name: setPick })} />
          <Button text="Delete set" width={120} height={32} disabled={!setPick} onClick={() => { if (setPick) adminRequest(events, 'adminPlaceSetDelete', { name: setPick }); setSetPick(null); }} />
        </div>
        <div className="admin-panel__actions">
          <input className="admin-panel__search" placeholder="Name for a new set" value={setNameInput} maxLength={40} onChange={(e) => setSetNameInput(e.target.value)} />
          <Picker className="admin-panel__select" value={setRadius} onChange={setSetRadius}
            options={SET_RADII.map((m) => ({ value: m, label: `within ${m} m` }))} />
          <Button text="Save placements near me" width={230} height={32} disabled={!setNameInput.trim()} onClick={() => adminRequest(events, 'adminPlaceSetSave', { name: setNameInput.trim(), radius: setRadius })} />
        </div>
      </div>
    );
  } else if (view === 'warband') {
    // One screen (Nat, 25 Oct): search and raise here, the band with its counts, orders, a settle plan before settling,
    // targets near the GM, sides, the raiders and garrison with removal, saved bands and what happens at logout. Every
    // step is answered with the server's view (adminWarbandView) and its last line shows at the top
    const wb = band || null;
    const counts = WARBAND_COUNTS.filter((n) => !wb || n <= Math.min(wb.maxRaise, wb.maxBand));
    const npcRows = rows.filter((r) => r.kind === 'npc');
    const ask = (text: string): void => { setConfirm(null); setSettling(false); warband(text); };
    const meters = (d: number | null): string => (d === null ? 'elsewhere' : `${d} m`);
    pane = (
      <div className="admin-panel__itempane">
        {viewBar}
        {wb && wb.last ? <div className="admin-panel__label admin-panel__warband-last">{wb.last.text}</div> : null}
        <SearchBar value={search} onChange={setSearch} placeholder="Search NPCs to raise"
          chips={(meta ? meta.categories : []).map((c) => ({ id: c.id, label: c.label, count: c.count }))} chip={q ? '' : cat} onChip={(id) => { setCat(id); setSearch(''); }}
          plugins={meta ? meta.plugins : []} plugin={mod} onPlugin={setMod} onMove={cursor.move}
          onEnter={() => { const r = npcRows[0]; if (r) setPicked(r); }} recent={recent.items} favourites={favs.items} onPick={pickSaved} />
        <div className="admin-panel__list admin-panel__list--items">
          {!current ? <div className="admin-panel__empty">{meta ? 'Searching' : 'Loading the catalog'}</div> : npcRows.length === 0 ? <div className="admin-panel__empty">No NPC matches</div> : (
            npcRows.map((r) => (
              <div key={r.desc} className={'admin-panel__row admin-panel__row--clickable' + (bandNpc && bandNpc.desc === r.desc ? ' admin-panel__row--selected' : '')} onClick={() => setPicked(r)}>
                <span className="admin-panel__cell admin-panel__cell--name">{r.name}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{r.plugin.replace(/\.(esp|esm|esl)$/i, '')}</span>
              </div>
            ))
          )}
        </div>
        <div className="admin-panel__actions">
          <span className="admin-panel__label">{bandNpc ? bandNpc.name : 'Pick an NPC above'}</span>
          <Picker className="admin-panel__select" value={bandCount} onChange={setBandCount} options={counts.map((n) => ({ value: n, label: String(n) }))} />
          <Button text="Raise" width={96} height={32} disabled={!bandNpc || !mayPlace} onClick={() => bandNpc && ask(`raise ${bandNpc.desc} ${bandCount}`)} />
          <Button text="Refresh" width={104} height={32} onClick={() => adminRequest(events, 'adminWarbandView', {})} />
        </div>
        <div className="admin-panel__list admin-panel__list--items">
          {!wb ? <div className="admin-panel__empty">Loading your warband</div> : wb.members.length === 0 ? <div className="admin-panel__empty">You lead no warband. Raise one above, or a saved band below.</div> : (
            wb.members.map((m) => (
              <div key={m.id} className="admin-panel__row">
                <span className="admin-panel__cell admin-panel__cell--name">{m.name}{m.alive ? '' : ' (dead)'}{m.fighting ? ' (fighting)' : ''}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{meters(m.dist)}</span>
                <Button text="Dismiss" width={96} height={26} onClick={() => ask(`dismiss ${m.id}`)} />
              </div>
            ))
          )}
        </div>
        {wb && wb.members.length ? (
          <div className="admin-panel__actions">
            <span className="admin-panel__label">{wb.counts.map((c) => `${c.count} ${c.name}`).join(', ')} &middot; {wb.members.length}/{wb.maxBand} &middot; {wb.stance === 'charging' ? 'charging' : wb.stance === 'stay' ? 'holding' : 'following'}</span>
            <Button text="Follow" width={96} height={32} disabled={wb.stance === 'follow'} onClick={() => ask('follow')} />
            <Button text="Stay" width={90} height={32} disabled={wb.stance === 'stay'} onClick={() => ask('stay')} />
            <Button text="Unleash (raid)" width={150} height={32} disabled={!mayHostile} onClick={() => ask('unleash')} />
            <Button text="Settle (garrison)" width={170} height={32} onClick={() => setSettling(true)} />
            <Button text="Dismiss all" width={120} height={32} onClick={() => setConfirm('dismiss')} />
          </div>
        ) : null}
        {settling && wb ? (
          <div className="admin-panel__actions">
            <span className="admin-panel__label">
              {wb.plan.calm} will stay as a garrison.{wb.plan.kept ? ` Aggressive by nature, not settled: ${wb.plan.kept}.` : ''}{wb.plan.unread ? ` Cannot be checked, not settled: ${wb.plan.unread}.` : ''}
            </span>
            <Button text="Settle the calm ones" width={190} height={32} disabled={!wb.plan.calm} onClick={() => ask('settle calm')} />
            {wb.plan.kept || wb.plan.unread ? <Button text="...and unleash the rest" width={200} height={32} disabled={!mayHostile} onClick={() => ask('settle unleashrest')} /> : null}
            {wb.plan.kept || wb.plan.unread ? <Button text="...and dismiss the rest" width={200} height={32} onClick={() => ask('settle dismissrest')} /> : null}
            <Button text="Cancel" width={96} height={32} onClick={() => setSettling(false)} />
          </div>
        ) : null}
        {confirm === 'dismiss' ? (
          <div className="admin-panel__actions">
            <span className="admin-panel__label">Dismiss your whole warband?</span>
            <Button text="Dismiss all" width={120} height={32} onClick={() => ask('dismiss')} />
            <Button text="Cancel" width={96} height={32} onClick={() => setConfirm(null)} />
          </div>
        ) : null}
        {wb && wb.members.length ? (
          <div className="admin-panel__actions">
            <span className="admin-panel__label">Targets near you{wb.players.length || wb.npcs.length ? '' : ': none'}</span>
            {wb.players.map((p) => <Button key={p.id} text={`${p.name} ${meters(p.dist)}`} width={180} height={28} onClick={() => ask(`attack ${p.name}`)} />)}
            {wb.npcs.map((n) => <Button key={n.id} text={`${n.foe ? 'Enemy: ' : ''}${n.name} (${n.gm}) ${meters(n.dist)}`} width={240} height={28} onClick={() => ask(`attacknpc ${n.id}`)} />)}
          </div>
        ) : null}
        <div className="admin-panel__actions">
          <input className="admin-panel__search" placeholder={wb && wb.side ? `Side: ${wb.side}` : 'Side (for a staged battle)'} value={sideInput} maxLength={24}
            onChange={(e) => setSideInput(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <Button text="Set side" width={110} height={32} disabled={!sideInput.trim()} onClick={() => { ask(`side ${sideInput.trim()}`); setSideInput(''); }} />
          <Button text="No side" width={100} height={32} disabled={!wb || !wb.side} onClick={() => ask('side none')} />
          <Button text={wb && wb.stance === 'charging' ? 'Charging' : 'Charge'} width={110} height={32} disabled={!wb || !wb.side || !wb.members.length} onClick={() => ask('charge')} />
          <span className="admin-panel__label">{wb && wb.side ? (wb.enemies.length ? `Enemies: ${wb.enemies.join(', ')}` : 'No GM on another side yet') : 'No side: every GM’s band is a friend'}</span>
        </div>
        <div className="admin-panel__list admin-panel__list--items">
          {wb && wb.placed.length ? wb.placed.map((r) => (
            <div key={r.id} className="admin-panel__row">
              <span className="admin-panel__cell admin-panel__cell--name">{r.name}{r.alive ? '' : ' (dead)'}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{r.hostile ? 'raider' : 'garrison'} &middot; {meters(r.dist)}</span>
              <Button text="Remove" width={96} height={26} onClick={() => adminRequest(events, 'adminRaid', { text: `clear ${r.id}` })} />
            </div>
          )) : <div className="admin-panel__empty">No raiders or garrison of yours stand.</div>}
        </div>
        <div className="admin-panel__actions">
          <Button text="Clear raiders" width={140} height={32} disabled={!wb || !wb.placed.some((r) => r.hostile)} onClick={() => setConfirm('raiders')} />
          <Button text="Clear garrison" width={150} height={32} disabled={!wb || !wb.placed.some((r) => !r.hostile)} onClick={() => setConfirm('garrison')} />
          {confirm === 'raiders' || confirm === 'garrison' ? (
            <>
              <span className="admin-panel__label">Remove every {confirm === 'raiders' ? 'raider' : 'garrison NPC'} of yours, and their dead?</span>
              <Button text="Remove" width={100} height={32} onClick={() => { adminRequest(events, 'adminRaid', { text: `clear ${confirm}` }); setConfirm(null); }} />
              <Button text="Cancel" width={96} height={32} onClick={() => setConfirm(null)} />
            </>
          ) : null}
        </div>
        <div className="admin-panel__actions">
          <span className="admin-panel__label">Saved bands</span>
          {wb && wb.presets.length ? wb.presets.map((p) => (
            <span key={p.name} title={p.what}>
              <Button text={`Raise ${p.name} (${p.count})`} width={200} height={28} disabled={!mayPlace} onClick={() => ask(`preset raise ${p.name}`)} />
              <Button text="Delete" width={80} height={28} onClick={() => ask(`preset delete ${p.name}`)} />
            </span>
          )) : <span className="admin-panel__label">none yet</span>}
          <input className="admin-panel__search" placeholder="Save this band as..." value={presetName} maxLength={32} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <Button text="Save" width={90} height={32} disabled={!presetName.trim() || !wb || !wb.members.length} onClick={() => { ask(`preset save ${presetName.trim()}`); setPresetName(''); }} />
        </div>
        <div className="admin-panel__actions">
          <span className="admin-panel__label">When you log out, your followers {wb && wb.onLogout === 'settle' ? 'settle where they stand (the calm ones)' : 'are dismissed'}.</span>
          <Button text={wb && wb.onLogout === 'settle' ? 'Dismiss them instead' : 'Settle the calm ones instead'} width={240} height={32} disabled={!wb} onClick={() => ask(`onlogout ${wb && wb.onLogout === 'settle' ? 'dismiss' : 'settle'}`)} />
        </div>
      </div>
    );
  } else {
    pane = (
      <div className="admin-panel__itempane">
        {viewBar}
        <SearchBar value={search} onChange={setSearch} placeholder="Search every NPC and object" autoFocus
          chips={(meta ? meta.categories : []).map((c) => ({ id: c.id, label: c.label, count: c.count }))} chip={q ? '' : cat} onChip={(id) => { setCat(id); setSearch(''); }}
          plugins={meta ? meta.plugins : []} plugin={mod} onPlugin={setMod}
          onMove={cursor.move} onEnter={() => { const r = rows[cursor.at]; if (!r) return; if (picked && picked.desc === r.desc) start(r); else setPicked(r); }}
          recent={recent.items} favourites={favs.items} onPick={pickSaved} />
        <div className="admin-panel__list admin-panel__list--items">
          {!meta || !current ? <div className="admin-panel__empty">{meta ? 'Searching' : 'Loading the catalog'}</div> : rows.length === 0 ? <div className="admin-panel__empty">Nothing matches</div> : (
            rows.map((r, i) => <PlaceCatalogRow key={r.desc} r={r} cat={q ? catLabel(r.cat) : ''} on={i === cursor.at} picked={!!picked && r.desc === picked.desc}
              fav={favs.has(JSON.stringify(r))} onFav={() => favs.toggle({ id: JSON.stringify(r), label: r.name })}
              onPick={() => { setPicked(r); cursor.setAt(i); }} onPlace={() => { setPicked(r); start(r); }} />)
          )}
          {current ? <MoreRow shown={rows.length} total={current.total} onMore={more} step={SEARCH_PAGE} /> : null}
        </div>
        <div className="admin-panel__actions">
          <span className="admin-panel__label">
            {!mayPlace && rights ? `Placing is ${rights.placeNeeds}` : picked ? picked.name : 'Pick something (double-click places)'}
          </span>
          {picked && picked.kind === 'npc' && mayPlace ? (
            <label className="admin-panel__checkbox" title={mayHostile ? '' : 'Hostile NPCs need a higher staff tier'}>
              <input type="checkbox" checked={hostile && mayHostile} disabled={!mayHostile} onChange={(e) => setHostile(e.target.checked)} /> Hostile
            </label>
          ) : null}
          <Button text="Place" width={110} height={32} disabled={!picked || !mayPlace} onClick={() => start()} />
          <Button text="Select tool" width={130} height={32} onClick={() => send('admin::placeselect')} />
        </div>
      </div>
    );
  }

  return <div className="admin-panel__body">{pane}</div>;
};

const PlaceCatalogRow = ({ r, cat, on, picked, fav, onFav, onPick, onPlace }: {
  r: PlaceRow; cat: string; on: boolean; picked: boolean; fav: boolean; onFav: () => void; onPick: () => void; onPlace: () => void;
}) => {
  const ref = useScrollIntoView(on);
  return (
    <div ref={ref} className={'admin-panel__row admin-panel__row--clickable' + (picked ? ' admin-panel__row--selected' : '') + (on ? ' admin-panel__row--cursor' : '')}
      onClick={onPick} onDoubleClick={onPlace}>
      <button className={'admin-panel__star' + (fav ? ' admin-panel__star--on' : '')} title={fav ? 'Remove from favourites' : 'Add to favourites'}
        onClick={(e) => { e.stopPropagation(); onFav(); }}>{fav ? '\u2605' : '\u2606'}</button>
      <span className="admin-panel__cell admin-panel__cell--name">{r.name}</span>
      {cat ? <span className="admin-panel__cell admin-panel__cell--discord">{cat}</span> : null}
      <span className="admin-panel__cell admin-panel__cell--discord">{r.plugin.replace(/\.(esp|esm|esl)$/i, '')}</span>
    </div>
  );
};
