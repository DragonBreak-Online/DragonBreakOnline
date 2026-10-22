// Capabilities of this client's own code, added to the page's dbo:uiCaps by the relay, so a front built ahead of the client never claims them
// creatureBody: other players are shown in a polymorph creature's body from dboBeastBody (sync/beastBody.ts, POLYMORPH_RACES)
export const CLIENT_UI_CAPS: ReadonlyArray<string> = ["creatureBody"];

export const withClientUiCaps = (event: string, args: unknown[]): unknown[] =>
  event === "uiCaps" ? args.concat(CLIENT_UI_CAPS.filter((cap) => !args.includes(cap))) : args;
