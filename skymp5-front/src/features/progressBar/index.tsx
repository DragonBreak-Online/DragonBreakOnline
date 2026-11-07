import React, { useEffect, useState } from 'react';

import './styles.scss';

// A passive bar for a beat the server is timing: actiondelays.js searching, armourswap.js armour in a fight.
export interface ProgressData {
  title?: string;
  ms?: number;
  startedAt?: number;
  kind?: string;
  hint?: string;
}

// The server closes the bar when its beat ends; one whose close never came hides itself this long after it filled
// (Payne, 3 Nov: "the searching bar gets stuck on screen", a corpse's bar that waited for a second take)
export const PROGRESS_GRACE_MS = 3000;

const ProgressBar = ({ data }: { data: ProgressData }) => {
  const ms = Math.max(0, Number(data.ms) || 0);
  const beat = String(data.startedAt || 0) + ':' + String(ms);
  const [expired, setExpired] = useState('');
  useEffect(() => {
    if (!ms) return undefined;
    const t = setTimeout(() => setExpired(beat), ms + PROGRESS_GRACE_MS);
    return () => clearTimeout(t);
  }, [beat]);
  if (!ms || expired === beat) return null;
  const kind = data.kind === 'armour' ? 'armour' : 'search';
  // The fill runs from arrival, not from data.startedAt: that is the server's clock and the two are not in step.
  return (
    <div className={'dboProgress dboProgress--' + kind}>
      <span className="dboProgress__title">{data.title || 'Working'}</span>
      <div className="dboProgress__track">
        <div
          className="dboProgress__fill"
          key={beat}
          style={{ animationDuration: ms + 'ms' }}
        />
      </div>
      {data.hint ? <span className="dboProgress__hint">{data.hint}</span> : null}
    </div>
  );
};

export default ProgressBar;
