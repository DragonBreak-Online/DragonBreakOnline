import React, { useEffect, useState } from 'react';

import './DeityTab.scss';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's Deity tab (specs/f3-hub-design.md 3.4), drawn from prayer.js deityView: a faith first, then a patron in it
// (Nate, 18 Oct). "Turn to" asks once more before it sends journalDeity [nonce, deityId, faithId]; the answer lands in the
// footer. A server without faiths sends none, and the tab lists the gods by kind as before.

export interface DeityChoice {
  id: string;
  name: string;
  kind: 'divine' | 'daedra' | 'faith' | string;
  sphere: string;
  boon: string;
  reachable: boolean;
  inBruma: number;
  prayAnywhere: boolean;
  lawful: boolean;
  unlawfulWhere: string;
  aspectOf: string;
  alsoKnownAs: string[];
  note?: string;
}

export interface DeityFaith {
  id: string;
  name: string;
  patrons: string[];
  suggested: boolean;
}

export interface DeitySection {
  current: string;
  faith?: string;
  patronDaysLeft?: number;
  patronChangeDays?: number;
  faiths?: DeityFaith[];
  first: boolean;
  daysLeft: number;
  cooldownDays: number;
  canChoose: boolean;
  choices: DeityChoice[];
}

const GROUPS: Array<[string, string]> = [['divine', 'The Divines'], ['daedra', 'The Daedric Princes'], ['faith', 'Other faiths']];
// Auri-El is Akatosh as the Aldmer know him, not a tenth Divine: he is listed under Akatosh
const ASPECT_NOTE: Record<string, string> = { akatosh: 'the Aldmeri Akatosh' };

// What a faith asks of its sworn, where the server enforces it (greenpact.js)
const FAITH_RULES: Record<string, string> = {
  greenpact: 'A wood elf sworn to the Pact may not cut wood or pick plants, and partakes of the enemies they slay (E on the body). A player\'s body only with their consent.',
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const shrinesLine = (c: DeityChoice): string => {
  if (c.prayAnywhere) return 'No shrine is needed: kneel anywhere and pray.';
  if (c.inBruma > 0) return `${plural(c.inBruma, 'shrine', 'shrines')} in Bruma.`;
  return 'No shrine within reach while the land is closed beyond Bruma.';
};
export const lawLine = (c: DeityChoice): string => (c.lawful ? 'Lawful throughout the Empire.' : c.unlawfulWhere || 'Proscribed in the Empire.');

const DeityRow = ({ c, aspect, current, selected, onPick }: {
  c: DeityChoice; aspect?: string; current: boolean; selected: boolean; onPick: (id: string) => void;
}) => (
  <li className={'jdeity__row' + (selected ? ' jdeity__row--on' : '') + (aspect ? ' jdeity__row--aspect' : '') + (c.reachable ? '' : ' jdeity__row--far')}>
    <button type="button" className="jdeity__pick" onClick={() => onPick(c.id)}>
      <span className="jdeity__name">{c.name}{aspect ? <span className="jdeity__aspect"> ({aspect})</span> : null}</span>
      {current ? <span className="jdeity__mark jdeity__mark--yours">your god</span> : null}
      {!c.lawful ? <span className="jdeity__mark jdeity__mark--unlawful" title="Proscribed in the Empire">Unlawful</span> : null}
      {!c.reachable ? <span className="jdeity__mark jdeity__mark--far" title="No shrine you can reach yet">no shrine within reach</span> : null}
    </button>
  </li>
);

export const DeityTab = ({ section, busy, act }: JournalTabProps<DeitySection>) => {
  const s = section as DeitySection;
  const choices = (s && s.choices) || [];
  const faiths = (s && s.faiths) || [];
  const firstFaith = (s && s.faith) || (faiths.find((f) => f.suggested) || faiths[0] || { id: '' }).id;
  const [faithId, setFaithId] = useState<string>(firstFaith);
  const [picked, setPicked] = useState<string>(() => (s && s.current) || (choices[0] && choices[0].id) || '');
  const [confirm, setConfirm] = useState(false);
  // A new answer (a turn taken or refused) ends the question
  useEffect(() => { setConfirm(false); }, [s && s.current, s && s.faith, s && s.daysLeft, busy]);
  if (!s) return null;
  const byId = (id: string): DeityChoice | undefined => choices.find((c) => c.id === id);
  const faith = faiths.find((f) => f.id === faithId);
  const shown = byId(picked) || choices[0];
  const mine = byId(s.current);
  const myFaith = faiths.find((f) => f.id === s.faith);
  const pick = (id: string): void => { setPicked(id); setConfirm(false); };
  const openFaith = (f: DeityFaith): void => {
    setFaithId(f.id); setConfirm(false);
    if (!f.patrons.includes(picked)) setPicked(f.patrons.includes(s.current) ? s.current : f.patrons[0] || picked);
  };
  const aspects = choices.filter((c) => c.aspectOf);

  // With faiths: the chosen god is taken within the open faith; a new patron in one's faith waits patronDaysLeft, a new faith daysLeft
  const inFaith = !!faith && !!shown && faith.patrons.includes(shown.id);
  const sameFaith = !!faith && faith.id === s.faith;
  const yours = !!shown && shown.id === s.current && (!faiths.length || sameFaith);
  const wait = !mine ? 0 : faiths.length && sameFaith ? Number(s.patronDaysLeft) || 0 : s.daysLeft;
  const keepDays = faiths.length && sameFaith ? Number(s.patronChangeDays) || 1 : s.cooldownDays;
  const stateLine = !mine ? (s.first ? 'You follow no god yet. Your first choice is free and needs no shrine.' : 'You follow no god.')
    : `You follow ${mine.name}${myFaith ? `, in ${myFaith.name}` : ''}.` + (s.daysLeft > 0 ? ` Another faith in ${plural(s.daysLeft, 'day', 'days')}.` : '')
      + (faiths.length && (Number(s.patronDaysLeft) || 0) > 0 ? ` Another god of your faith in ${plural(Number(s.patronDaysLeft), 'day', 'days')}.` : '');
  const verb = mine ? 'Turn to' : 'Take';
  const canTurn = !!shown && !yours && wait === 0 && !busy && (!faiths.length || inFaith);
  const ask = !mine ? `Take ${shown ? shown.name : ''} as your god${faith ? `, in ${faith.name}` : ''}?`
    : faiths.length && sameFaith ? `Turn from ${mine.name} to ${shown ? shown.name : ''} within ${faith ? faith.name : 'your faith'}? You keep a new god at least ${plural(keepDays, 'day', 'days')}.`
      : `Leave ${myFaith ? myFaith.name : mine.name} for ${faith ? faith.name : shown ? shown.name : ''}? You keep a new faith at least ${plural(keepDays, 'day', 'days')}.`;
  const send = (): void => { if (shown) { if (faith) act('journalDeity', shown.id, faith.id); else act('journalDeity', shown.id); } };

  const row = (c: DeityChoice, aspect?: string) => (
    <DeityRow key={c.id} c={c} aspect={aspect} current={c.id === s.current && (!faiths.length || faithId === s.faith)} selected={!!shown && c.id === shown.id} onPick={pick} />
  );

  return (
    <div className="jdeity">
      <nav className="jdeity__list" aria-label={faiths.length ? 'The faiths' : 'The gods'}>
        {faiths.length ? (
          <section className="jdeity__group jdeity__group--faiths">
            <h2 className="journal__heading">The faiths</h2>
            <ul className="jdeity__rows">
              {faiths.slice().sort((x, y) => Number(y.suggested) - Number(x.suggested)).map((f) => (
                <li key={f.id} className={'jdeity__faith' + (f.id === faithId ? ' jdeity__faith--open' : '')}>
                  <button type="button" className="jdeity__pick jdeity__pick--faith" onClick={() => openFaith(f)} aria-expanded={f.id === faithId}>
                    <span className="jdeity__name">{f.name}</span>
                    {f.id === s.faith ? <span className="jdeity__mark jdeity__mark--yours">your faith</span> : null}
                    {f.suggested ? <span className="jdeity__mark jdeity__mark--people">of your people</span> : null}
                  </button>
                  {f.id === faithId ? (
                    <ul className="jdeity__rows jdeity__patrons">
                      {f.patrons.map((id) => byId(id)).filter((c): c is DeityChoice => !!c).map((c) => row(c, c.aspectOf && byId(c.aspectOf) ? `an aspect of ${byId(c.aspectOf)!.name}` : undefined))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : GROUPS.map(([kind, label]) => {
          const rows = choices.filter((c) => c.kind === kind && !c.aspectOf);
          if (!rows.length) return null;
          return (
            <section key={kind} className={`jdeity__group jdeity__group--${kind}`}>
              <h2 className="journal__heading">{label}</h2>
              <ul className="jdeity__rows">
                {rows.map((c) => (
                  <React.Fragment key={c.id}>
                    {row(c)}
                    {aspects.filter((x) => x.aspectOf === c.id).map((x) => row(x, ASPECT_NOTE[c.id] || `an aspect of ${c.name}`))}
                  </React.Fragment>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
      {shown ? (
        <article className="jdeity__page">
          {faith && inFaith ? <p className="jdeity__faithname">{faith.name}</p> : null}
          <h2 className="jdeity__title">{shown.name}</h2>
          {shown.aspectOf && byId(shown.aspectOf) ? <p className="jdeity__known">{`An aspect of ${byId(shown.aspectOf)!.name}`}</p> : null}
          {shown.sphere ? <p className="jdeity__sphere">{shown.sphere}</p> : null}
          {shown.alsoKnownAs && shown.alsoKnownAs.length ? <p className="jdeity__known">Also known as {shown.alsoKnownAs.join(', ')}</p> : null}
          <dl className="jdeity__facts">
            <dt>Boon</dt><dd>{shown.boon || 'None recorded.'}</dd>
            <dt>Shrines</dt><dd>{shrinesLine(shown)}{faith && inFaith ? ` Any shrine of ${faith.name} hears you; your own god's answers most often.` : ''}</dd>
            <dt>Under the law</dt><dd className={shown.lawful ? '' : 'jdeity__unlawful'}>{lawLine(shown)}</dd>
            {faith && inFaith && FAITH_RULES[faith.id] ? <><dt>The faith asks</dt><dd>{FAITH_RULES[faith.id]}</dd></> : null}
          </dl>
          <div className="journal__rule" />
          <p className="jdeity__state">{stateLine}</p>
          <div className="jdeity__actions">
            {yours ? <span className="journal__hint">{shown.name} is your god.</span>
              : confirm ? (
                <>
                  <span className="jdeity__ask">{ask}</span>
                  <button type="button" className="journal__button" onClick={() => setConfirm(false)}>Not yet</button>
                  <button type="button" className="journal__button journal__button--primary" disabled={!canTurn} onClick={send}>{verb} {shown.name}</button>
                </>
              ) : (
                <button type="button" className="journal__button journal__button--primary" disabled={!canTurn} onClick={() => setConfirm(true)}
                  title={wait > 0 ? `You may turn again in ${plural(wait, 'day', 'days')}` : undefined}>{verb} {shown.name}</button>
              )}
          </div>
        </article>
      ) : null}
    </div>
  );
};

registerJournalTab('deity', DeityTab, 'aedric');
