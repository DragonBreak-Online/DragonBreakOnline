import React, { useState } from 'react';

import { Chips, Row, registerSettingsSection } from './SettingsTab';
import { readUiExtra, writeUiExtra } from '../../../utils/uiSettings';

// F3, Settings, Mouse: may the mouse leave the game window while chat or a panel is open (client MouseFreeService).
// Off by default: on 0.3.105, where it was always on, players with a second monitor clicked onto it by accident and
// were tabbed out of the game (Discord, 19 Oct). The choice is kept as ui.mouseLeavesWindow in the settings file and
// sent to the client as "dbo:mouse" "set" "on" | "off"; the client reads the file at start.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = (): any => window;
const send = (...args: unknown[]): void => {
  try { const sp = w().skyrimPlatform; if (sp && sp.sendMessage) sp.sendMessage('dbo:mouse', ...args); } catch (e) { /* no client */ }
};

type Choice = 'off' | 'on';

const MousePart = () => {
  const [choice, setChoice] = useState<Choice>(() => (readUiExtra('mouseLeavesWindow') === true ? 'on' : 'off'));
  const pick = (v: Choice): void => {
    setChoice(v);
    writeUiExtra('mouseLeavesWindow', v === 'on');
    send('set', v);
  };
  return (
    <div className="jset__part">
      <section className="jset__group">
        <h2 className="journal__heading">Mouse</h2>
        <Row label="Leave the game window"
          hint="With chat or a panel open, the mouse may move onto another monitor, so you can reach other windows without Alt+Tab. A click outside the game switches to that window.">
          <Chips<Choice> label="Leave the game window" value={choice} onChange={pick}
            options={[['off', 'Stay in the game'], ['on', 'May leave']]} />
        </Row>
      </section>
    </div>
  );
};

registerSettingsSection('mouse', 'Mouse', MousePart);
