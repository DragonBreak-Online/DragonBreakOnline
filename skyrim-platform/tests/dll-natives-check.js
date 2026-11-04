#!/usr/bin/env node
// Fails when a built SkyrimPlatformImpl.dll lacks a call the client needs.
// Usage: node dll-natives-check.js <SkyrimPlatformImpl.dll>
//
// Why it exists (bug #2, 3 Nov 2026): client 0.3.111 moved the DLL to platform-rc-1104, which had never carried the
// RaceMenu preset or free-mouse calls. The client looks these up with `typeof sp.x === "function"` and quietly does
// nothing when one is missing, so faces stopped saving and nothing failed. A name check over direct calls missed
// them too. Each name the DLL registers appears as a plain string in the binary, so a byte search is enough.

const fs = require("fs");

// Calls the client needs, and the client file that looks each one up
const REQUIRED = {
  readPresetFile: "racemenuPresetService.ts",
  writePresetFile: "racemenuPresetService.ts",
  removePresetFile: "racemenuPresetService.ts",
  getTriVertexCount: "racemenuPresetService.ts",
  setMouseFree: "mouseFreeService.ts",
  getCameraFov: "fovCamera.ts",
  setCameraFov: "fovCamera.ts",
  dboMenuOpen: "native panels (DboMenuApi)",
  overlayMenu: "overlay panels (OverlayMenuApi)",
};

// Behind server switches that are off by default (nativeRetire, nativeCreate): reported, never a failure
const OPTIONAL = ["createCopy", "retireCopy", "isCopyRetiring", "processCopyRetires"];

const file = process.argv[2];
if (!file) {
  console.error("usage: node dll-natives-check.js <SkyrimPlatformImpl.dll>");
  process.exit(2);
}
const bytes = fs.readFileSync(file);
const has = (name) => bytes.indexOf(Buffer.from(name, "latin1")) !== -1;

let missing = 0;
for (const [name, who] of Object.entries(REQUIRED)) {
  const ok = has(name);
  if (!ok) missing++;
  console.log(`${ok ? "ok     " : "MISSING"} ${name} (${who})`);
}
for (const name of OPTIONAL) console.log(`${has(name) ? "ok     " : "absent "} ${name} (optional, switch off by default)`);

if (missing) {
  console.error(`FAIL: ${missing} required call(s) missing from ${file}`);
  process.exit(1);
}
console.log("PASS");
