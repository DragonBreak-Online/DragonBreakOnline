import React, { useEffect, useState } from 'react';

import './styles.scss';

// Buying and renting a property (server tenancy.js, widget 81), opened from the door's property menu. It always shows the
// door the player stands at. Actions go to the server as dbo:propertyMarketAct with the window's nonce, the action and its
// arguments; the server answers by sending the panel again with a result line.
export interface MarketInterest { tag: string; name: string }

export interface PropertyMarketData {
  id: number;
  nonce: string;
  name: string;
  hold: string;
  taxPct: number;
  owned: boolean;
  ownerName: string;
  yours: boolean;
  manager: boolean;
  state: 'none' | 'sale' | 'rent' | 'let';
  price?: number;
  deposit?: number;
  weekly?: number;
  asked?: number;
  youAsked?: boolean;
  offeredToYou?: boolean;
  paidUntil?: string;
  overdue?: boolean;
  youRent?: boolean;
  // officials only
  tenantName?: string;
  interest?: MarketInterest[];
  offeredTo?: string;
  maxPrice: number;
  maxDeposit: number;
  maxWeekly: number;
  result: string;
}

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('propertyMarket sendMessage', key, args);
  }
};

const BUSY_TIMEOUT_MS = 8000;
const goldText = (n: number | undefined): string => (Number(n) || 0).toLocaleString('en-US');
const Coin = () => <span className="propMarket__coin" />;
const Gold = ({ n, after }: { n: number | undefined; after?: string }) => <span className="propMarket__gold"><Coin />{goldText(n)}{after || ''}</span>;

// Keys typed here stay out of the game's and the global Escape handler, except Escape on an empty field
const NumberInput = ({ value, onChange, onEnter, placeholder, max }: {
  value: string; onChange: (v: string) => void; onEnter?: () => void; placeholder: string; max: number;
}) => (
  <input
    className="propMarket__input"
    inputMode="numeric"
    placeholder={placeholder}
    value={value}
    maxLength={max}
    onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
    onKeyDown={(e) => {
      if (e.key === 'Escape' && !value) return;
      e.stopPropagation();
      if (e.key === 'Escape') onChange('');
      if (e.key === 'Enter' && onEnter) onEnter();
    }}
  />
);

const statusOf = (d: PropertyMarketData): string => {
  if (d.state === 'sale') return 'For sale';
  if (d.state === 'rent') return 'For rent';
  if (d.state === 'let') return d.youRent ? 'Rented by you' : 'Let';
  if (d.yours) return 'Yours';
  if (d.owned) return `Owned by ${d.ownerName}`;
  return 'Empty';
};

const PropertyMarket = ({ data }: { data: PropertyMarketData }) => {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [weekly, setWeekly] = useState('');
  const [weeks, setWeeks] = useState('1');
  // A re-sent panel ends the action in flight and any question it asked
  useEffect(() => { setBusy(false); setConfirm(''); }, [data]);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => setBusy(false), BUSY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [busy]);
  const act = (action: string, ...args: unknown[]): void => {
    if (busy) return;
    setBusy(true);
    setConfirm('');
    send('dbo:propertyMarketAct', data.nonce, action, ...args.map(String));
  };
  // Buying, leaving and evicting ask once more before they go
  const Ask = ({ id, label, question, action, danger }: { id: string; label: string; question: string; action: () => void; danger?: boolean }) => (
    confirm === id ? (
      <div className="propMarket__confirm">
        <span className="propMarket__note">{question}</span>
        <button className={'propMarket__button' + (danger ? ' propMarket__button--danger' : '')} disabled={busy} onClick={action}>Yes</button>
        <button className="propMarket__link" onClick={() => setConfirm('')}>No</button>
      </div>
    ) : <button className={'propMarket__button' + (danger ? ' propMarket__button--danger' : '')} disabled={busy} onClick={() => setConfirm(id)}>{label}</button>
  );

  const priceN = Number(price) || 0, depositN = Number(deposit), weeklyN = Number(weekly) || 0, weeksN = Math.max(1, Math.min(8, Number(weeks) || 1));
  const empty = !data.owned && data.state !== 'let';
  const moveIn = (data.deposit || 0) + (data.weekly || 0);

  return (
    <div className="propMarket">
      <div className="propMarket__fade" />
      <div className="propMarket__panel">
        <h2 className="propMarket__title">{data.name}</h2>
        <p className="propMarket__sub">{data.hold} · <span className={'propMarket__status propMarket__status--' + data.state}>{statusOf(data)}</span></p>

        <div className="propMarket__figures">
          {data.state === 'sale' && <span className="propMarket__figure"><span className="propMarket__label">Price</span><Gold n={data.price} /></span>}
          {data.state === 'rent' && <span className="propMarket__figure"><span className="propMarket__label">Deposit</span><Gold n={data.deposit} /></span>}
          {(data.state === 'rent' || data.state === 'let') && <span className="propMarket__figure"><span className="propMarket__label">Rent</span><Gold n={data.weekly} after=" a week" /></span>}
          {data.state === 'let' && data.paidUntil && <span className="propMarket__figure"><span className="propMarket__label">Paid until</span><span className={'propMarket__plain' + (data.overdue ? ' propMarket__plain--late' : '')}>{data.paidUntil}{data.overdue ? ' · overdue' : ''}</span></span>}
          <span className="propMarket__figure"><span className="propMarket__label">Property tax</span><span className="propMarket__plain">{data.taxPct}% of its value a week</span></span>
        </div>

        {/* What anyone at the door can do */}
        {data.state === 'sale' && (
          <div className="propMarket__section">
            <p className="propMarket__note">The first to pay owns it outright. The gold goes to {data.hold}, and the house pays the hold's property tax each week on that price.</p>
            <div className="propMarket__row"><Ask id="buy" label={`Buy it for ${goldText(data.price)} gold`} question={`Pay ${goldText(data.price)} gold for ${data.name}?`} action={() => act('buy')} /></div>
          </div>
        )}
        {data.state === 'rent' && (
          <div className="propMarket__section">
            {data.offeredToYou ? (
              <>
                <p className="propMarket__note">It is offered to you. Moving in takes the deposit and the first week: {goldText(moveIn)} gold.</p>
                <div className="propMarket__row"><Ask id="accept" label={`Move in for ${goldText(moveIn)} gold`} question={`Pay ${goldText(moveIn)} gold and move in?`} action={() => act('accept')} /></div>
              </>
            ) : data.youAsked ? (
              <p className="propMarket__note">Your name is down. If the officials offer it to you, come back here to move in.</p>
            ) : (
              <>
                <p className="propMarket__note">{data.asked ? `${data.asked} ${data.asked === 1 ? 'person has' : 'people have'} asked for it. ` : ''}Put your name down; the officials offer it to one of those who asked.</p>
                <div className="propMarket__row"><button className="propMarket__button" disabled={busy} onClick={() => act('interest')}>Ask to rent it</button></div>
              </>
            )}
          </div>
        )}
        {data.state === 'let' && data.youRent && (
          <div className="propMarket__section">
            <span className="propMarket__label">Pay rent</span>
            <div className="propMarket__row">
              <NumberInput value={weeks} onChange={setWeeks} placeholder="Weeks, 1 to 8" max={1} onEnter={() => act('pay', weeksN)} />
              <button className="propMarket__button" disabled={busy} onClick={() => act('pay', weeksN)}>Pay {goldText(weeksN * (data.weekly || 0))} gold</button>
            </div>
            <div className="propMarket__row propMarket__row--end"><Ask id="leave" label="Hand back the keys" question="Leave the house? A tenant in good standing gets the deposit back." action={() => act('leave')} danger /></div>
          </div>
        )}
        {data.state === 'none' && !data.manager && (
          <p className="propMarket__note">{data.yours ? 'This property is yours.' : data.owned ? `It belongs to ${data.ownerName}.` : 'It is neither for sale nor for rent.'}</p>
        )}

        {/* The hold's officials */}
        {data.manager && (
          <div className="propMarket__section propMarket__section--officials">
            <span className="propMarket__heading">For the hold's officials</span>
            {data.owned && data.state !== 'let' && (
              <p className="propMarket__note">{data.ownerName} owns it. Only an empty house can be sold or rented out.</p>
            )}
            {empty && data.state !== 'rent' && (
              <>
                <span className="propMarket__label">{data.state === 'sale' ? 'Change the price' : 'Sell it'}</span>
                <div className="propMarket__row">
                  <NumberInput value={price} onChange={setPrice} placeholder={`Price, 1 to ${goldText(data.maxPrice)} gold`} max={7} onEnter={() => priceN && act('sell', priceN)} />
                  <button className="propMarket__button" disabled={busy || !priceN} onClick={() => act('sell', priceN)}>Put up for sale</button>
                </div>
              </>
            )}
            {empty && data.state !== 'sale' && (
              <>
                <span className="propMarket__label">{data.state === 'rent' ? 'Change the terms' : 'Rent it out'}</span>
                <div className="propMarket__row">
                  <NumberInput value={deposit} onChange={setDeposit} placeholder={`Deposit, up to ${goldText(data.maxDeposit)}`} max={5} />
                  <NumberInput value={weekly} onChange={setWeekly} placeholder={`A week, up to ${goldText(data.maxWeekly)}`} max={4} onEnter={() => weeklyN && act('list', depositN || 0, weeklyN)} />
                  <button className="propMarket__button" disabled={busy || !weeklyN || deposit === ''} onClick={() => act('list', depositN || 0, weeklyN)}>Put up for rent</button>
                </div>
              </>
            )}
            {data.state === 'rent' && (
              <>
                <span className="propMarket__label">Asked to rent it</span>
                <div className="propMarket__list">
                  {(data.interest || []).length === 0 && <span className="propMarket__empty">Nobody yet.</span>}
                  {(data.interest || []).map((p) => (
                    <div key={p.tag} className="propMarket__entry">
                      <span>{p.name}</span>
                      {data.offeredTo === p.name ? <span className="propMarket__plain">Offered</span> : <button className="propMarket__link" disabled={busy} onClick={() => act('offer', p.tag)}>Offer it</button>}
                    </div>
                  ))}
                </div>
              </>
            )}
            {(data.state === 'sale' || data.state === 'rent') && (
              <div className="propMarket__row propMarket__row--end"><button className="propMarket__link" disabled={busy} onClick={() => act('unlist')}>Take it off the market</button></div>
            )}
            {data.state === 'let' && !data.youRent && (
              <>
                <p className="propMarket__note">Let to {data.tenantName}{data.overdue ? ', whose rent is overdue' : ''}.</p>
                <div className="propMarket__row propMarket__row--wrap">
                  <button className="propMarket__button" disabled={busy} onClick={() => act('remind')}>Send a reminder</button>
                  <button className="propMarket__button" disabled={busy} onClick={() => act('grace')}>A week's grace</button>
                  {data.overdue && <Ask id="evict" label="Evict" question={`Evict ${data.tenantName}? The hold keeps the deposit.`} action={() => act('evict')} danger />}
                </div>
              </>
            )}
          </div>
        )}

        {data.result && <p className="propMarket__result">{data.result}</p>}
        <button className="propMarket__close" onClick={() => send('dbo:propertyMarketClose')}>Close</button>
      </div>
    </div>
  );
};

export default PropertyMarket;
