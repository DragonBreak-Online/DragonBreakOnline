import React from 'react';

import './WorldTab.scss';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's World tab (server gamemode.js worldView): what /players, /officials, /playtest, /time, /champions and
// /wildlife say, read by the server on each opening and shown as one page, a group per command.
export interface WorldGroup { name: string; command: string; lines: string[] }
export interface WorldSection { groups: WorldGroup[] }

export const WorldTab = ({ section }: JournalTabProps<WorldSection>) => {
  const s = section as WorldSection;
  if (!s) return null;
  const groups = s.groups || [];
  return (
    <div className="jworld">
      <h2 className="journal__heading">The world</h2>
      <p className="journal__hint">Read when this page opened. Turn to another tab and back to read it again.</p>
      {groups.length
        ? groups.map((g) => (
        <section key={g.command} className="jworld__group">
          <h3 className="jworld__name">{g.name}</h3>
          {g.lines.map((l, i) => <p key={i} className="jworld__line">{l}</p>)}
        </section>
        ))
        : <p className="journal__hint">Nothing to report.</p>}
    </div>
  );
};

registerJournalTab('world', WorldTab, 'aqua');
