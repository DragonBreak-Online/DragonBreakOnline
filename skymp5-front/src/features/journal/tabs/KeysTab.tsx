import React from 'react';

import '../../keyRing/styles.scss';
import './KeysTab.scss';
import { KeyRingBody, KeyRingView } from '../../keyRing';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's Keys tab (server keyring.js, Nate 13 Oct): the Key Ring panel's content (widget 91) inside the journal. The
// buttons send the same dbo:keyRing* events with the journal's nonce; keyring.js answers through the journal, whose footer
// carries the result. Shown only while server-settings housingKeyRing is on.
export const KeysTab = ({ section, busy, act }: JournalTabProps<KeyRingView>) => {
  const s = section as KeyRingView;
  if (!s) return null;
  return (
    <div className="jkeys">
      <h2 className="journal__heading">Key Ring</h2>
      <KeyRingBody view={s} busy={busy} act={act} />
    </div>
  );
};

registerJournalTab('keys', KeysTab, 'bronze');
