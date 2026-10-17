import React, { useEffect, useRef, useState } from 'react';

import { Range, Row, registerSettingsSection } from './SettingsTab';
import { writeUiExtra } from '../../../utils/uiSettings';

// F3, Settings, Camera: the field of view. The client (fovService) owns the camera: each step is sent as
// "dbo:fov" "set" and applied at once; it answers "query" in window.__dboFov with the value in use and the launcher's.
// The choice is kept here as ui.fov in the settings file, with the launcher's value it was made against, so a later
// change in the launcher still wins. Reset puts the launcher's value back and forgets the choice.

interface FovState { value: number | null; launcher: number | null; camera?: string; min: number; max: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = (): any => window;
const send = (...args: unknown[]): void => {
  try { const sp = w().skyrimPlatform; if (sp && sp.sendMessage) sp.sendMessage('dbo:fov', ...args); } catch (e) { /* no client */ }
};
const readState = (): FovState | null => {
  try { const s = w().__dboFov; return s && typeof s === 'object' ? s : null; } catch (e) { return null; }
};
// The settings file is written by the client on every save: one write once the slider rests
const SAVE_AFTER_MS = 400;

const CameraPart = () => {
  const [state, setState] = useState<FovState | null>(readState);
  const [drag, setDrag] = useState<number | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const on = (): void => setState(readState());
    w().addEventListener('dbo:fov', on);
    send('query');
    return () => { w().removeEventListener('dbo:fov', on); w().clearTimeout(saveTimer.current); };
  }, []);
  if (!state) {
    return (
      <div className="jset__part">
        <section className="jset__group">
          <h2 className="journal__heading">Field of view</h2>
          <p className="jset__prose">Set in the launcher (Settings) for this version of the game.</p>
        </section>
      </div>
    );
  }
  const min = state.min || 50, max = state.max || 140;
  const value = drag !== null ? drag : (state.value || state.launcher || 80);
  const pick = (v: number): void => {
    setDrag(v);
    send('set', v);
    w().clearTimeout(saveTimer.current);
    saveTimer.current = w().setTimeout(() => writeUiExtra('fov', { value: v, launcher: state.launcher }), SAVE_AFTER_MS);
  };
  const reset = (): void => {
    w().clearTimeout(saveTimer.current);
    setDrag(null);
    writeUiExtra('fov', null);
    send('reset');
  };
  const atLauncher = state.launcher !== null && value === Math.round(state.launcher);
  return (
    <div className="jset__part">
      <section className="jset__group">
        <h2 className="journal__heading">Field of view</h2>
        <Row label="Field of view" hint="How wide you see, in first and third person. It changes as you move it and is kept for your next start.">
          <Range value={value} min={min} max={max} step={1} onChange={pick} format={(v) => `${v}°`} />
        </Row>
        <Row label="Launcher's value" hint={state.launcher !== null ? `${Math.round(state.launcher)}°, from the launcher's settings.` : 'The launcher has not set one.'}>
          <button type="button" className="journal__button" disabled={state.launcher === null || atLauncher} onClick={reset}>
            {atLauncher ? 'In use' : 'Reset'}
          </button>
        </Row>
      </section>
    </div>
  );
};

registerSettingsSection('camera', 'Camera', CameraPart);
