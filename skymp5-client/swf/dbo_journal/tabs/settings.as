// Settings (journal.js settingsView: staff, voiceOn, nearby, focusPeer, section): the parts the server answers are native,
// Help's problem report (dbo:journalReport [nonce, text], the same report as /bug) and the words of Controls and Repairs.
// The rest are this PC's settings, kept by the browser overlay (interface size, the bars, chat, names, the camera, the
// mouse, the player's own keys and voice), and move with the HUD and chat when they go native: until then each opens the
// browser journal at its section (journalTab [nonce, "settings", {section, peer}, "browser"]).
var SET_OVERLAY = [["general", "Keys"], ["camera", "Camera"], ["voice", "Voice"], ["mouse", "Mouse"], ["interface", "Interface"]];
var SET_REPORT_MAX = 500;
var SET_REPORT_MIN = 5;

function setTrimmed(t)
{
   var a = 0;
   var b = t.length;
   while (a < b && " \t\r\n".indexOf(t.charAt(a)) >= 0)
   {
      a++;
   }
   while (b > a && " \t\r\n".indexOf(t.charAt(b - 1)) >= 0)
   {
      b--;
   }
   return t.substring(a, b);
}

function setLabel(id)
{
   for (var i = 0; i < SET_OVERLAY.length; i++)
   {
      if (SET_OVERLAY[i][0] == id)
      {
         return SET_OVERLAY[i][1];
      }
   }
   return "";
}

function setPeerName(s)
{
   var near = listOf(s.nearby);
   for (var i = 0; i < near.length; i++)
   {
      if (String(near[i].identity) == String(s.focusPeer))
      {
         return String(near[i].name);
      }
   }
   return "that player";
}

function setReport(ctx)
{
   ctx.form(function(v)
   {
      var t = v.t != undefined ? String(v.t) : "";
      return {title: "Report a problem", hint: "Say what you were doing and what went wrong. Where you stand and what is around you are sent with it, as with /bug.",
         fields: [{key: "t", label: "What went wrong", kind: "text", max: SET_REPORT_MAX, lines: 4, count: true, hint: "the wolf near me is floating"}],
         buttons: [["Send the report", function(vals) { ctx.act("journalReport", [String(vals.t)]); }, setTrimmed(t).length >= SET_REPORT_MIN]]};
   });
}

JT.settings = function(s, ctx)
{
   var off = ctx.busy || ctx.readOnly;
   var voiceOn = s.voiceOn == true;
   // A link to one overlay section (X's "Voice settings for <name>") is offered first
   var want = s.focusPeer != undefined && s.focusPeer != "" && voiceOn ? "voice" : s.section != undefined ? String(s.section) : "";
   if (setLabel(want) != "" && (want != "voice" || voiceOn))
   {
      var peer = want == "voice" && s.focusPeer != undefined && s.focusPeer != "";
      var e = flowEntry(peer ? "Voice for " + setPeerName(s) : setLabel(want), [["Open", function() { ctx.browser(this._parent.focusArg); }]],
         "Set in the overlay, which opens at it.");
      e.focusArg = peer ? {section: "voice", peer: String(s.focusPeer)} : {section: want};
   }
   flowHeading("Help");
   flowEntry("Report a problem", [["Report...", function() { setReport(ctx); }, undefined, off]],
      "Say what you were doing and what went wrong. Where you stand and what is around you are sent with it, as with /bug.");
   flowText("Repairing the game files, opening the log folder and resetting every setting are done from the launcher, with the game closed.", 16, C_SECOND);
   flowHeading("Controls");
   flowText("Activate, Jump, Sprint, Sneak, Shout, Toggle POV and Invert Y are kept in the game's own control map, which the game reads once as it starts. Change these in the launcher (Settings), then restart the game.", 16, C_SECOND);
   flowHeading("This PC's settings");
   flowText("Interface size, the bars, chat, names over heads, the camera, the mouse, your own keys and voice are kept by the overlay, and open there.", 16, C_SECOND);
   var row = [];
   var ids = [];
   for (var i = 0; i < SET_OVERLAY.length; i++)
   {
      if (SET_OVERLAY[i][0] != "voice" || voiceOn)
      {
         row.push([SET_OVERLAY[i][1], function() { ctx.browser({section: this.section}); }]);
         ids.push(SET_OVERLAY[i][0]);
      }
   }
   var b = flowButtons(row);
   for (var j = 0; j < ids.length; j++)
   {
      b["btn" + j].section = ids[j];
   }
};
