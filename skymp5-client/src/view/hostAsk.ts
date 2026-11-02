// When this client may ask the server to host a copy, and how a copy it does not host is moved: formView's decisions, kept
// here so tests/host-ask-harness.js can run them. The server-hosted NPC slice (_work/server-npc-movement-1102.md, step 3)
// adds one rule to each: an actor the server drives (model.isServerDriven) is never asked for, from any trigger, and is
// played back like one another client hosts. For every other actor these are the conditions formView always had.

export interface HostAskModel {
  isHostedByOther?: boolean;
  isServerDriven?: boolean;
}

// On sight: nobody hosts it, so take it (trigger A)
export const mayAskOnSight = (m: HostAskModel, alreadyHosted: boolean, ownCompanion: boolean): boolean =>
  !m.isHostedByOther && !m.isServerDriven && !alreadyHosted && !ownCompanion;

// Its host has gone silent past the server's 2 s rule (trigger B)
export const mayAskSilent = (m: HostAskModel, alreadyHosted: boolean, hostSilent: boolean): boolean =>
  hostSilent && !alreadyHosted && !m.isServerDriven;

// The copy is neither seated nor played back this pass (the resync branch): ask for it again (trigger C)
export const mayAskResync = (m: HostAskModel, alreadyHosted: boolean, remoteId: number): boolean =>
  !alreadyHosted && !!remoteId && !m.isServerDriven;

// A copy nobody drives is seated on its spot; one another client or the server drives is played back
export const seatsUndriven = (m: HostAskModel, everApplied: boolean, strandedFromServer: boolean): boolean =>
  !m.isHostedByOther && !m.isServerDriven && (!everApplied || strandedFromServer);
export const playsBack = (m: HostAskModel, alreadyHosted: boolean, everApplied: boolean): boolean =>
  !alreadyHosted && (!!m.isHostedByOther || !!m.isServerDriven || !everApplied);
