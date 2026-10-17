// Reads and writes the live camera field of view; no skyrimPlatform import so a harness can drive it.

export interface FovPair {
  world: number | null;
  first: number | null;
}

export interface FovCamera {
  // "platform": SkyrimPlatform's own getCameraFov/setCameraFov. "skse": the Camera Papyrus natives, which return nothing through callNative.
  kind: "platform" | "skse";
  read(): FovPair;
  write(world: number | null, first: number | null): void;
}

export interface FovSp {
  getCameraFov?: unknown;
  setCameraFov?: unknown;
  callNative(className: string, functionName: string, self?: unknown, ...args: unknown[]): unknown;
}

// A Promise or null from callNative is not a reading
export const fovNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const describeFov = (p: FovPair): string => `world ${p.world ?? "unread"} first person ${p.first ?? "unread"}`;

// Only a real reading that differs from the wanted value counts as moved
export const fovMoved = (have: number | null, want: number | null): boolean =>
  want !== null && have !== null && Math.abs(have - want) > 0.5;

export const fovMatches = (p: FovPair, world: number | null, first: number | null): boolean =>
  (world === null || (p.world !== null && Math.abs(p.world - world) <= 0.5))
  && (first === null || (p.first !== null && Math.abs(p.first - first) <= 0.5));

export function pickFovCamera(sp: FovSp): FovCamera {
  const get = sp.getCameraFov, set = sp.setCameraFov;
  if (typeof get === "function" && typeof set === "function") {
    return {
      kind: "platform",
      read: () => {
        const r = get() as { world?: unknown; firstPerson?: unknown } | null | undefined;
        return { world: fovNumber(r?.world), first: fovNumber(r?.firstPerson) };
      },
      write: (world, first) => { set(world, first); },
    };
  }
  return {
    kind: "skse",
    read: () => ({
      world: fovNumber(sp.callNative("Camera", "GetWorldFieldOfView", undefined)),
      first: fovNumber(sp.callNative("Camera", "GetFirstPersonFieldOfView", undefined)),
    }),
    write: (world, first) => {
      if (world !== null) sp.callNative("Camera", "SetWorldFieldOfView", undefined, world);
      if (first !== null) sp.callNative("Camera", "SetFirstPersonFieldOfView", undefined, first);
    },
  };
}

// ---- the player's own choice (F3, Settings, Camera) --------------------------------------------------------------

// Anything outside this is not a field of view the player chose (the launcher's range too)
export const FOV_MIN = 50, FOV_MAX = 140;
export const saneFov = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= FOV_MIN && v <= FOV_MAX;

// Kept as ui.fov in the chat settings file (chat-settings-no-load), beside the other F3 settings. launcher is the
// launcher's value when the choice was made.
export interface SavedFov { value: number; launcher: number | null }

export const readSavedFov = (raw: unknown): SavedFov | null => {
  const r = raw as { value?: unknown; launcher?: unknown } | null | undefined;
  if (!r || typeof r !== "object" || !saneFov(r.value)) return null;
  return { value: Math.round(r.value), launcher: saneFov(r.launcher) ? Math.round(r.launcher) : null };
};

// The saved choice wins over the launcher's ini value, unless the launcher's value has changed since it was saved:
// then the player changed it in the launcher after, and that is the newer choice (the interface size works the same)
export const chooseFov = (launcher: number | null, saved: SavedFov | null): { value: number | null; from: "saved" | "launcher" } => {
  const l = saneFov(launcher) ? Math.round(launcher) : null;
  if (saved && (l === null || saved.launcher === l)) return { value: saved.value, from: "saved" };
  return { value: l, from: "launcher" };
};
