import React, { useEffect, useState } from 'react';

import './NotesTab.scss';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 Personal Journal tab (server journalnotes.js; staff suggestion from mestreugway, 6 Oct): private entries in
// folders, writings received from others, and writing an entry out as a note, letter, book or journal at a writing desk.
// The list carries no text: opening a page is a tab switch with a focus (entry, received or work), answered with that
// page's text. Actions are dbo:journalNotes [nonce, op, ...]; the answer lands in the journal's footer.

export interface NotesFolder { id: string; name: string; count: number }
export interface NotesEntry { id: string; folder: string; title: string; at: number; edited: number; length: number }
export interface NotesReceived { id: string; title: string; author: string; itemKind: string; at: number }
export interface NotesCarried { id: string; title: string; author: string; itemKind: string; kept: boolean }
export interface NotesOpen {
  kind: 'entry' | 'received' | 'work'; id: string; title: string; text: string; at: number;
  folder?: string; edited?: number; written?: number; author?: string; itemKind?: string; kept?: boolean;
}
export interface NotesWriteKind { id: string; label: string; paper: number; free: number }
export interface NotesSection {
  ready: boolean;
  limits: { entryMax: number; titleMax: number; entriesMax: number; foldersMax: number; folderNameMax: number; receivedMax: number };
  folders?: NotesFolder[];
  entries?: NotesEntry[];
  received?: NotesReceived[];
  carried?: NotesCarried[];
  open?: NotesOpen | null;
  write?: { on: boolean; atDesk: boolean; requireDesk: boolean; paper: number; kinds: NotesWriteKind[] };
}

// Keys typed here stay out of the game's and the global Escape handler
const keep = (e: React.KeyboardEvent): void => { e.stopPropagation(); };
const dateText = (ms: number): string => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

// Two clicks: the first arms the button, the second does it
const Confirm = ({ label, sure, busy, onYes }: { label: string; sure: string; busy: boolean; onYes: () => void }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return undefined; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button type="button" className={'journal__button' + (armed ? ' jnotes__danger' : '')} disabled={busy}
      onClick={() => { if (armed) { setArmed(false); onYes(); } else setArmed(true); }}>{armed ? sure : label}</button>
  );
};

type Filter = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'received' } | { kind: 'carried' };

export const NotesTab = ({ section, busy, act, openTab }: JournalTabProps<NotesSection>) => {
  const s = section as NotesSection;
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ id: '', folder: '', title: '', text: '' });
  const [folderName, setFolderName] = useState('');
  const [renaming, setRenaming] = useState('');
  const [signed, setSigned] = useState(true);
  const open = s && s.open ? s.open : null;
  // A save comes back as the open page with the text that was sent: the editor closes on it
  useEffect(() => {
    if (editing && open && open.kind === 'entry' && open.text === draft.text && (!draft.id || open.id === draft.id)) setEditing(false);
  }, [open && open.id, open && open.text, open && open.edited]);
  if (!s) return null;
  if (!s.ready) return <p className="journal__empty journal__loading">Turning the page…</p>;
  const L = s.limits;
  const folders = s.folders || [], entries = s.entries || [], received = s.received || [], carried = s.carried || [];
  const N = (op: string, ...args: unknown[]): void => act('dbo:journalNotes', op, ...args);
  const show = (focus: Record<string, string>): void => { setEditing(false); openTab('notes', focus); };
  const folderOf = (id: string): string => (folders.find((f) => f.id === id) || { name: '' }).name;
  const shown = filter.kind === 'folder' ? entries.filter((e) => e.folder === filter.id) : entries;
  const startNew = (): void => {
    setDraft({ id: '', folder: filter.kind === 'folder' ? filter.id : '', title: '', text: '' });
    setEditing(true);
  };
  const startEdit = (o: NotesOpen): void => { setDraft({ id: o.id, folder: o.folder || '', title: o.title, text: o.text }); setEditing(true); };
  const addFolder = (): void => { const n = folderName.trim(); if (!n || busy) return; N('folderAdd', n); setFolderName(''); };
  const selected = filter.kind === 'folder' ? folders.find((f) => f.id === filter.id) : undefined;

  const list = (
    <div className="jnotes__list">
      <div className="jnotes__filters">
        <button type="button" className={'jnotes__filter' + (filter.kind === 'all' ? ' jnotes__filter--on' : '')} onClick={() => setFilter({ kind: 'all' })}>All entries ({entries.length})</button>
        {folders.map((f) => (
          <button type="button" key={f.id} className={'jnotes__filter' + (filter.kind === 'folder' && filter.id === f.id ? ' jnotes__filter--on' : '')}
            onClick={() => setFilter({ kind: 'folder', id: f.id })}>{f.name} ({f.count})</button>
        ))}
        <button type="button" className={'jnotes__filter' + (filter.kind === 'received' ? ' jnotes__filter--on' : '')} onClick={() => setFilter({ kind: 'received' })}>Received ({received.length})</button>
        {carried.length ? (
          <button type="button" className={'jnotes__filter' + (filter.kind === 'carried' ? ' jnotes__filter--on' : '')} onClick={() => setFilter({ kind: 'carried' })}>Writings you carry ({carried.length})</button>
        ) : null}
      </div>

      {filter.kind === 'all' || filter.kind === 'folder' ? (
        <>
          <button type="button" className="journal__button journal__button--primary" disabled={busy || entries.length >= L.entriesMax} onClick={startNew}>New entry</button>
          {shown.length ? shown.map((e) => (
            <button type="button" key={e.id} className={'jnotes__row' + (open && open.kind === 'entry' && open.id === e.id ? ' jnotes__row--on' : '')} onClick={() => show({ entry: e.id })}>
              <span className="jnotes__row-title">{e.title}</span>
              <span className="jnotes__row-meta">{filter.kind === 'all' && e.folder ? `${folderOf(e.folder)} · ` : ''}{dateText(e.edited || e.at)}</span>
            </button>
          )) : <p className="journal__empty">{filter.kind === 'folder' ? 'Nothing in this folder yet.' : 'Your journal is empty. Write what you want to remember: it stays yours alone.'}</p>}
          <p className="journal__hint">{entries.length} of {L.entriesMax} entries.</p>
        </>
      ) : null}
      {filter.kind === 'received' ? (received.length ? received.map((r) => (
        <button type="button" key={r.id} className={'jnotes__row' + (open && open.kind === 'received' && open.id === r.id ? ' jnotes__row--on' : '')} onClick={() => show({ received: r.id })}>
          <span className="jnotes__row-title">{r.title}</span>
          <span className="jnotes__row-meta">{r.itemKind} · {r.author}</span>
        </button>
      )) : <p className="journal__empty">Writings others give you can be copied in here: read one from your pack, or open it under Writings you carry.</p>) : null}
      {filter.kind === 'carried' ? carried.map((w) => (
        <button type="button" key={w.id} className={'jnotes__row' + (open && open.kind === 'work' && open.id === w.id ? ' jnotes__row--on' : '')} onClick={() => show({ work: w.id })}>
          <span className="jnotes__row-title">{w.title}</span>
          <span className="jnotes__row-meta">{w.itemKind} · {w.author}{w.kept ? ' · kept' : ''}</span>
        </button>
      )) : null}

      <div className="jnotes__folders">
        <span className="journal__field-label">Folders</span>
        {selected ? (
          <div className="jnotes__inline">
            <input className="jnotes__input" value={renaming} maxLength={L.folderNameMax} placeholder={selected.name} onKeyDown={keep}
              onChange={(e) => setRenaming(e.target.value)} aria-label="New folder name" />
            <button type="button" className="journal__button" disabled={busy || !renaming.trim()} onClick={() => { N('folderRename', selected.id, renaming.trim()); setRenaming(''); }}>Rename</button>
            <Confirm label="Remove" sure="Remove folder?" busy={busy} onYes={() => { N('folderDelete', selected.id); setFilter({ kind: 'all' }); }} />
          </div>
        ) : null}
        {folders.length < L.foldersMax ? (
          <div className="jnotes__inline">
            <input className="jnotes__input" value={folderName} maxLength={L.folderNameMax} placeholder="New folder" onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => { keep(e); if (e.key === 'Enter') addFolder(); }} aria-label="New folder name" />
            <button type="button" className="journal__button" disabled={busy || !folderName.trim()} onClick={addFolder}>Make</button>
          </div>
        ) : <p className="journal__hint">You keep {L.foldersMax} folders at most.</p>}
      </div>
    </div>
  );

  let page: React.ReactNode;
  if (editing) {
    page = (
      <div className="journal__editor">
        <label className="journal__field">
          <span className="journal__field-head"><span className="journal__field-label">Title</span><span className="journal__field-count">{draft.title.length} / {L.titleMax}</span></span>
          <input className="jnotes__input" value={draft.title} maxLength={L.titleMax} onKeyDown={keep} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="journal__field">
          <span className="journal__field-head">
            <span className="journal__field-label">Page</span>
            <span className={'journal__field-count' + (draft.text.length >= L.entryMax ? ' journal__field-count--full' : '')}>{draft.text.length} / {L.entryMax}</span>
          </span>
          <textarea className="journal__textarea" rows={14} value={draft.text} maxLength={L.entryMax} onKeyDown={keep}
            onChange={(e) => setDraft({ ...draft, text: e.target.value.slice(0, L.entryMax) })} />
        </label>
        <div className="jnotes__inline">
          <span className="journal__hint">Folder:</span>
          {[{ id: '', name: 'None' }].concat(folders).map((f) => (
            <button type="button" key={f.id || 'none'} className={'jnotes__chip' + (draft.folder === f.id ? ' jnotes__chip--on' : '')} onClick={() => setDraft({ ...draft, folder: f.id })}>{f.name}</button>
          ))}
        </div>
        <div className="journal__editor-actions">
          <button type="button" className="journal__button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="journal__button journal__button--primary" disabled={busy || !draft.text.trim()}
            onClick={() => N('save', draft.id, draft.folder, draft.title.trim(), draft.text)}>Save</button>
        </div>
      </div>
    );
  } else if (open) {
    const w = s.write;
    page = (
      <div className="jnotes__page">
        <h2 className="journal__heading">{open.title}</h2>
        <p className="jnotes__meta">
          {open.kind === 'entry' ? `${open.folder ? folderOf(open.folder) + ' · ' : ''}Written ${dateText(open.at)}${open.edited ? `, changed ${dateText(open.edited)}` : ''}`
            : `${open.itemKind} · ${open.author}`}
        </p>
        <p className="journal__prose jnotes__text">{open.text}</p>
        {open.kind === 'entry' ? (
          <>
            <div className="journal__editor-actions">
              <Confirm label="Tear out" sure="Tear it out?" busy={busy} onYes={() => N('delete', open.id)} />
              <button type="button" className="journal__button journal__button--primary" disabled={busy} onClick={() => startEdit(open)}>Edit</button>
            </div>
            {w && w.on ? (
              <div className="jnotes__write">
                <span className="journal__field-label">Write it out</span>
                <p className="journal__hint">
                  {w.atDesk ? `A copy on paper to give or trade; its holder can read it and keep it in their journal. You carry ${w.paper} paper.`
                    : 'Sit at a writing desk or stand at a Scholars\' Ledger, then open your journal to write this out on paper.'}
                </p>
                <div className="jnotes__inline">
                  <button type="button" className={'jnotes__chip' + (signed ? ' jnotes__chip--on' : '')} onClick={() => setSigned(!signed)}>{signed ? 'Signed with your name' : 'Unsigned'}</button>
                  {w.kinds.map((k) => (
                    <button type="button" key={k.id} className="journal__button" disabled={busy || !w.atDesk || !k.free || w.paper < k.paper}
                      title={!k.free ? 'None to be had just now' : undefined} onClick={() => N('write', open.id, k.id, signed ? '1' : '')}>
                      {k.label} ({k.paper} paper)
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {open.kind === 'work' ? (
          <div className="journal__editor-actions">
            {open.kept ? <span className="journal__hint">A copy is in your journal, under Received.</span>
              : <button type="button" className="journal__button journal__button--primary" disabled={busy || received.length >= L.receivedMax} onClick={() => N('keep', open.id)}>Keep a copy in my journal</button>}
          </div>
        ) : null}
        {open.kind === 'received' ? (
          <div className="journal__editor-actions">
            <Confirm label="Remove from my journal" sure="Remove it?" busy={busy} onYes={() => N('forget', open.id)} />
          </div>
        ) : null}
      </div>
    );
  } else {
    page = <p className="journal__empty">Choose a page on the left, or start a new entry. Nobody else can read this journal.</p>;
  }

  return (
    <div className="jnotes">
      {list}
      <div className="jnotes__body">{page}</div>
    </div>
  );
};

registerJournalTab('notes', NotesTab, 'dragonbreak');
export default NotesTab;
