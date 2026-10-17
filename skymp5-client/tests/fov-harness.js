// Scripted test for fovCamera.ts: which camera setter the client picks, and how it reads the camera back.
// 0.3.102 wrote the field of view through callNative("Camera", ...), which returns null on every client, so it
// reported null readings, re-applied at every guard, and never moved the camera.
//
// fovCamera.ts has no imports, so it transpiles on its own. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/services/services/fovCamera.ts --outDir /tmp/dbo-fov --module commonjs --target es2019
//   node tests/fov-harness.js /tmp/dbo-fov/fovCamera.js
'use strict';
const path = require('path');
const { pickFovCamera, fovNumber, fovMoved, fovMatches, describeFov } = require(path.resolve(process.argv[2] || '/tmp/dbo-fov/fovCamera.js'));

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// A SkyrimPlatform with the new DLL: getCameraFov/setCameraFov over a PlayerCamera holding the template save's 65/65
const platformSp = () => {
  const camera = { worldFOV: 65, firstPersonFOV: 65 };
  const natives = [];
  return {
    camera, natives,
    getCameraFov: () => ({ world: camera.worldFOV, firstPerson: camera.firstPersonFOV }),
    setCameraFov: (w, f) => {
      if (w !== null && w !== undefined) camera.worldFOV = w;
      if (f !== null && f !== undefined) camera.firstPersonFOV = f;
      return { world: camera.worldFOV, firstPerson: camera.firstPersonFOV };
    },
    callNative: (...a) => { natives.push(a); return null; },
  };
};
// The shipped DLL as the 16-17 Oct logs show it: no getCameraFov, and the Camera natives return null (or a Promise)
const oldSp = (ret = null) => {
  const natives = [];
  return { natives, callNative: (...a) => { natives.push(a); return typeof ret === 'function' ? ret() : ret; } };
};

// ---- which setter -----------------------------------------------------------------------------------------------
{
  const sp = platformSp();
  const cam = pickFovCamera(sp);
  check('the new DLL picks the platform setter', cam.kind === 'platform', cam.kind);
  check('it reads the template camera as 65/65', JSON.stringify(cam.read()) === JSON.stringify({ world: 65, first: 65 }), cam.read());
  cam.write(90, 90);
  check('a write of 90/90 lands in PlayerCamera', sp.camera.worldFOV === 90 && sp.camera.firstPersonFOV === 90, sp.camera);
  check('and reads back as 90/90', fovMatches(cam.read(), 90, 90), cam.read());
  check('no Papyrus native is called on the platform route', sp.natives.length === 0, sp.natives.length);
  cam.write(100, null);
  check('a null half is left alone', sp.camera.worldFOV === 100 && sp.camera.firstPersonFOV === 90, sp.camera);
}
{
  const sp = platformSp();
  delete sp.setCameraFov;
  check('a DLL with only one half falls back to SKSE', pickFovCamera(sp).kind === 'skse');
}

// ---- the old DLL, reproduced ------------------------------------------------------------------------------------
{
  const sp = oldSp(null);
  const cam = pickFovCamera(sp);
  check('the shipped DLL falls back to the SKSE Camera natives', cam.kind === 'skse', cam.kind);
  const r = cam.read();
  check('a null reading is unread, not 0', r.world === null && r.first === null, r);
  cam.write(90, 90);
  check('the SKSE route still calls both setters', sp.natives.filter((a) => /^Set/.test(a[1])).length === 2, sp.natives.map((a) => a[1]));
  check('and is reported as NOT applied, since nothing reads back', fovMatches(cam.read(), 90, 90) === false);
  check('describe says unread', describeFov(cam.read()) === 'world unread first person unread', describeFov(cam.read()));
}
{
  const cam = pickFovCamera(oldSp(() => Promise.resolve(65)));
  check('a Promise reading is unread', cam.read().world === null, cam.read());
}

// ---- the guard ---------------------------------------------------------------------------------------------------
check('an unread camera never counts as moved (0.3.102 re-applied on every guard)', fovMoved(null, 90) === false);
check('65 against a wanted 90 is moved', fovMoved(65, 90) === true);
check('90.3 against 90 is not', fovMoved(90.3, 90) === false);
check('nothing wanted is never moved', fovMoved(65, null) === false);
check('matches ignores an unset half', fovMatches({ world: 90, first: 65 }, 90, null) === true);
check('matches needs a reading for a set half', fovMatches({ world: 90, first: null }, 90, 90) === false);

// ---- numbers ----------------------------------------------------------------------------------------------------
check('fovNumber keeps a number', fovNumber(80) === 80);
check('fovNumber drops NaN, strings and objects', [NaN, '80', {}, undefined].every((v) => fovNumber(v) === null));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
