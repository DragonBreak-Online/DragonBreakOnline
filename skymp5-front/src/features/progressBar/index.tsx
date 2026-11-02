import React from 'react';

import './styles.scss';

// A passive bar for a beat the server is timing: actiondelays.js searching, armourswap.js armour in a fight.
export interface ProgressData {
  title?: string;
  ms?: number;
  startedAt?: number;
  kind?: string;
  hint?: string;
}

const ProgressBar = ({ data }: { data: ProgressData }) => {
  const ms = Math.max(0, Number(data.ms) || 0);
  if (!ms) return null;
  const kind = data.kind === 'armour' ? 'armour' : 'search';
  // The fill runs from arrival, not from data.startedAt: that is the server's clock and the two are not in step.
  return (
    <div className={'dboProgress dboProgress--' + kind}>
      <span className="dboProgress__title">{data.title || 'Working'}</span>
      <div className="dboProgress__track">
        <div
          className="dboProgress__fill"
          key={String(data.startedAt || 0) + ':' + String(ms)}
          style={{ animationDuration: ms + 'ms' }}
        />
      </div>
      {data.hint ? <span className="dboProgress__hint">{data.hint}</span> : null}
    </div>
  );
};

export default ProgressBar;
