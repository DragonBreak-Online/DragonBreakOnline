// The packet that gives a character back the enchantments it learned by disenchanting (server alchemy.js, dboEnchLearned):
// { customPacketType: "dboEnchLearned", effects: number[], forget?: number[] }, form ids. Anything else, or a malformed list, is null.
export const LEARNED_MAX = 512;

const idsOf = (list: unknown): number[] | null => {
  if (!Array.isArray(list)) return null;
  const out: number[] = [];
  for (const raw of (list as unknown[]).slice(0, LEARNED_MAX)) {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0 && id < 0xff000000 && out.indexOf(id >>> 0) < 0) out.push(id >>> 0);
  }
  return out;
};

export const readLearned = (content: Record<string, unknown> | null | undefined): number[] | null =>
  content?.["customPacketType"] === "dboEnchLearned" ? idsOf(content["effects"]) : null;

// Ids the server says this character does not know (every known enchantment it lacks), sent at login
export const readForget = (content: Record<string, unknown> | null | undefined): number[] =>
  (content?.["customPacketType"] === "dboEnchLearned" && idsOf(content["forget"])) || [];

// The ids set known for an earlier character in this game session that the arriving list lacks. The game keeps "known" on
// the form itself, so a second character in the same session inherited the first one's enchantments: the table said they
// were learned already and the character could neither learn nor rely on them (SMJ, 12 Oct). The server's forget list also
// covers what the earlier character learned at the table itself.
export const toForget = (setBefore: number[], next: number[], serverForget: number[] = []): number[] => {
  const out: number[] = [];
  for (const id of setBefore.concat(serverForget)) if (next.indexOf(id >>> 0) < 0 && out.indexOf(id >>> 0) < 0) out.push(id >>> 0);
  return out;
};
