import React, { useEffect, useState } from 'react';

// The Guild tab of the faction panel (server playerguilds.js __dboGuildTabView, inside guilds.js's payload as `band`).
// A player guild is an informal group with none of the faction powers; every button is the /guild command of the same
// name, sent as dbo:guildTab* with the panel's nonce, and the server's answer comes back as the panel's result line.
export interface BandView {
  enabled: boolean;
  maxMembers: number;
  rules: string[];
  // Why this character may have no guild ('' when they may)
  blocked: string;
  mine: { id: string; name: string; rank: number; title: string; master: boolean; officer: boolean; members: number; guildmaster: string } | null;
  invites: { id: string; name: string; from: string }[];
}

type Act = (key: string, ...args: unknown[]) => void;

// A one-line text field with its button; Enter sends it. Keys stay in the field (the game's hotkeys never see them).
// clearOn: the nonce of a panel redrawn after a thing was done (null after a refusal, so the text stays to be corrected)
export const Field = ({ placeholder, label, busy, onSend, clearOn, max }: { placeholder: string; label: string; busy: boolean; onSend: (v: string) => void; clearOn: string | null; max?: number }) => {
  const [text, setText] = useState('');
  useEffect(() => { if (clearOn) setText(''); }, [clearOn]);
  const v = text.trim();
  return (
    <div className="faction__invite-row">
      <input className="faction__input" value={text} placeholder={placeholder} maxLength={max || 60}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && v && !busy) onSend(v); }} />
      <button className="faction__button faction__button--primary" disabled={busy || !v} onClick={() => onSend(v)}>{label}</button>
    </div>
  );
};

// A button that asks once more before it acts
export const Confirm = ({ label, ask, yes, busy, onYes, danger }: { label: string; ask: string; yes: string; busy: boolean; onYes: () => void; danger?: boolean }) => {
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (busy) setAsking(false); }, [busy]);
  if (!asking) return <button className={'faction__button' + (danger ? ' faction__button--danger' : '')} disabled={busy} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="guild-tab__confirm">
      <span className="guild-tab__ask">{ask}</span>
      <button className={'faction__button' + (danger ? ' faction__button--danger' : ' faction__button--primary')} disabled={busy} onClick={onYes}>{yes}</button>
      <button className="faction__button" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
};

export const GuildTab = ({ band, act, busy, nonce }: { band: BandView | null; act: Act; busy: boolean; nonce: string | null }) => {
  if (!band) return <p className="faction__empty">Player guilds are not open.</p>;
  const g = band.mine;
  return (
    <div className="wars guild-tab">
      <div className="war">
        <div className="war__head"><b>Player guilds</b><span className="war__status">no faction powers</span></div>
        <ul className="guild-tab__rules">{band.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>

      {!band.enabled && <p className="war__closed">Guilds are closed right now.</p>}

      {band.invites.map((i) => (
        <div key={'ginv-' + i.id} className="faction__invite">
          <span className="faction__invite-text">{i.from} invites you into the guild <b>{i.name}</b></span>
          <span className="faction__invite-actions">
            <button className="faction__button faction__button--primary" disabled={busy || !band.enabled || !!g} onClick={() => act('dbo:guildTabAccept', i.id)}>Join</button>
            <button className="faction__button" disabled={busy} onClick={() => act('dbo:guildTabDecline', i.id)}>Decline</button>
          </span>
        </div>
      ))}

      {g ? (
        <div className="war">
          <div className="war__head"><b>{g.name}</b><span className="war__status">{g.members} of {band.maxMembers} members</span></div>
          <div className="war__line">You are its {g.title}.{g.master ? '' : g.guildmaster ? ` Its Guildmaster is ${g.guildmaster}.` : ''}</div>
          <div className="war__line war__line--dim">The roster, ranks and removals are on the Members tab.</div>
          {g.officer && band.enabled && (
            <>
              <div className="realm__section-head">Invite</div>
              <Field placeholder="Name or #TAG of someone online" label="Invite" busy={busy || g.members >= band.maxMembers} clearOn={nonce}
                onSend={(v) => act('dbo:guildTabInvite', v)} />
              {g.members >= band.maxMembers && <div className="war__line war__line--dim">The guild is full.</div>}
            </>
          )}
          {g.master && band.enabled && (
            <>
              <div className="realm__section-head">Rename</div>
              <Field placeholder={g.name} label="Rename" busy={busy} clearOn={nonce} onSend={(v) => act('dbo:guildTabRename', v)} />
            </>
          )}
          <div className="war__actions">
            {g.master && g.members > 1 ? (
              <span className="war__line--dim">To leave, make another member Guildmaster on the Members tab first, or disband the guild.</span>
            ) : (
              <Confirm label="Leave the guild" ask={g.master ? `You are its last member: leaving closes ${g.name}.` : `Leave ${g.name}?`} yes="Leave" busy={busy}
                onYes={() => act('dbo:guildTabLeave')} />
            )}
            {g.master && (
              <Confirm label="Disband" ask={`Close ${g.name} for every member?`} yes="Disband" danger busy={busy} onYes={() => act('dbo:guildTabDisband')} />
            )}
          </div>
        </div>
      ) : (
        <div className="war">
          <div className="war__head"><b>Found a guild</b></div>
          {band.blocked ? (
            <div className="war__line war__line--death">{band.blocked}</div>
          ) : band.enabled ? (
            <>
              <div className="war__line war__line--dim">No approval is needed: you become its Guildmaster at once. The name is checked as a faction's would be.</div>
              <Field placeholder="The guild's name" label="Found" busy={busy} clearOn={nonce} onSend={(v) => act('dbo:guildTabCreate', v)} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};
