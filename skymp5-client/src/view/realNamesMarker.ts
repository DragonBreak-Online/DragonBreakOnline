// Staff real-names mode (server playermenu.js /realnames): owner ff_knownIds = { reveal: 1, labels: { "<server id hex>": "Aldric (masked)" } }
// No imports, so tests/real-names-marker-harness.js can transpile it on its own

export interface RevealMarker {
  reveal: 1;
  labels: Record<string, string>;
}

// Every nametag reads it each frame; a property update replaces the object, so the last one read is kept by identity
let lastKnown: unknown = undefined;
let lastMarker: RevealMarker | null = null;

// null for an introductions array, nothing, or any object without reveal 1
export const revealMarkerOf = (known: unknown): RevealMarker | null => {
  if (!known || typeof known !== "object" || Array.isArray(known)) return null;
  if (known === lastKnown) return lastMarker;
  const k = known as Record<string, unknown>;
  let marker: RevealMarker | null = null;
  if (k["reveal"] === 1) {
    const raw = k["labels"];
    const labels: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const key of Object.keys(raw as Record<string, unknown>)) {
        const v = (raw as Record<string, unknown>)[key];
        if (typeof v === "string" && v.trim()) labels[key.toLowerCase()] = v.trim().slice(0, 80);
      }
    }
    marker = { reveal: 1, labels };
  }
  lastKnown = known;
  lastMarker = marker;
  return marker;
};

export const revealLabelFor = (known: unknown, remoteId: number): string => {
  const marker = revealMarkerOf(known);
  if (!marker || !remoteId) return "";
  return marker.labels[(remoteId >>> 0).toString(16)] || "";
};

// "" without a marker, so the caller keeps the introductions rule
export const revealTagText = (known: unknown, remoteId: number, name: string, hooded: boolean): string => {
  if (!revealMarkerOf(known)) return "";
  const label = revealLabelFor(known, remoteId);
  if (label) return label;
  return hooded && name ? `${name} (hooded)` : name;
};
