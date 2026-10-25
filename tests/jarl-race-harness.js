// Scripted test for the per-hold Jarl races (Nat, 25 Oct: a Reachman may be Jarl of the Reach, and of no other hold):
// gamemode.js's jarlRacesFor / jarlRaceFits / jarlRacesText, cut out of the gamemode and fed the shipped gamemode-config.json.
// The same helper answers the election (citizenship.js, tests/citizenship-harness.js), /appoint (tests/officials-harness.js)
// and a rising's claimant (rebellion.js through gamemode.js rulerFit). Run it from this folder's parent with
//
//   node tests\jarl-race-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };

const src = fs.readFileSync(path.resolve(__dirname, '..', 'gamemode.js'), 'utf8');
const a0 = src.indexOf('const JARL_RACES0 = '), a1 = src.indexOf('const raceEdidOf = ');
const l0 = src.indexOf('const raceLabel = '), l1 = src.indexOf('// The rules of /appoint');
if (a0 < 0 || a1 < a0 || l0 < 0 || l1 < l0) { console.log('FAIL the Jarl race helpers are gone from gamemode.js'); process.exit(1); }
const helpers = src.slice(a0, a1) + src.slice(l0, l1);
// rulerFit and appointCheck must ask the helper, never a fixed pattern
ok(!/JARL_RACE\.test/.test(src), 'no fixed Jarl race pattern is left in gamemode.js');
ok((src.match(/jarlRaceFits\(z(?: && z)?\.id/g) || []).length >= 2, '/appoint and the rebellion claimant both ask jarlRaceFits for the hold');
ok(/raceEdidOf, jarlRaceFits, jarlRacesFor,/.test(src), 'citizenship.js is handed jarlRaceFits and jarlRacesFor');

const make = (cfg) => new Function('cfg', `${helpers}\nreturn { jarlRacesFor, jarlRaceFits, jarlRacesText, raceLabel };`)(cfg);
const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'gamemode-config.json'), 'utf8'));
const H = make(shipped);

// ---- the shipped config ------------------------------------------------------------------------------------------------
ok(JSON.stringify(H.jarlRacesFor('whiterun')) === JSON.stringify(['BretonRace', 'NordRace', 'ImperialRace']), 'every other hold: Breton, Nord, Imperial', H.jarlRacesFor('whiterun'));
for (const r of ['BretonRace', 'NordRace', 'ImperialRace', 'NordRaceVampire', 'ImperialRaceVampire']) ok(H.jarlRaceFits('whiterun', r), `Whiterun seats ${r}`);
ok(!H.jarlRaceFits('whiterun', 'DBOReachmanRace'), 'Whiterun does not seat a Reachman');
ok(!H.jarlRaceFits('solitude', 'DBOReachmanRaceVampire'), 'nor Solitude a Reachman vampire');
ok(H.jarlRaceFits('markarth', 'DBOReachmanRace'), 'the Reach seats a Reachman');
ok(H.jarlRaceFits('markarth', 'DBOReachmanRaceVampire'), 'and a Reachman vampire');
ok(H.jarlRaceFits('markarth', 'NordRace') && H.jarlRaceFits('markarth', 'BretonRace'), 'and still a Nord or a Breton');
ok(!H.jarlRaceFits('markarth', 'KhajiitRace') && !H.jarlRaceFits('markarth', 'HighElfRace'), 'but no Khajiit or High Elf');
ok(!H.jarlRaceFits('markarth', '') && !H.jarlRaceFits('markarth', undefined), 'no race known: not seated');
ok(!H.jarlRaceFits('markarth', 'DBOReachmanRaceX') && !H.jarlRaceFits('whiterun', 'XNordRace'), 'a near-miss EditorID is not a match');
ok(H.jarlRacesText('whiterun') === 'a Breton, a Nord or an Imperial', 'Whiterun\'s law reads "a Breton, a Nord or an Imperial"', H.jarlRacesText('whiterun'));
ok(H.jarlRacesText('markarth') === 'a Breton, a Nord, an Imperial or a Reachman', 'the Reach\'s law reads "... or a Reachman"', H.jarlRacesText('markarth'));
ok(H.raceLabel('DBOReachmanRace') === 'a Reachman' && H.raceLabel('DBOReachmanRaceVampire') === 'a Reachman', 'the race label drops DBO and Vampire');
ok(H.raceLabel('DarkElfRaceVampire') === 'a Dark Elf', 'other labels unchanged');

// ---- no config, a broken config, the gamemode's own fallback ----------------------------------------------------------
const none = make({});
ok(none.jarlRaceFits('markarth', 'NordRace') && !none.jarlRaceFits('markarth', 'DBOReachmanRace'), 'no jarlRaces in the config: the old rule everywhere, the Reach included');
const bad = make({ jarlRaces: { byHold: { markarth: 'DBOReachmanRace' } } });
ok(bad.jarlRaceFits('markarth', 'NordRace') && !bad.jarlRaceFits('markarth', 'DBOReachmanRace'), 'a byHold entry that is not a list is ignored');
const own = make({ jarlRaces: { default: ['NordRace'], byHold: {} } });
ok(own.jarlRaceFits('riften', 'NordRace') && !own.jarlRaceFits('riften', 'BretonRace'), 'default can be narrowed (server lore\'s Nords and Imperials, if Nat ever wants it)');
ok(make(undefined).jarlRaceFits('riften', 'ImperialRace'), 'no cfg at all (a harness slice): the built-in three');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
