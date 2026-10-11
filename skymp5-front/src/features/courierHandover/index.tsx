import React, { useEffect, useState } from 'react';

import './styles.scss';

// A courier's parcel changes hands (server couriers.js, widget 81), two modes:
//   person  a courier offers the recipient a parcel: into the pack, or to the mailbox at the notice boards. A countdown;
//           no answer (or Escape) sends it to the mailbox. Answer: dbo:courierAnswer [nonce, 'take' | 'mailbox'].
//   drop    the courier stands at a settlement's drop point with parcels for it: hand each in, or Not now (ten minutes).
//           dbo:courierDropIn [nonce, jobId] | dbo:courierDismiss [nonce].
export interface CourierHandoverData {
  id: number;
  mode: 'person' | 'drop';
  nonce: string;
  from?: string;
  sender?: string;
  goods?: string;
  seconds?: number;
  place?: string;
  jobs?: { id: number; goods: string; pay: number; recipient: string; sender: string }[];
}

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('courierHandover sendMessage', key, args);
  }
};

const CourierHandover = ({ data }: { data: CourierHandoverData }) => {
  const total = Math.max(1, Number(data.seconds) || 30);
  const [left, setLeft] = useState(total);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setSent(false);
    setLeft(total);
    if (data.mode !== 'person') return undefined;
    const started = Date.now();
    const t = setInterval(() => setLeft(Math.max(0, total - Math.floor((Date.now() - started) / 1000))), 250);
    return () => clearInterval(t);
  }, [data.nonce, total, data.mode]);

  const once = (key: string, ...args: unknown[]) => { if (sent) return; setSent(true); send(key, data.nonce, ...args); };

  if (data.mode === 'drop') {
    const jobs = data.jobs || [];
    return (
      <div className="courierHandover">
        <div className="courierHandover__panel">
          <div className="courierHandover__kicker">Courier&apos;s drop point</div>
          <h2 className="courierHandover__title">{data.place || 'The drop point'}</h2>
          <p className="courierHandover__text">Hand in the sealed parcel here. The goods go to the recipient&apos;s mailbox, and you are paid.</p>
          {jobs.map((j) => (
            <div className="courierHandover__job" key={j.id}>
              <span>For {j.recipient}, from {j.sender}: {j.pay} gold</span>
              <button className="courierHandover__button courierHandover__button--primary" disabled={sent} onClick={() => once('dbo:courierDropIn', j.id)}>Hand in</button>
            </div>
          ))}
          <div className="courierHandover__choices">
            <button className="courierHandover__button" disabled={sent} onClick={() => once('dbo:courierDismiss')}>Not now</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="courierHandover">
      <div className="courierHandover__panel">
        <div className="courierHandover__kicker">A courier&apos;s parcel</div>
        <h2 className="courierHandover__title">{data.from || 'A courier'} has a parcel for you</h2>
        <p className="courierHandover__text">
          Sent by {data.sender || 'someone'}: {data.goods || 'sealed goods'}. Take it now, or have it left in your mailbox at the notice boards.
        </p>
        <div className="courierHandover__clock"><div className="courierHandover__fill" style={{ width: `${(left / total) * 100}%` }} /></div>
        <div className="courierHandover__choices">
          <button className="courierHandover__button courierHandover__button--primary" disabled={sent} onClick={() => once('dbo:courierAnswer', 'take')}>Take it</button>
          <button className="courierHandover__button" disabled={sent} onClick={() => once('dbo:courierAnswer', 'mailbox')}>To my mailbox</button>
        </div>
        <div className="courierHandover__hint">{sent ? 'Answered.' : `${left} s. No answer sends it to your mailbox.`}</div>
      </div>
    </div>
  );
};

export default CourierHandover;
