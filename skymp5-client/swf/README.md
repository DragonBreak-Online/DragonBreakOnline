# Native panels: how to build one

Brief for every worker on a native Scaleform panel (Worker 1 is UI lead, 26 Oct). Read `STYLE.md` first. Every panel goes to Worker 1 for review before Nat sees it.

## The files

| What | Where |
|---|---|
| Style guide: stage, fonts, colours, selection, rows, sound, keys | `swf/STYLE.md` |
| The wire, JSON, text, boxes, rules, fade, sound, boot | `swf/lib/dbo.as` |
| Focusable buttons: `button`, `disable`, `setFocus`, `clear`, with the `actions`/`focus` order | `swf/lib/dbo-controls.as` |
| Paged layout: `flowStart`, `flowHeading`, `flowText`, `flowHint`, `flowRow`, `flowEntry` (text with buttons), `flowButtons` (wrapping, chips with `on`), `flowShow`; `whenText`, `plural`, `listOf` | `swf/lib/dbo-flow.as` |
| A budget bar (used of max, amber at one left, red when full) | `meterColor` in `swf/dbo_decor` (move it to the lib when a second panel needs it) |
| Examples | `swf/dbo_board` (simple list), `swf/dbo_housing` (actions plus a paged list), `swf/dbo_journal` (a shell with tabs, the Ask overlay, flow pages) |

One panel is one folder `swf/<name>/` holding:
- `<name>.xml`: copy one; only the comment changes;
- `scripts/frame_1/DoAction.as`;
- `lib.txt`: the lib files placed ahead of the script, in order;
- `verify.txt`: strings that must decompile back out, so a missing piece fails the build.

## Build and test

```
DBO_FFDEC="E:/DragonBreak Online Dev files/tools/ffdec/ffdec-cli.jar" node swf/build-swf.js <name>
```

This writes `swf/build/<name>.swf` and checks it against `verify.txt`. AS2 traps:
- `default` and other keywords cannot be property names (write `o["default"]`);
- `var` is function-scoped, so a closure made in a loop must read from `this` or the clip (set `row.id = ...` and read `this._parent.id`), not from the loop variable.

**Tests.** Each panel gets `tests/native-<name>-harness.js` on the stub stage (`tests/native-swf-stub.js`). It runs the lib and your script as JS against real payloads and records every event sent. Then:
- add the panel to `tests/native-wire-harness.js`, which parses your events through the client's own parser and checks the server has a handler;
- mutate a COPY of your source (never the tracked file) and check the harness fails.

## The wire

**In.** The client calls `_root.dboData(json)` with the same widget object the browser panel gets. A re-send with the same nonce redraws in place. Refuse a payload you cannot read (log it, draw nothing). Close yourself if no payload comes within 8 s.

**Out.** Use `dboSend(key, args)`. It goes both to SendModEvent and to the polled outbox; you never choose between them. Send `dboSend("ready", [frame], frame)` from `dboBoot`.

**Keys.** Send exactly the strings the widget's `events.*` hold, verbatim:
- A `dbo:` key goes to the server as the browser's would.
- A client service's own key (`bountyBoard:post`, `housing:lock`) goes to that service, as a browser message. Worker 4's router owns this.
- Bare `close` is not the browser's Close. It sends the generic close packet, which some gamemode handlers rely on. To close as the Close button does, send the widget's `events.close`. Choose per panel.

**Routing.** Each panel's routing is agreed with its owner first.
- A panel the gamemode opens (`openWidget` in gamemode.js) is routed by `NATIVE_SWF` there, for a client that announced the panel's `native:<type>` in `nativeCaps`.
- A panel a client service opens (board, housing) goes through Worker 4's router in the client.

## Typed input

A native menu has no text box. For a name, a number, a note or a search, the panel gets a button ("Write a notice...", "Rename...") that opens the browser for that input only, and returns to the native panel once it is answered. Keep the chat command as a fallback; add one if there is none.
- **Router panels:** send `native:handoff [type, mode]`, and give the browser front a mode that draws only that input (see `features/bountyBoard`, `features/housing`).
- **Gamemode panels:** ask Worker 1. The journal does it server-side (`journalTab [nonce, tab, focus, 'browser']`).

## Review checklist (what Worker 1 will check)

- **STYLE.md:** brightness, not bars; $Everywhere fonts; the sounds; a Close row; works with the mouse alone; Escape closes (or backs out one layer).
- **The browser version:** the panel says and offers everything the browser one does, in its order, with its words. A destructive action asks first.
- **No rules in the SWF:** the server decides. No Bethesda or mod assets, and no images derived from them.
- **Tests:** the harness covers every control and fails on a mutated copy; the wire harness covers every key.
- **Hand-over:** the SWF is staged with a hash in `_notes-to-server/`; nothing is installed without the Leader's go.
