import React from 'react';

import './NewsTab.scss';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's What's new tab (server whatsnew.js, Nat 7 Nov): the launcher's patch notes, a page of entries at a time.
// Older and Newer ask the server for another page (journalTab focus { page }); opening the tab marks the notes read.

export interface NewsEntry { date: string; title: string; tag: string; sections: { heading: string; items: string[] }[] }
export interface NewsSection { entries: NewsEntry[]; page: number; pages: number; total: number; unread: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const newsDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}` : String(iso || '');
};

export const NewsTab = ({ section, busy, openTab }: JournalTabProps<NewsSection>) => {
  const s = section as NewsSection;
  if (!s) return null;
  const entries = Array.isArray(s.entries) ? s.entries : [];
  const page = Number(s.page) || 0;
  const pages = Math.max(1, Number(s.pages) || 1);
  return (
    <div className="jnews">
      <h2 className="journal__heading">What's new</h2>
      {s.unread > 0 ? <p className="journal__hint">{s.unread === 1 ? 'One note is new since you last looked.' : `${s.unread} notes are new since you last looked.`}</p> : null}
      {entries.length ? entries.map((e, i) => (
        <section className="jnews__entry" key={`${e.date}|${e.title}|${i}`}>
          <h3 className="jnews__title">{e.title}</h3>
          <div className="jnews__meta">{newsDate(e.date)}{e.tag ? <span className="jnews__tag">{e.tag}</span> : null}</div>
          {(e.sections || []).map((x, j) => (
            <div className="jnews__part" key={j}>
              {x.heading ? <h4 className="jnews__heading">{x.heading}</h4> : null}
              <ul className="jnews__items">{(x.items || []).map((t, k) => <li key={k}>{t}</li>)}</ul>
            </div>
          ))}
        </section>
      )) : <p className="journal__hint">No news yet.</p>}
      {pages > 1 ? (
        <div className="jnews__pager">
          <button type="button" className="jnews__button" disabled={busy || page <= 0} onClick={() => openTab('news', { page: page - 1 })}>Newer</button>
          <span className="jnews__where">Page {page + 1} of {pages}</span>
          <button type="button" className="jnews__button" disabled={busy || page >= pages - 1} onClick={() => openTab('news', { page: page + 1 })}>Older</button>
        </div>
      ) : null}
    </div>
  );
};

registerJournalTab('news', NewsTab, 'dragonbreak');
