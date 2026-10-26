// Referrals (referrals.js): your link and code, the friends who joined with it, the boost queue and the carry weight. A
// friend's code is typed, so entering one opens this tab in the browser journal (where the link can also be copied)
var REF_KIND = {first: "First friend", later: "Friend", welcome: "Welcome"};

function refPct(m)
{
   return "+" + Math.round((m - 1) * 100) + "%";
}

function refHm(ms)
{
   var m = Math.max(0, Math.floor(ms / 60000));
   return Math.floor(m / 60) + " h " + (m % 60) + " m";
}

JT.referrals = function(s, ctx)
{
   var r = s.rules;
   var carry = r.carryWeight != undefined && r.carryWeight ? r.carryWeight : 50;
   flowHeading("Invite a friend");
   flowHint("Share your link. A friend who joins with it and plays " + r.qualifyHours + " hours on " + r.qualifyDays + " different days counts as your referral: your first earns "
      + refPct(r.firstMult) + " skill progress for " + r.boostHours + " hours of play and +" + carry + " carry weight for good, each later one " + refPct(r.laterMult) + " for "
      + r.boostHours + " hours. Your friend gets " + refPct(r.welcomeMult) + " for their first " + r.boostHours + " hours.");
   flowRow("Your link", s.link);
   flowRow("Your code", s.code);
   flowButtons([["Copy the link...", function() { ctx.browser(); }]]);
   flowHeading("Friends (" + s.counted + " counted)");
   var friends = listOf(s.friends);
   if (!friends.length)
   {
      flowHint("No friends have joined with your link yet.");
   }
   for (var i = 0; i < friends.length; i++)
   {
      flowText(friends[i].text, 17, friends[i].status == "counted" || friends[i].status == "playing" ? C_TEXT : C_SECOND);
   }
   flowHeading("Boosts");
   var q = listOf(s.queue);
   if (!q.length)
   {
      flowHint("No boosts waiting. Boosts run one at a time, only while you play, " + r.queueCap + " at most in line.");
   }
   for (var b = 0; b < q.length; b++)
   {
      var x = q[b];
      flowRow((b + 1) + ". " + (REF_KIND[x.kind] != undefined ? REF_KIND[x.kind] : "Boost") + ": " + refPct(x.mult) + " skill progress",
         refHm(x.leftMs) + " of play left" + (x.running == true ? ", running" : b == 0 && s.waitingBehind == true ? ", waiting behind your other skill boost" : ", queued"));
   }
   if (s.carry == true)
   {
      flowText(s.carryLive == true ? "Carry weight +" + carry + ": yours for good." : "Carry weight +" + carry + " earned: it arrives with a coming update.", 17, C_TEXT);
   }
   if (s.canEnter == true)
   {
      flowHeading("Did a friend invite you?");
      flowHint("Enter their code once, in your first " + (r.commandWindowHours != undefined && r.commandWindowHours ? r.commandWindowHours : 24) + " hours of play.");
      flowButtons([["Enter a code...", function() { ctx.browser(); }, undefined, ctx.busy || ctx.readOnly]]);
   }
};
