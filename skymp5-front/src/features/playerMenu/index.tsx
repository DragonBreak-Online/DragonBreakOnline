import React, { useEffect, useMemo, useRef, useState } from 'react';

import './styles.scss';

// The player menu (server gamemode.js, widget 52), opened with U, /help or a lone "/": tabs by topic, a search across them,
// and a form per command built from its usage (server commandforms.js). Buttons send dbo:menuRun (nonce, command, words);
// the server runs the line through the chat handler, so a panel button passes exactly the checks typing it would.
export interface MenuField {
  label: string;
  placeholder?: string;
  lines?: number;
}

export interface FormArg {
  label: string;
  kind: 'player' | 'number' | 'enum' | 'text';
  options?: string[];
  optional?: boolean;
  rest?: boolean;
}

export interface FormVariant {
  word: string | null;
  args: FormArg[];
}

export interface MenuForm {
  variants: FormVariant[];
}

export interface MenuEntry {
  name: string;
  label: string;
  desc: string;
  ask?: MenuField[] | null;
  form?: MenuForm | null;
  usage?: string;
  section?: string;
}

export interface MenuTab {
  key: string;
  title: string;
  entries: MenuEntry[];
  hints: string[];
}

export interface MenuPerson {
  label: string;
  value: string;
}

export interface PlayerMenuData {
  id: number;
  nonce: string;
  tab: string;
  staff: boolean;
  tabs: MenuTab[];
  people?: MenuPerson[];
  // Commands a key or an object reaches, which the tabs leave out: the search still finds them
  searchOnly?: MenuEntry[];
  search?: string;
}

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('playerMenu sendMessage', key, args);
  }
};

const MAX_FIELD = 300;
const MAX_RESULTS = 40;
const MAX_PEOPLE = 8;

// Keys typed here stay out of the game and out of the global Escape handler, except Escape on an empty box
const keyStop = (value: string, onClear: () => void, onEnter: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Escape' && !value) return;
  e.stopPropagation();
  if (e.key === 'Escape') onClear();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); }
};

const Field = ({ field, value, onChange, onEnter }: {
  field: MenuField; value: string; onChange: (v: string) => void; onEnter: () => void;
}) => {
  const stop = keyStop(value, () => onChange(''), onEnter);
  const long = (field.lines || 1) > 1;
  return (
    <label className="playerMenu__field">
      <span className="playerMenu__label">{field.label}</span>
      {long
        ? (
          <textarea
            className="playerMenu__input playerMenu__input--long"
            rows={field.lines}
            placeholder={field.placeholder || ''}
            value={value}
            maxLength={MAX_FIELD}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={stop}
          />
          )
        : (
          <input
            className="playerMenu__input"
            placeholder={field.placeholder || ''}
            value={value}
            maxLength={MAX_FIELD}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={stop}
          />
          )}
    </label>
  );
};

// One argument of a form: a row of choices for a list of words, the people you know for a name, a box otherwise
const ArgInput = ({ arg, value, onChange, onEnter, people }: {
  arg: FormArg; value: string; onChange: (v: string) => void; onEnter: () => void; people: MenuPerson[];
}) => {
  const label = arg.label + (arg.optional ? ' (optional)' : '');
  if (arg.kind === 'enum' && arg.options && arg.options.length) {
    return (
      <div className="playerMenu__field">
        <span className="playerMenu__label">{label}</span>
        <div className="playerMenu__chips">
          {arg.options.map((o) => (
            <button
              key={o}
              className={'playerMenu__chip' + (value === o ? ' playerMenu__chip--on' : '')}
              onClick={() => onChange(value === o && arg.optional ? '' : o)}
            >{o}</button>
          ))}
        </div>
      </div>
    );
  }
  const stop = keyStop(value, () => onChange(''), onEnter);
  const q = value.trim().toLowerCase();
  const matches = arg.kind === 'player'
    ? people.filter((p) => !q || p.label.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)).slice(0, MAX_PEOPLE)
    : [];
  const picked = arg.kind === 'player' && people.some((p) => p.value === value);
  return (
    <label className="playerMenu__field">
      <span className="playerMenu__label">{label}</span>
      {arg.rest
        ? (
          <textarea
            className="playerMenu__input playerMenu__input--long"
            rows={2}
            value={value}
            maxLength={MAX_FIELD}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={stop}
          />
          )
        : (
          <input
            className="playerMenu__input"
            inputMode={arg.kind === 'number' ? 'numeric' : undefined}
            placeholder={arg.kind === 'player' ? 'a name or #TAG' : ''}
            value={value}
            maxLength={MAX_FIELD}
            onChange={(e) => onChange(arg.kind === 'number' ? e.target.value.replace(/[^0-9-]/g, '') : e.target.value)}
            onKeyDown={stop}
          />
          )}
      {matches.length > 0 && !picked && (
        <div className="playerMenu__chips">
          {matches.map((p) => (
            <button key={p.value} className="playerMenu__chip" onClick={() => onChange(p.value)}>{p.label}</button>
          ))}
        </div>
      )}
    </label>
  );
};

// The words a form sends after the command: the variant's word, then each argument that has a value
const lineOf = (variant: FormVariant | undefined, values: string[]): string => {
  if (!variant) return '';
  const parts: string[] = [];
  if (variant.word) parts.push(variant.word);
  variant.args.forEach((_, i) => { const v = (values[i] || '').replace(/[\r\n]+/g, ' ').trim(); if (v) parts.push(v); });
  return parts.join(' ');
};

const FormBody = ({ entry, form, people, busy, run }: {
  entry: MenuEntry; form: MenuForm; people: MenuPerson[]; busy: boolean; run: (text: string) => void;
}) => {
  const [vi, setVi] = useState(0);
  const variant = form.variants[vi] || form.variants[0];
  const [values, setValues] = useState<string[]>([]);
  const pick = (i: number) => { setVi(i); setValues([]); };
  const ready = !!variant && variant.args.every((a, i) => a.optional || (values[i] || '').trim().length > 0);
  const line = lineOf(variant, values);
  const go = () => { if (ready && !busy) run(line); };
  return (
    <div className="playerMenu__ask">
      {form.variants.length > 1 && (
        <div className="playerMenu__chips">
          {form.variants.map((v, i) => (
            <button
              key={(v.word || '') + i}
              className={'playerMenu__chip' + (i === vi ? ' playerMenu__chip--on' : '')}
              onClick={() => pick(i)}
            >{v.word || (v.args.length ? v.args.map((a) => a.label).join(' ') : 'just ' + entry.label)}</button>
          ))}
        </div>
      )}
      {variant && variant.args.map((a, i) => (
        <ArgInput
          key={a.label + i + vi}
          arg={a}
          value={values[i] || ''}
          onChange={(v) => { const next = values.slice(); next[i] = v; setValues(next); }}
          onEnter={go}
          people={people}
        />
      ))}
      <div className="playerMenu__runRow">
        <span className="playerMenu__preview">{entry.label}{line ? ' ' + line : ''}</span>
        <button className="playerMenu__button" disabled={busy || !ready} onClick={go}>Run</button>
      </div>
    </div>
  );
};

const Entry = ({ entry, nonce, busy, setBusy, people, tag, autoOpen }: {
  entry: MenuEntry; nonce: string; busy: boolean; setBusy: (b: boolean) => void; people: MenuPerson[]; tag?: string; autoOpen?: boolean;
}) => {
  const fields = entry.ask || [];
  const form = entry.form && entry.form.variants && entry.form.variants.length ? entry.form : null;
  // A form with one choice and nothing to fill in is a plain button
  const plainForm = !!form && form.variants.length === 1 && !form.variants[0].args.length;
  // Another panel's button opened this one on a command by name (dbo:menuFind): its form is open at once
  const [open, setOpen] = useState(!!autoOpen);
  const [words, setWords] = useState<string[]>(fields.map(() => ''));
  const [extra, setExtra] = useState('');
  const ready = fields.every((f, i) => (words[i] || '').trim().length > 0);

  const run = (text: string): void => {
    if (busy) return;
    setBusy(true);
    send('dbo:menuRun', nonce, entry.name, text.trim());
  };
  const runAsk = (): void => { if (fields.length && !ready) return; run(words.map((w) => w.trim()).join(' ')); };
  const desc = (
    <span className="playerMenu__desc">
      {tag && <span className="playerMenu__tag">{tag}</span>}
      {entry.desc}
    </span>
  );

  if (form && !plainForm) {
    return (
      <div className="playerMenu__entry playerMenu__entry--asks">
        <div className="playerMenu__entryRow">
          <button className="playerMenu__button" disabled={busy} onClick={() => setOpen(!open)}>{entry.label}</button>
          {desc}
        </div>
        {open && <FormBody entry={entry} form={form} people={people} busy={busy} run={run} />}
      </div>
    );
  }
  if (fields.length) {
    return (
      <div className="playerMenu__entry playerMenu__entry--asks">
        <div className="playerMenu__entryRow">
          <button className="playerMenu__button" disabled={busy} onClick={() => setOpen(!open)}>{entry.label}</button>
          {desc}
        </div>
        {open && (
          <div className="playerMenu__ask">
            {fields.map((f, i) => (
              <Field
                key={f.label}
                field={f}
                value={words[i] || ''}
                onChange={(v) => setWords(words.map((w, j) => (j === i ? v : w)))}
                onEnter={runAsk}
              />
            ))}
            <button className="playerMenu__button" disabled={busy || !ready} onClick={runAsk}>Send</button>
          </div>
        )}
      </div>
    );
  }
  // No usage the server could read: the button runs it bare, and "+" opens a box for any words after it
  return (
    <div className="playerMenu__entry playerMenu__entry--asks">
      <div className="playerMenu__entryRow">
        <button className="playerMenu__button" disabled={busy} onClick={() => run(plainForm ? lineOf(form!.variants[0], []) : '')}>{entry.label}</button>
        {!plainForm && <button className="playerMenu__more" title="add words after the command" onClick={() => setOpen(!open)}>{open ? '−' : '+'}</button>}
        {desc}
      </div>
      {open && !plainForm && (
        <div className="playerMenu__ask">
          <Field field={{ label: 'Words after ' + entry.label }} value={extra} onChange={setExtra} onEnter={() => run(extra)} />
          <div className="playerMenu__runRow">
            <span className="playerMenu__preview">{entry.label}{extra.trim() ? ' ' + extra.trim() : ''}</span>
            <button className="playerMenu__button" disabled={busy} onClick={() => run(extra)}>Run</button>
          </div>
        </div>
      )}
    </div>
  );
};

// Every word of the query must appear in the command, its usage or what it does
const matches = (e: MenuEntry, words: string[]): boolean => {
  const hay = `${e.name} ${e.label} ${e.usage || ''} ${e.desc}`.toLowerCase();
  return words.every((w) => hay.includes(w));
};

// Entries of one tab, under their section headings (the staff tab's topics)
const Sectioned = ({ entries, render }: { entries: MenuEntry[]; render: (e: MenuEntry) => React.ReactNode }) => {
  const out: React.ReactNode[] = [];
  let last: string | undefined;
  for (const e of entries) {
    if (e.section && e.section !== last) out.push(<h3 key={'s:' + e.section} className="playerMenu__heading">{e.section}</h3>);
    last = e.section;
    out.push(render(e));
  }
  return <>{out}</>;
};

const PlayerMenu = ({ data }: { data: PlayerMenuData }) => {
  const tabs = data.tabs || [];
  const people = data.people || [];
  const first = tabs.length ? tabs[0].key : '';
  const [tab, setTab] = useState<string>(data.tab || first);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<string>(data.search || '');
  const searchRef = useRef<HTMLInputElement>(null);

  // A re-sent panel (a topic asked for by name) picks up its tab and lets the next button through
  useEffect(() => {
    setBusy(false);
    if (data.tab && tabs.some((t) => t.key === data.tab)) setTab(data.tab);
    if (typeof data.search === 'string' && data.search) setQuery(data.search);
  }, [data]);
  // Opened with "/" or U: the search box has the keys, so typing finds a command at once
  useEffect(() => { try { if (searchRef.current) searchRef.current.focus(); } catch (e) { /* no focus in a headless page */ } }, [data.nonce]);

  const current = tabs.find((t) => t.key === tab) || tabs[0];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    if (!words.length) return [];
    const seen = new Set<string>();
    const out: Array<{ entry: MenuEntry; title: string }> = [];
    const lists = tabs.map((t) => ({ title: t.title, entries: t.entries })).concat([{ title: 'By key or place', entries: data.searchOnly || [] }]);
    for (const t of lists) {
      for (const e of t.entries) {
        if (seen.has(e.name) || !matches(e, words)) continue;
        seen.add(e.name);
        out.push({ entry: e, title: t.title });
      }
    }
    // A command whose name starts with the query comes first
    out.sort((x, y) => Number(!x.entry.name.startsWith(words[0])) - Number(!y.entry.name.startsWith(words[0])));
    return out.slice(0, MAX_RESULTS);
  }, [query, data]);

  const exact = (data.search || '').trim().toLowerCase();
  const entryOf = (e: MenuEntry, tag?: string) => (
    <Entry key={e.name} entry={e} nonce={data.nonce} busy={busy} setBusy={setBusy} people={people} tag={tag} autoOpen={!!exact && e.name === exact} />
  );

  return (
    <div className="playerMenu">
      <div className="playerMenu__fade" />
      <div className="playerMenu__panel">
        <h2 className="playerMenu__title">What you can do</h2>
        <p className="playerMenu__sub">Everything here can also be typed in chat. A lone / opens this page.</p>

        <input
          ref={searchRef}
          className="playerMenu__input playerMenu__search"
          placeholder="Search every command: party, bank, pigeon, bug..."
          value={query}
          maxLength={60}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={keyStop(query, () => setQuery(''), () => { /* Enter does nothing: a result is chosen by its button */ })}
        />

        {words.length > 0
          ? (
            <div className="playerMenu__section">
              {results.map((r) => entryOf(r.entry, r.title))}
              {results.length === 0 && <span className="playerMenu__empty">No command matches {`"${query.trim()}"`}.</span>}
            </div>
            )
          : (
            <>
              <div className="playerMenu__tabs">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    className={'playerMenu__tab' + (current && t.key === current.key ? ' playerMenu__tab--on' : '')}
                    onClick={() => setTab(t.key)}
                  >{t.title}</button>
                ))}
              </div>

              {current && (
                <div className="playerMenu__section">
                  <Sectioned entries={current.entries} render={(e) => entryOf(e)} />
                  {current.hints.length > 0 && (
                    <div className="playerMenu__hints">
                      {current.hints.map((h) => <span key={h} className="playerMenu__hint">{h}</span>)}
                    </div>
                  )}
                  {current.entries.length === 0 && current.hints.length === 0 && (
                    <span className="playerMenu__empty">Nothing here yet.</span>
                  )}
                </div>
              )}
            </>
            )}

        <div className="playerMenu__foot">
          <button
            className="playerMenu__link"
            onClick={() => { send('dbo:menuClose'); send('dbo:menuSwitchChar'); }}
          >Switch character</button>
          <button className="playerMenu__close" onClick={() => send('dbo:menuClose')}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default PlayerMenu;
