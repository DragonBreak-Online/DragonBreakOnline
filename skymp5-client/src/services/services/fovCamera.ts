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
