import React, { useEffect, useState } from 'react';

import './styles.scss';

// Books written by players (server authoredbooks.js; Nat, 2 Nov). The gamemode opens this widget (type "book") in one of
// two modes: "read", a written book's pages, and "write", the writer at a Scholars' Ledger. The server is the only judge
// of the title, the pages, the cost and the limits; this page only sends what was typed.
//
//   Browser -> client -> server: sendMessage('dbo:bookWrite', nonce, title, JSON pages, binding)
//   Close / Escape:              sendMessage('dbo:bookClose')
export interface BookData {
  id: number;
  mode: 'read' | 'write';
  // read
  bookId?: number;
  title?: string;
  author?: string;
  faction?: string;
  binding?: string;
  pages?: string[];
  page?: number;
  // write
  nonce?: string;
  maxPages?: number;
  pageChars?: number;
  titleMax?: number;
  costs?: Record<string, string>;
  perPage?: string;
}

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('book sendMessage', key, args);
  }
};

const BINDINGS: Array<[string, string]> = [['book', 'Bound book'], ['tome', 'Leather tome'], ['scroll', 'Scroll (one page)']];

const Reader = ({ data }: { data: BookData }) => {
  const pages = data.pages || [];
  const [page, setPage] = useState(Math.max(0, Math.min(pages.length - 1, Number(data.page) || 0)));
  useEffect(() => { setPage(Math.max(0, Math.min(pages.length - 1, Number(data.page) || 0))); }, [data.bookId, data.page, pages.length]);
  return (
    <div className="book__panel book__panel--read">
      <div className="book__title">{data.title}</div>
      <div className="book__byline">by {data.author}{data.faction ? `, of the ${data.faction}` : ''}</div>
      <div className="book__page">{pages[page] || ''}</div>
      <div className="book__nav">
        <button className="book__button" disabled={page <= 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="book__count">Page {page + 1} of {pages.length}</span>
        <button className="book__button" disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)}>Next</button>
        <button className="book__button book__button--close" onClick={() => send('dbo:bookClose')}>Close</button>
      </div>
    </div>
  );
};

const Writer = ({ data }: { data: BookData }) => {
  const maxPages = Number(data.maxPages) || 10;
  const pageChars = Number(data.pageChars) || 1500;
  const titleMax = Number(data.titleMax) || 60;
  const [title, setTitle] = useState('');
  const [binding, setBinding] = useState('book');
  const [pages, setPages] = useState<string[]>(['']);
  const [at, setAt] = useState(0);
  const limit = binding === 'scroll' ? 1 : maxPages;
  const shown = pages.slice(0, limit);
  const current = Math.min(at, shown.length - 1);
  const edit = (text: string): void => { const next = pages.slice(); next[current] = text.slice(0, pageChars); setPages(next); };
  const ready = title.trim().length >= 3 && shown.every((p) => p.trim().length > 0);
  // Typing stays in the widget: the global Escape handler still closes it
  const keep = (e: React.KeyboardEvent): void => { if (e.key !== 'Escape') e.stopPropagation(); };
  return (
    <div className="book__panel book__panel--write">
      <div className="book__title">Write a book</div>
      <input className="book__input" value={title} maxLength={titleMax} placeholder="Title" onKeyDown={keep} onChange={(e) => setTitle(e.target.value)} />
      <div className="book__bindings">
        {BINDINGS.map(([id, label]) => (
          <button key={id} className={'book__chip' + (binding === id ? ' book__chip--on' : '')} onClick={() => { setBinding(id); if (id === 'scroll') setAt(0); }}>
            {label}{data.costs && data.costs[id] ? `: ${data.costs[id]}` : ''}
          </button>
        ))}
      </div>
      <div className="book__hint">{data.perPage || ''}{data.perPage ? '. ' : ''}A Quill in your pack, not used up.</div>
      <div className="book__tabs">
        {shown.map((_, i) => (
          <button key={i} className={'book__chip' + (i === current ? ' book__chip--on' : '')} onClick={() => setAt(i)}>{i + 1}</button>
        ))}
        {shown.length < limit ? <button className="book__chip" onClick={() => { setPages(pages.concat([''])); setAt(pages.length); }}>+ page</button> : null}
        {shown.length > 1 ? <button className="book__chip" onClick={() => { const next = pages.filter((_, i) => i !== current); setPages(next.length ? next : ['']); setAt(Math.max(0, current - 1)); }}>Remove page</button> : null}
      </div>
      <textarea className="book__text" value={shown[current] || ''} onKeyDown={keep} onChange={(e) => edit(e.target.value)} placeholder={`Page ${current + 1}`} />
      <div className="book__nav">
        <span className="book__count">{(shown[current] || '').length} / {pageChars}</span>
        <button className="book__button" disabled={!ready} onClick={() => send('dbo:bookWrite', data.nonce || '', title.trim(), JSON.stringify(shown.map((p) => p.trim())), binding)}>Write it</button>
        <button className="book__button book__button--close" onClick={() => send('dbo:bookClose')}>Close</button>
      </div>
    </div>
  );
};

const Book = ({ data }: { data: BookData }) => (
  <div className="book">
    <div className="book__fade" />
    {data.mode === 'write' ? <Writer data={data} /> : <Reader data={data} />}
  </div>
);

export default Book;
