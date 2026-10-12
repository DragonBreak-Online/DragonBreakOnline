import React from 'react';

import './HelpTab.scss';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's Help tab (server gamemode.js helpView): each button opens the panel (U) at a topic, which asks for the
// words itself (dbo:menuOpen <tab>, '' for the whole panel); the journal gives way to it with the cursor kept.
export interface HelpAction { tab: string; label: string; desc: string }
export interface HelpSection { actions: HelpAction[]; hints: string[] }

const openPanel = (tab: string): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage('dbo:menuOpen', tab);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('journal help menuOpen', tab);
  }
};

export const HelpTab = ({ section }: JournalTabProps<HelpSection>) => {
  const s = section as HelpSection;
  if (!s) return null;
  return (
    <div className="jhelp">
      <h2 className="journal__heading">Help</h2>
      {(s.actions || []).map((x) => (
        <div key={x.tab + x.label} className="jhelp__row">
          <button type="button" className="journal__button journal__button--primary" onClick={() => openPanel(x.tab)}>{x.label}</button>
          <span className="journal__hint">{x.desc}</span>
        </div>
      ))}
      {(s.hints || []).map((h) => <p key={h} className="journal__hint">{h}</p>)}
    </div>
  );
};

registerJournalTab('help', HelpTab, 'dragonbreak');
