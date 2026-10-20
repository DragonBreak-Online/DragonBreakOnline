// A CPU profile of one window of a running server, for the loop-lag question (CAPACITY_PLAN.md: at 500 crowded bots
// the native tick is under 50 ms at p99 but event-loop lag p99 is ~250 ms, so the rest is JS between ticks). Loaded
// before the bundle, so no server code changes:
//   NODE_OPTIONS=--require=<this file>  (or node -r <this file> dist_back/...)
//   DBO_CPU_PROF_SECONDS=60        how long to sample (0 or unset: does nothing)
//   DBO_CPU_PROF_START_S=120       when to start, seconds after boot (default 0)
//   DBO_CPU_PROF_INTERVAL_US=500   sampling interval (default 500 us)
//   DBO_CPU_PROF_OUT=<file>        where the .cpuprofile goes (default ./cpu-window.cpuprofile)
// Read the result with tools/loadtest/cpu-profile-report.js. Sandbox use only: the inspector session stays open for
// the life of the process.
'use strict';
const inspector = require('inspector');
const fs = require('fs');
const path = require('path');

const seconds = Number(process.env.DBO_CPU_PROF_SECONDS) || 0;
if (seconds > 0) {
  const startS = Number(process.env.DBO_CPU_PROF_START_S) || 0;
  const interval = Number(process.env.DBO_CPU_PROF_INTERVAL_US) || 500;
  const out = path.resolve(process.env.DBO_CPU_PROF_OUT || 'cpu-window.cpuprofile');
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) => new Promise((resolve, reject) =>
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res))));
  setTimeout(async () => {
    try {
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval });
      await post('Profiler.start');
      console.log(`[cpu-window] sampling ${seconds} s every ${interval} us`);
      setTimeout(async () => {
        try {
          const { profile } = await post('Profiler.stop');
          fs.writeFileSync(out, JSON.stringify(profile));
          console.log(`[cpu-window] wrote ${out} (${profile.samples.length} samples)`);
        } catch (e) {
          console.log(`[cpu-window] stop failed: ${e.message}`);
        }
      }, seconds * 1000).unref();
    } catch (e) {
      console.log(`[cpu-window] start failed: ${e.message}`);
    }
  }, startS * 1000).unref();
}
