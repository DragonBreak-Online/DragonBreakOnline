import React, { useEffect, useState } from 'react';

// The Courier tab of the pigeon coop window (server couriers.js, Nate 11 Oct). A sender posts a job: up to maxStacks kinds
// of goods, where they go (another place's notice boards, a settlement's drop point, or the recipient in person), who
// receives them, the courier's pay and, if they like, insurance. The board holds the goods and the pay. A courier takes a
// job here and carries ONE sealed parcel until it is delivered or its time (in game days) runs out. A robbed parcel's
// holder opens it here.
//
//   Browser -> server: sendMessage('dbo:courierPost', nonce, destKey, recipientId, pay, insured, itemsJson)
//                      sendMessage('dbo:courierTake' | 'dbo:courierDeliver' | 'dbo:courierOpen' | 'dbo:courierCancel', nonce, jobId)
export interface CourierJob {
  id: number;
  goods: string;
  kinds: number;
  pay: number;
  dest: string;
  kind: 'board' | 'drop' | 'person';
  origin: string;
  sender: string;
  recipient: string;
  insured: number;
  state: string;
  hoursLeft: number;
  gameHoursLeft: number;
  mine: boolean;
  here?: boolean;
}

export interface CourierDestination {
  key: string;
  kind: 'board' | 'drop' | 'person';
  name: string;
  hint: string;
}

export interface CourierGood {
  baseId: number;
  name: string;
  count: number;
  value: number;
}

export interface CourierData {
  enabled: boolean;
  place: string;
  placeId: string;
  destinations: CourierDestination[];
  goods: CourierGood[];
  rules: {
    feeShare: number; minFee: number; premiumRate: number; maxStacks: number; minPay: number; maxPay: number;
    limitGameDays: number; openDays: number; maxCarried: number; maxOpen: number; maxPayoutsPerWeek: number;
  };
  open: CourierJob[];
  carrying: CourierJob[];
  broken: CourierJob[];
  mine: CourierJob[];
}

export interface CourierContact { id: number; name: string; tag: string }

const Digits = ({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) => (
  <input
    className={'pigeon__field' + (className ? ' ' + className : '')}
    inputMode="numeric"
    placeholder={placeholder}
    value={value}
    maxLength={7}
    onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
    onKeyDown={(e) => {
      if (e.key === 'Escape' && !value) return;
      e.stopPropagation();
      if (e.key === 'Escape') onChange('');
    }}
  />
);

const STATE: Record<string, string> = {
  open: 'On the board',
  carried: 'On the road',
  robbed: 'Robbed',
  delivered: 'Delivered',
  expired: 'Ran out of time',
  lapsed: 'No courier came',
  cancelled: 'Taken down',
  returned: 'Came back',
  recovered: 'Found unopened',
  opened: 'Robbed',
  lost: 'Lost',
  cleared: 'Cleared'
};

export const CourierHint = (c: CourierData | undefined): string =>
  !c ? '' : c.enabled ? 'Couriers carry goods for pay. The board holds the goods and the pay until the parcel arrives.' : 'No courier takes work here yet.';

// select: the job shown first (none: the form to post one)
const Courier = ({ c, nonce, gold, contacts, busy, act, select }: {
  c: CourierData; nonce: string; gold: number; contacts: CourierContact[]; busy: boolean; act: (key: string, ...args: unknown[]) => void; select?: number;
}) => {
  const [jobId, setJobId] = useState<number | null>(select === undefined ? null : select);
  const [destKey, setDestKey] = useState<string>(c.destinations.length ? c.destinations[0].key : '');
  const [to, setTo] = useState<number>(0);
  const [packed, setPacked] = useState<Record<number, string>>({});
  const [pay, setPay] = useState('');
  const [insure, setInsure] = useState('');

  // A fresh window: a job that is gone is let go, goods no longer carried leave the parcel
  useEffect(() => {
    const all = c.open.concat(c.carrying, c.broken, c.mine);
    if (jobId !== null && !all.some((j) => j.id === jobId)) setJobId(null);
    if (!c.destinations.some((d) => d.key === destKey)) setDestKey(c.destinations.length ? c.destinations[0].key : '');
    setPacked((p) => Object.fromEntries(Object.entries(p).filter(([id]) => c.goods.some((g) => g.baseId === Number(id)))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const all = c.open.concat(c.carrying, c.broken, c.mine);
  const job = all.filter((j) => j.id === jobId)[0] || null;
  const dest = c.destinations.filter((d) => d.key === destKey)[0] || null;
  const inPerson = !!dest && dest.kind === 'person';
  const recipient = inPerson && to === 0 ? null : to;
  const list = Object.entries(packed).map(([id, n]) => [Number(id), Number(n) || 0] as [number, number]).filter(([, n]) => n > 0);
  const kinds = Object.keys(packed).length;
  const value = list.reduce((s, [id, n]) => { const g = c.goods.find((x) => x.baseId === id); return s + (g ? g.value * n : 0); }, 0);
  const payN = Number(pay) || 0;
  const insureN = Math.min(Number(insure) || 0, value);
  const fee = Math.max(c.rules.minFee, Math.ceil(payN * c.rules.feeShare));
  const premium = insureN > 0 ? Math.ceil(insureN * c.rules.premiumRate) : 0;
  const total = payN + fee + premium;
  const packedOk = list.length > 0 && list.every(([id, n]) => { const g = c.goods.find((x) => x.baseId === id); return !!g && n <= g.count; });
  const canPost = c.enabled && !!dest && recipient !== null && packedOk && payN >= c.rules.minPay && payN <= c.rules.maxPay && gold >= total && !busy;
  const pack = (id: number) => { if (packed[id] === undefined && kinds >= c.rules.maxStacks) return; setPacked((p) => Object.assign({}, p, { [id]: p[id] !== undefined ? p[id] : '1' })); };
  const unpack = (id: number) => setPacked((p) => { const q = Object.assign({}, p); delete q[id]; return q; });
  const days = c.rules.limitGameDays;

  const left = (j: CourierJob) => (j.state === 'carried' ? `${j.gameHoursLeft >= 24 ? Math.floor(j.gameHoursLeft / 24) + ' d ' + (j.gameHoursLeft % 24) + ' h' : j.gameHoursLeft + ' h'} left` : j.state === 'open' ? `${j.hoursLeft} h on the board` : '');
  const row = (j: CourierJob) => (
    <button key={j.id} className={'pigeon__contact' + (j.id === jobId ? ' pigeon__contact--selected' : '')} onClick={() => setJobId(j.id)}>
      <span className="pigeon__contact-name">{j.pay} gold · {j.dest}</span>
      <span className="pigeon__contact-meta">{j.state === 'open' || j.state === 'carried' ? left(j) : STATE[j.state] || j.state}{j.insured ? ' · insured' : ''}{j.here ? ' · deliver here' : ''}</span>
    </button>
  );
  const others = c.open.filter((j) => !j.mine);

  return (
    <div className="pigeon__body">
      <div className="pigeon__contacts">
        {c.carrying.length ? <div className="pigeon__section">You carry ({c.carrying.length} of {c.rules.maxCarried})</div> : null}
        {c.carrying.map(row)}
        {c.broken.length ? <div className="pigeon__section">Broken parcels</div> : null}
        {c.broken.map(row)}
        <div className="pigeon__section">Wanted at {c.place || 'this board'}</div>
        {others.length ? others.map(row) : <p className="pigeon__empty">No one wants a courier here just now.</p>}
        <div className="pigeon__section">Your parcels</div>
        {c.mine.length ? c.mine.map(row) : <p className="pigeon__empty">You have sent nothing by courier.</p>}
      </div>
      <div className="pigeon__letter">
        {job
          ? (
          <div className="pigeon__parcel">
            <div className="pigeon__read-head">For {job.dest}, {job.pay} gold</div>
            <div className="pigeon__parcel-note">
              {job.state === 'robbed' && !job.mine ? 'A broken parcel. Open it to see what is inside.' : job.goods}
            </div>
            <span className="pigeon__parcel-tax">
              From {job.sender} to {job.recipient}, posted at {job.origin}. {STATE[job.state] || job.state}{job.insured ? `, insured for ${job.insured} gold` : ''}.
              {job.state === 'carried' && !job.mine ? ` ${left(job)} (${Math.round(job.hoursLeft)} real hours).` : ''}
            </span>
            <div className="pigeon__read-actions">
              {job.state === 'open' && !job.mine
                ? <button className="pigeon__button pigeon__button--primary" disabled={busy || !c.enabled} onClick={() => act('dbo:courierTake', job.id)}>Carry it ({days} {days === 1 ? 'day' : 'days'})</button>
                : null}
              {job.state === 'open' && job.mine
                ? <button className="pigeon__button" disabled={busy} onClick={() => act('dbo:courierCancel', job.id)}>Take it down</button>
                : null}
              {job.state === 'carried' && job.kind === 'board' && job.here
                ? <button className="pigeon__button pigeon__button--primary" disabled={busy} onClick={() => act('dbo:courierDeliver', job.id)}>Deliver it here</button>
                : null}
              {job.state === 'robbed' && !job.mine
                ? <button className="pigeon__button pigeon__button--primary" disabled={busy} onClick={() => act('dbo:courierOpen', job.id)}>Break it open</button>
                : null}
            </div>
            {job.state === 'carried' && job.kind === 'person' && !job.mine ? <span className="pigeon__parcel-tax">Find {job.recipient} and offer it to them (X on them).</span> : null}
            {job.state === 'carried' && job.kind === 'drop' && !job.mine ? <span className="pigeon__parcel-tax">Hand it in at {job.dest}.</span> : null}
            {job.state === 'open' && job.mine ? <span className="pigeon__parcel-tax">The goods and the pay come back to your mailbox; the fee and the insurance do not.</span> : null}
            <button className="pigeon__mini" onClick={() => setJobId(null)}>Send a parcel instead</button>
          </div>
            )
          : !c.enabled
              ? <p className="pigeon__empty">No courier takes work here yet.</p>
              : (
          <div className="pigeon__parcel">
            <div className="pigeon__read-head">Send goods by courier</div>
            <span className="pigeon__parcel-tax">Where it goes</span>
            <div className="pigeon__goods">
              {c.destinations.map((d) => (
                <button key={d.key} className={'pigeon__good' + (d.key === destKey ? ' pigeon__good--picked' : '')} onClick={() => { setDestKey(d.key); if (d.kind === 'person' && to === 0) setTo(contacts.length ? contacts[0].id : 0); }}>{d.name}</button>
              ))}
            </div>
            {dest && dest.hint ? <span className="pigeon__parcel-tax">The courier hands it in {dest.hint}; the goods wait in the mailbox.</span> : null}
            <span className="pigeon__parcel-tax">Who receives it</span>
            <div className="pigeon__goods">
              {!inPerson ? <button className={'pigeon__good' + (to === 0 ? ' pigeon__good--picked' : '')} onClick={() => setTo(0)}>Yourself</button> : null}
              {inPerson && !contacts.length ? <span className="pigeon__parcel-tax">A parcel in person goes to someone you have met.</span> : null}
              {contacts.map((p) => (
                <button key={p.id} className={'pigeon__good' + (to === p.id ? ' pigeon__good--picked' : '')} onClick={() => setTo(p.id)}>{p.name} <span className="pigeon__contact-tag">#{p.tag}</span></button>
              ))}
            </div>
            {Object.keys(packed).map((k) => {
              const id = Number(k); const g = c.goods.find((x) => x.baseId === id);
              return (
              <div className="pigeon__parcel-row" key={k}>
                <span className="pigeon__parcel-label">{g ? g.name : k}</span>
                <Digits value={packed[id]} onChange={(v) => setPacked((p) => Object.assign({}, p, { [id]: v }))} className="pigeon__field--count" />
                <span className="pigeon__parcel-tax">of {g ? g.count : 0}</span>
                <button className="pigeon__mini" onClick={() => unpack(id)}>Remove</button>
              </div>
              );
            })}
            <div className="pigeon__goods">
              {c.goods.filter((g) => packed[g.baseId] === undefined).map((g) => (
                <button key={g.baseId} className="pigeon__good" disabled={kinds >= c.rules.maxStacks} onClick={() => pack(g.baseId)}>
                  {g.name} <span className="pigeon__contact-tag">x{g.count}</span>
                </button>
              ))}
              {!c.goods.length ? <span className="pigeon__parcel-tax">You carry nothing a courier can take.</span> : null}
            </div>
            <div className="pigeon__parcel-row">
              <span className="pigeon__parcel-label">Courier&apos;s pay</span>
              <Digits value={pay} onChange={setPay} placeholder="Gold" className="pigeon__field--gold" />
            </div>
            <div className="pigeon__parcel-row">
              <span className="pigeon__parcel-label">Insure for (worth {value})</span>
              <Digits value={insure} onChange={setInsure} placeholder="0" className="pigeon__field--gold" />
            </div>
            <span className="pigeon__parcel-tax">
              {payN ? `Pay ${payN}, ${fee} to post${premium ? `, ${premium} insurance` : ''}: ${total} gold. You carry ${gold}.` : `${Math.round(c.rules.feeShare * 100)}% of the pay to post (at least ${c.rules.minFee}); insurance ${Math.round(c.rules.premiumRate * 100)}% of the value, paid by ${c.place || 'the hold'} if it is robbed.`}
              {` Up to ${c.rules.maxStacks} kinds; the courier has ${days} ${days === 1 ? 'day' : 'days'}.`}
            </span>
            <div className="pigeon__read-actions">
              <button className="pigeon__button pigeon__button--primary" disabled={!canPost}
                onClick={() => act('dbo:courierPost', destKey, recipient || 0, payN, insureN, JSON.stringify(list))}>
                {!packedOk ? 'Choose the goods' : recipient === null ? 'Choose who receives it' : gold < total ? 'Not enough gold' : busy ? 'Posting...' : 'Post the job'}
              </button>
            </div>
          </div>
                )}
      </div>
    </div>
  );
};

export default Courier;
