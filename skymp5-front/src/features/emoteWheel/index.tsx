import React, { useEffect, useRef, useState } from 'react';

import {
  CENTER, EMOTE_INNER, EMOTE_OUTER, HUB_R, VIEW,
  Pick, arcPath, pickAt, pointAt, releaseAction, segmentAngles,
} from './wheelGeometry';
import './styles.scss';

interface EmoteDef {
  anim: string;
  label: string;
}

interface EmoteGroup {
  id: string;
  label: string;
  emotes: EmoteDef[];
}

interface EmoteWheelEvents {
  play: string;
  close: string;
  stop: string;
  [key: string]: string;
}

// The widget object the client pushes through window.skyrimPlatform.widgets (emoteService).
export interface EmoteWheelData {
  groups: EmoteGroup[];
  events: EmoteWheelEvents;
}

// The client's wheel key released after a hold (emoteService): play what the pointer is on
export const RELEASE_EVENT = 'dbo:emoteWheelRelease';

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('emoteWheel sendMessage', key, args);
  }
};

// Our own line glyphs, one per group, on a 24-unit grid; an unknown group gets the Heart's diamond
const GLYPHS: Record<string, string> = {
  greetings: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11 M11 10V4.5a1.5 1.5 0 0 1 3 0V10 M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13 M8 12 6.4 10.6a1.5 1.5 0 0 0-2.1 2.1L9 18c1 1.3 2.4 2 4 2h.8a5 5 0 0 0 5-5v-4.5a1.5 1.5 0 0 0-3 0',
  reactions: 'M12 3l2.2 4.6 5-.8-3.2 3.9 3.2 3.9-5-.8L12 18.4l-2.2-4.6-5 .8L8 10.7 4.8 6.8l5 .8z M12 8.2v3.6 M12 13.6v.4',
  stances: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M12 8.5v5.5 M12 14l-4 6 M12 14l4 3.5H11 M8.5 11h7',
  dialog: 'M4 5h16v10H10l-5 4v-4H4z M8 9h8 M8 12h5',
  activities: 'M6 8h9v11H6z M15 11h2a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-2 M6 8c0-2 2.5-3 4.5-1.8C12.5 5 15 6 15 8 M9 11v5 M12 11v5',
  entertainment: 'M9 17.5V6l10-2v11.5 M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M9 9l10-2',
  recent: 'M12 4a8 8 0 1 1-7.4 5 M4.6 4.5V9h4.4 M12 8v4.5l3 2',
};
const GLYPH_DEFAULT = 'M12 4l6 8-6 8-6-8z';
const glyphOf = (id: string): string => GLYPHS[id] || GLYPH_DEFAULT;

const Glyph = ({ id, x, y, size, className }: { id: string; x: number; y: number; size: number; className: string }) => (
  <path className={className} d={glyphOf(id)} transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`} />
);

// One ring gives an emote's label the wedge's whole width: only a very long name is cut
const shortenLabel = (label: string): string => (label.length <= 22 ? label : label.slice(0, 21) + '.');

// Selection survives close and reopen; the client tears the widget down each time.
let savedGroupId = '';
let savedAnim = '';

const EmoteWheel = ({ data }: { data: EmoteWheelData }) => {
  const groups = data.groups || [];
  const ev = data.events || ({} as EmoteWheelEvents);
  // Opens on Recent (the client puts it first when anything was played this session), else where the last pick was made
  const startGroup = groups[0] && groups[0].id === 'recent' ? 0 : Math.max(0, groups.findIndex((g) => g.id === savedGroupId));
  const [group, setGroup] = useState(startGroup);
  const [pick, setPick] = useState<Pick>({ ring: 'hub', index: -1 });
  const [pointer, setPointer] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const live = useRef({ group, pick });
  live.current = { group, pick };

  const active = groups[group] || groups[0];
  const emotes = active ? active.emotes : [];

  const play = (anim: string) => {
    savedGroupId = active ? active.id : '';
    savedAnim = anim;
    send(ev.play, anim);
  };

  // The pointer, read against the wheel's own centre and scale, so any window size works
  const onMove = (e: React.MouseEvent | MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const k = VIEW / r.width;
    const dx = (e.clientX - (r.left + r.width / 2)) * k;
    const dy = (e.clientY - (r.top + r.height / 2)) * k;
    setPick(pickAt(dx, dy, emotes.length));
    setPointer(Math.hypot(dx, dy) >= HUB_R ? (Math.atan2(dx, -dy) * 180) / Math.PI : null);
  };

  useEffect(() => {
    // Losing browser focus (free-cursor key, chat) would strand the overlay.
    const onUnfocused = () => send(ev.close);
    const onRelease = () => {
      const a = releaseAction(live.current.pick, (groups[live.current.group] || { emotes: [] }).emotes.length);
      if ('play' in a) {
        const g = groups[live.current.group];
        savedGroupId = g.id;
        savedAnim = g.emotes[a.play].anim;
        send(ev.play, g.emotes[a.play].anim);
      } else {
        send(ev.close);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const n = parseInt(e.key, 10);
      const g = groups[live.current.group];
      if (n >= 1 && n <= 9 && g && g.emotes[n - 1]) {
        e.preventDefault();
        savedGroupId = g.id;
        savedAnim = g.emotes[n - 1].anim;
        send(ev.play, g.emotes[n - 1].anim);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setGroup((x) => (x + (e.key === 'ArrowLeft' ? groups.length - 1 : 1)) % Math.max(1, groups.length));
      }
    };
    const onWheel = (e: WheelEvent) => setGroup((x) => (x + (e.deltaY > 0 ? 1 : groups.length - 1)) % Math.max(1, groups.length));
    window.addEventListener('skymp5-client:browserUnfocused', onUnfocused);
    window.addEventListener(RELEASE_EVENT, onRelease);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel);
    return () => {
      window.removeEventListener('skymp5-client:browserUnfocused', onUnfocused);
      window.removeEventListener(RELEASE_EVENT, onRelease);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [groups.length]);

  if (!active) return null;

  const hovered = pick.ring === 'emote' ? emotes[pick.index] : null;
  const lastHere = emotes.find((e) => e.anim === savedAnim) || null;
  const shown = hovered || lastHere;
  const notch = pointer === null ? null : pointAt(HUB_R - 6, pointer);

  return (
    <div className="emote-wheel" onMouseMove={onMove} onContextMenu={(e) => { e.preventDefault(); send(ev.close); }}>
      <div className="emote-wheel__fade" />
      <div className="emote-wheel__stage">
        <svg ref={svgRef} className="emote-wheel__svg" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Emote wheel">
          <circle className="emote-wheel__ring-guide" cx={CENTER} cy={CENTER} r={EMOTE_OUTER + 8} />
          {emotes.map((e, i) => {
            const a = segmentAngles(i, emotes.length);
            const c = pointAt((EMOTE_INNER + EMOTE_OUTER) / 2 + 24, a.mid);
            const k = pointAt(EMOTE_INNER + 26, a.mid);
            const hot = pick.ring === 'emote' && pick.index === i;
            return (
              <g key={e.anim} className={'emote-wheel__emote' + (hot ? ' is-hot' : '') + (e.anim === savedAnim ? ' is-last' : '')} onClick={() => play(e.anim)}>
                <path className="emote-wheel__seg" d={arcPath(EMOTE_INNER, EMOTE_OUTER, a.start, a.end)} />
                {i < 9 ? <text className="emote-wheel__key" x={k.x} y={k.y}>{i + 1}</text> : null}
                <text className="emote-wheel__emote-label" x={c.x} y={c.y}>{shortenLabel(e.label)}</text>
              </g>
            );
          })}
          <circle className="emote-wheel__hub" cx={CENTER} cy={CENTER} r={HUB_R} />
          {notch ? <circle className="emote-wheel__notch" cx={notch.x} cy={notch.y} r={4} /> : null}
          <Glyph id={active.id} x={CENTER} y={CENTER - 30} size={30} className="emote-wheel__hub-glyph" />
          <text className="emote-wheel__hub-group" x={CENTER} y={CENTER + 6}>{active.label}</text>
          <text className="emote-wheel__hub-emote" x={CENTER} y={CENTER + 30}>{shown ? shortenLabel(shown.label) : ''}</text>
        </svg>
        <div className="emote-wheel__tabs" role="tablist">
          {groups.map((g, i) => (
            <button key={g.id} role="tab" aria-selected={i === group} className={'emote-wheel__tab' + (i === group ? ' is-active' : '')} onClick={() => setGroup(i)}>
              <svg className="emote-wheel__tab-glyph" viewBox="0 0 24 24"><path d={glyphOf(g.id)} /></svg>{g.label}
            </button>
          ))}
        </div>
        <div className="emote-wheel__foot">
          <button className="emote-wheel__stop" onClick={() => send(ev.stop)}>Stop emote</button>
          <p className="emote-wheel__hint">Hold the key and flick to an emote, release to play  &bull;  or click  &bull;  1-9 on the wedges  &bull;  mouse wheel or Left / Right: another group  &bull;  Esc closes</p>
        </div>
      </div>
    </div>
  );
};

export default EmoteWheel;
