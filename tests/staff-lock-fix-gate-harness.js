// A GM's lock fixes on someone's property (Nat, 25 Oct: "give regular GMs the ability to fix locks"): the fork HousingSystem
// asks __dboAdminGate(actor, 'housingLockFix', { ownerProfile }). staffguard.js answers: refused on a GM's RP character
// (staffCharOnly), refused on a staff member's own account while selfTarget.ownAccount holds and passed when it is false
// (23 Oct live), another staff member's property only for a Lead GM (staffNeedsLead, audited), callRef only where its kinds
// name 'lockfix', and an Owner anywhere.
//   node tests/staff-lock-fix-gate-harness.js
'use strict';
const { CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const { OWNER_RP, LEAD, GM, GM_RP, GM2, MIRA } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));
const P = (k) => CAST[k].profile;
const NOT_HERE = /^Staff powers work only on your staff character\./;

let f = load({});
let gate = globalThis.__dboAdminGate;
check('a GM on the staff character may fix a player\'s lock', gate(GM, 'housingLockFix', { ownerProfile: P('MIRA') }) === '');
check('...not from the RP character (staffCharOnly)', NOT_HERE.test(gate(GM_RP, 'housingLockFix', { ownerProfile: P('MIRA') })));
check('...nor on their own account while selfTarget.ownAccount holds', /never act on your own characters/.test(gate(GM, 'housingLockFix', { ownerProfile: P('GM') })));
check('another GM\'s property: only a Lead GM', /Only a Lead GM or above/.test(gate(GM, 'housingLockFix', { ownerProfile: P('GM2') })) && gate(LEAD, 'housingLockFix', { ownerProfile: P('GM2') }) === '');
check('...and the Lead GM\'s use is audited', f.audits.some((t) => /STAFFGUARD .*housing|lockfix/.test(t)), f.audits);
check('an Owner passes anywhere, on any character', gate(OWNER_RP, 'housingLockFix', { ownerProfile: P('GM') }) === '');
check('no callRef by default: lock fixes are not among its kinds', gate(GM, 'housingLockFix', { ownerProfile: P('MIRA') }) === '');
check('an unowned record (owner 0) has no one to protect', gate(GM, 'housingLockFix', { ownerProfile: 0 }) === '');

// Live since 23 Oct: ownAccount false, staff may use the tools on their own characters
f = load({ selfTarget: { enabled: true, ownAccount: false, staffNeedsLead: true } });
gate = globalThis.__dboAdminGate;
check('ownAccount false: a GM fixes the lock of their own character\'s house', gate(GM, 'housingLockFix', { ownerProfile: P('GM') }) === '');
check('...another staff member\'s still needs a Lead GM', /Only a Lead GM or above/.test(gate(GM, 'housingLockFix', { ownerProfile: P('GM2') })));

// A server that wants a GM call or a ticket for it adds 'lockfix' to callRef.kinds
f = load({ callRef: { enabled: true, kinds: ['rename', 'faction', 'office', 'citizenship', 'lockfix'] } });
gate = globalThis.__dboAdminGate;
check('callRef with lockfix: refused without a call or a ticket', /open GM call or a ticket/.test(gate(GM, 'housingLockFix', { ownerProfile: P('MIRA') })));
call(7, P('MIRA'), P('GM'));
check('...passed with the player\'s call taken, and the reference audited', gate(GM, 'housingLockFix', { ownerProfile: P('MIRA') }) === '' && f.audits.some((t) => /STAFFREF .* lockfix on profile 50 under GM call #7/.test(t)), f.audits);

void MIRA; void GM2;
done();
