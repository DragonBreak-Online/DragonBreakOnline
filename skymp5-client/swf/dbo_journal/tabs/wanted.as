// Wanted (outlaws.js): your bounties with Pay where you stand, the hold's wanted list, and for its ruler or Steward Clear on
// each and Set a bounty, which is typed, so it opens this tab in the browser journal. Actions are dbo:outlawJ [nonce, action, ...]
JT.wanted = function(s, ctx)
{
   var mine = listOf(s.mine);
   if (mine.length)
   {
      flowHeading("Your bounties");
   }
   for (var i = 0; i < mine.length; i++)
   {
      var m = mine[i];
      var text = m.name + ": " + m.amount + " gold";
      if (m.here == true)
      {
         var pay = flowEntry(text, [["Pay", function()
         {
            ctx.ask(this._parent.question, "Pay", function() { ctx.act("dbo:outlawJ", ["pay"]); });
         }, undefined, ctx.busy]], m.reason);
         pay.question = "Pay your bounty of " + m.amount + " gold to " + m.name + "?";
      }
      else
      {
         flowEntry(text, [], m.reason + "  -  pay it standing in " + m.name);
      }
   }
   flowHeading(s.hold != null ? "Wanted in " + s.hold.name : "Wanted");
   var wanted = listOf(s.wanted);
   if (s.hold == null)
   {
      flowHint("Stand in a hold to read its wanted list.");
   }
   else if (!wanted.length)
   {
      flowHint("Nobody is wanted here.");
   }
   for (var j = 0; s.hold != null && j < wanted.length; j++)
   {
      var w = wanted[j];
      var sub = w.reason + "  -  set by " + w.by + ", " + whenText(w.at);
      var e = flowEntry(w.name + "   " + w.amount + " gold", s.canDeclare == true ? [["Clear", function()
      {
         var row = this._parent;
         ctx.ask(row.question, "Clear", function() { ctx.act("dbo:outlawJ", ["clear", row.pid]); }, true);
      }, C_RED, ctx.busy]] : [], sub);
      e.pid = w.pid;
      e.question = "Lift the bounty on " + w.name + "?";
   }
   flowHint("Jailed in this hold, an outlaw pays their bounty to whoever locked them in; what they cannot pay they serve, a minute for every " + s.goldPerMinute + " gold.");
   if (s.canDeclare == true && s.hold != null)
   {
      flowHeading("Set a bounty in " + s.hold.name);
      flowHint("A name, the gold (up to " + s.max + ") and the reason are typed in the browser journal.");
      flowButtons([["Set a bounty...", function() { ctx.browser(); }, undefined, ctx.busy || ctx.readOnly]]);
   }
};
