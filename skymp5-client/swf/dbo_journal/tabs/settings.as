// Settings (journal.js settingsView: staff, voiceOn, nearby, focusPeer, section): the parts the server answers are native,
// Help's problem report (dbo:journalReport [nonce, text], the same report as /bug) and the words of Controls and Repairs.
// This PC's settings (Interface, Keys, Camera, Mouse, Voice) are drawn here too, in place of the overview: the client keeps
// them (settingsNativeService) and is asked with set:* keys, answering in _root.dboLocal. A client that never answers
// leaves the browser journal's section as the way in (journalTab [nonce, "settings", {section, peer}, "browser"]).
var SET_OVERLAY = [["general", "Keys"], ["camera", "Camera"], ["voice", "Voice"], ["mouse", "Mouse"], ["interface", "Interface"]];
var SET_REPORT_MAX = 500;
var SET_REPORT_MIN = 5;
var SET_WAIT_MS = 3000;
var SET_SCALES = [[0, "Auto"], [1, "100%"], [1.1, "110%"], [1.25, "125%"], [1.5, "150%"], [1.75, "175%"], [2, "200%"]];
// SettingsKeys.tsx KEY_ROWS: [id, label, setting names, group, optional, staff, hint]
var SET_KEYS = [
   ["chat", "Activate chat", ["chatKeyCode"], "menus", false, false, "Enter always opens it too."],
   ["cursor", "Release mouse", ["freeCursorKeyCode"], "menus", false, false, ""],
   ["interact", "Interact", ["housingMenuKeyCode", "playerActionKeyCode"], "menus", false, false, "Doors, chests and the person in front of you."],
   ["personal", "Personal menu", ["personalMenuKeyCode"], "menus", false, false, ""],
   ["journal", "Journal", ["factionMenuKeyCode"], "menus", false, false, ""],
   ["skills", "Skills", ["masteryMenuKeyCode"], "menus", false, false, ""],
   ["emotes", "Emote wheel", ["emoteWheelKeyCode"], "menus", false, false, ""],
   ["decor", "Decorate home", ["decorMenuKeyCode"], "menus", false, false, "Inside your own home, or one its owner named you in."],
   ["nametags", "Nametags", ["nametagKeyCode"], "view", false, false, ""],
   ["hideUi", "Hide interface", ["hideUiKeyCode"], "view", false, false, ""],
   ["hideChat", "Hide chat", ["hideChatKeyCode"], "view", true, false, "Hides the chat until pressed again; T still opens it."],
   ["ptt", "Push to talk", ["voicePushToTalkKeyCode"], "view", false, false, ""],
   ["range", "Voice range", ["voiceModeKeyCode"], "view", false, false, ""],
   ["mask", "Mask", ["maskToggleKeyCode"], "view", false, false, ""],
   ["admin", "Admin panel", ["adminMenuKeyCode"], "menus", false, true, ""],
   ["wbFollow", "Warband: follow", ["warbandFollowKeyCode"], "menus", true, true, ""],
   ["wbHold", "Warband: hold", ["warbandHoldKeyCode"], "menus", true, true, ""],
   ["wbAttack", "Warband: attack my target", ["warbandAttackKeyCode"], "menus", true, true, "What you last struck, or whoever last struck you or your band."],
   ["wbNearest", "Warband: attack nearest foe", ["warbandNearestKeyCode"], "menus", true, true, ""]];

// The section open in place of the overview, the client's answer, when it was asked, and the deep link already followed
var setSub = "";
var setLocal = null;
var setAskedAt = 0;
var setLinked = "";
var setLevelSent = false;
var setMeter = null;
var setLevel = 0;

_root.dboLocal = function(json)
{
   var p = dboParse(json);
   if (p == null)
   {
      dboLog("settings: unreadable answer from the client");
      return;
   }
   setLocal = p;
   if (tab == "settings" && setSub != "")
   {
      draw();
   }
};

// The microphone's level for the Sensitivity meter, without drawing the page again
_root.dboLocalLevel = function(n)
{
   setLevel = Number(n);
   if (setMeter != null)
   {
      setMeter.bar._xscale = Math.max(0, Math.min(100, setLevel / 0.5 * 100));
   }
};

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

// ---- asking the client, opening and leaving a section ----

function setAsk(s)
{
   var ids = [];
   var near = listOf(s.nearby);
   for (var i = 0; i < near.length; i++)
   {
      ids.push(String(near[i].identity));
   }
   setAskedAt = getTimer();
   dboSend("set:get", [ids]);
}

function setOpen(id, s)
{
   dboSound("UIMenuOK");
   setSub = id;
   setAsk(s);
   draw();
}

function setBack()
{
   dboSound("UIMenuCancel");
   if (setLocal != null && setLocal.capture != undefined && setLocal.capture != "")
   {
      dboSend("set:keyCancel", []);
   }
   setSub = "";
   draw();
}

function setSay(key, value)
{
   dboSound("UIMenuOK");
   dboSend("set:" + key, [value]);
}

// ---- the controls: a row of chips, a value with steps, as the browser's Chips and Range ----

function setChoice(label, hint, options, current, pick)
{
   flowText(label, 18, C_TEXT);
   if (hint != undefined && hint != "")
   {
      flowHint(hint);
   }
   var row = [];
   for (var i = 0; i < options.length; i++)
   {
      row.push([options[i][1], function() { if (this.on != true) { this.pick(this.val); } }, undefined, false, options[i][0] == current]);
   }
   var b = flowButtons(row);
   for (var j = 0; j < options.length; j++)
   {
      b["btn" + j].val = options[j][0];
      b["btn" + j].on = options[j][0] == current;
      b["btn" + j].pick = pick;
   }
}

function setStep(label, value, min, max, steps, shown, hint, put)
{
   var row = [];
   for (var i = 0; i < steps.length; i++)
   {
      var to = Math.max(min, Math.min(max, value + steps[i]));
      row.push([(steps[i] > 0 ? "+" : "-") + Math.abs(steps[i]), function() { dboSound("UIMenuOK"); this.put(this.to); }, undefined, to == value]);
   }
   var e = flowEntry(label + ":  " + shown, row, hint);
   for (var j = 0; j < steps.length; j++)
   {
      e["btn" + j].to = Math.max(min, Math.min(max, value + steps[j]));
      e["btn" + j].put = put;
   }
}

function setFixed(n, places)
{
   var m = Math.pow(10, places);
   var r = String(Math.round(n * m) / m);
   if (places > 0 && r.indexOf(".") < 0)
   {
      r += ".";
   }
   while (places > 0 && r.length - r.indexOf(".") - 1 < places)
   {
      r += "0";
   }
   return r;
}

// ---- Interface (SettingsTab.tsx InterfacePart) ----

function setInterface(L, ctx)
{
   var ui = L.ui;
   var ch = L.chat;
   flowHeading("Size");
   if (L.scale != null)
   {
      var cur = Number(L.scale.override);
      var opts = SET_SCALES.concat([]);
      var known = false;
      for (var i = 0; i < opts.length; i++)
      {
         known = known || opts[i][0] == cur;
      }
      if (!known)
      {
         opts.push([cur, Math.round(cur * 100) + "%"]);
      }
      setChoice("Interface size", "Every panel and the HUD. Auto follows your screen.", opts, cur, function(v) { setSay("scale", v); });
   }
   flowText("Panel sizes", 18, C_TEXT);
   flowHint("Ctrl and the mouse wheel over a panel resize it.");
   flowButtons([[L.panelsReset == true ? "Every panel is back to its size" : "Reset every panel's size", function() { dboSound("UIMenuOK"); dboSend("set:panelReset", []); }, undefined, L.panelsReset == true]]);

   flowHeading("Health, magicka and stamina");
   setChoice("Show the bars", ui.vitals == "fade" ? "They come back at once when you are hit, or use stamina or magicka. The hunger and voice panel fades with them and comes back when it changes, while you talk, or while you are hungry." : ui.vitals == "hidden" ? "The hunger and voice panel shows only while you talk." : "",
      [["always", "Always"], ["fade", "Fade when full"], ["hidden", "Hidden"]], ui.vitals, function(v) { setSay("ui", {vitals: v}); });
   if (ui.vitals == "fade")
   {
      setChoice("Fade after", "", [[3, "3 s"], [5, "5 s"], [10, "10 s"]], ui.vitalsFadeSeconds, function(v) { setSay("ui", {vitalsFadeSeconds: v}); });
   }
   setChoice("Style", "Quiet: thin muted bars without the glow.", [["quiet", "Quiet"], ["classic", "Classic"]], ui.vitalsStyle, function(v) { setSay("ui", {vitalsStyle: v}); });

   flowHeading("Chat");
   setChoice("Show the chat", ui.chat == "hidden" ? "T opens it; it goes again a moment after you finish." : ui.chat == "fade" ? "The lines fade with the frame; a new line brings them back." : "The frame fades when idle; the lines stay.",
      [["always", "Always"], ["fade", "Fade when idle"], ["hidden", "Hidden until T"]], ui.chat, function(v) { setSay("ui", {chat: v}); });
   setChoice("Fade delay", "", [[5, "5 s"], [10, "10 s"], [20, "20 s"], [30, "30 s"], [0, "Never"]], ch.fadeSeconds, function(v) { setSay("chat", {fadeSeconds: v}); });
   setChoice("Lettering", "", [["book", "Book"], ["plain", "Plain"]], ui.chatLettering, function(v) { setSay("ui", {chatLettering: v}); });
   setStep("Text size", Number(ch.fontSize), 14, 22, [-1, 1], ch.fontSize + " px", "", function(v) { dboSend("set:chat", [{fontSize: v}]); });
   setStep("Transparency", Number(ch.chatTransparency), 0, 80, [-5, 5], ch.chatTransparency + "%", "", function(v) { dboSend("set:chat", [{chatTransparency: v}]); });
   var words = String(ch.customHighlights);
   flowEntry("Highlight words:  " + (words != "" ? words : "none"), [["Change...", function() { setHighlights(ctx, words); }]], "Commas between them; * at the end matches the start of a word.");

   flowHeading("Names over heads");
   setChoice("Player names", "", [["show", "Shown"], ["hide", "Hidden"]], ch.hidePlayerNames == true ? "hide" : "show", function(v) { setSay("chat", {hidePlayerNames: v == "hide"}); });
   setChoice("Form ids", "The number some players use when reporting a problem.", [["show", "Shown"], ["hide", "Hidden"]], ch.showFormIds == false ? "hide" : "show", function(v) { setSay("chat", {showFormIds: v == "show"}); });
}

function setHighlights(ctx, words)
{
   ctx.form(function(v)
   {
      return {title: "Highlight words", hint: "Commas between them; * at the end matches the start of a word.",
         fields: [{key: "w", label: "Words", kind: "text", max: 300, hint: "gold, \"Aria\", trad*"}],
         buttons: [["Save", function(vals) { setSay("chat", {customHighlights: String(vals.w)}); }, true]]};
   }, {w: words});
}

// ---- Keys (SettingsKeys.tsx GeneralPart): the client captures the key ----

function setKeyRows(s)
{
   var out = [];
   for (var i = 0; i < SET_KEYS.length; i++)
   {
      if (SET_KEYS[i][5] != true || s.staff == true)
      {
         out.push(SET_KEYS[i]);
      }
   }
   return out;
}

function setKeys(L, s)
{
   if (L.keys == null)
   {
      flowText("Your keys cannot be read just now.", 18, C_SECOND);
      return;
   }
   var rows = setKeyRows(s);
   var next = L.keys.next;
   var live = L.keys.live;
   var names = L.keys.names;
   var count = {};
   for (var i = 0; i < rows.length; i++)
   {
      var c0 = Number(next[rows[i][2][0]]) || 0;
      if (c0 > 0)
      {
         count[c0] = count[c0] == undefined ? 1 : count[c0] + 1;
      }
   }
   var pending = false;
   var groups = [["menus", "Menus"], ["view", "View and voice"]];
   for (var g = 0; g < groups.length; g++)
   {
      flowHeading(groups[g][1]);
      for (var r = 0; r < rows.length; r++)
      {
         if (rows[r][3] != groups[g][0])
         {
            continue;
         }
         var row = rows[r];
         var code = Number(next[row[2][0]]) || 0;
         var was = Number(live[row[2][0]]) || 0;
         pending = pending || code != was;
         var on = L.capture == row[0];
         var sub = row[6];
         if (code > 0 && count[code] > 1)
         {
            sub = (sub != "" ? sub + "  " : "") + "Shared with another key.";
         }
         if (code != was)
         {
            sub = (sub != "" ? sub + "  " : "") + "From your next start.";
         }
         var e = flowEntry(row[1] + ":  " + (on ? "press a key or a mouse button" : code > 0 ? String(names[code]) : "None"), [[on ? "Cancel" : "Change", function()
         {
            dboSound("UIMenuOK");
            if (this.on)
            {
               dboSend("set:keyCancel", []);
            }
            else
            {
               dboSend("set:keyCapture", [this.id, this.names, this.optional]);
            }
         }]], sub);
         e.btn0.on = on;
         e.btn0.id = row[0];
         e.btn0.names = row[2];
         e.btn0.optional = row[4];
      }
   }
   flowHint(L.note != undefined && L.note != "" ? String(L.note) : pending ? "Saved. Takes effect when you next start the game." : "Change a key, then press the new one: a keyboard key or a mouse button (not left or right click). Escape cancels; Backspace puts the launcher's key back.");
}

// ---- Camera (SettingsCamera.tsx) ----

function setCamera(L)
{
   flowHeading("Field of view");
   var f = L.fov;
   if (f == null)
   {
      flowText("Set in the launcher (Settings) for this version of the game.", 18, C_SECOND);
      return;
   }
   var min = f.min > 0 ? Number(f.min) : 50;
   var max = f.max > 0 ? Number(f.max) : 140;
   var v = f.value != null ? Math.round(f.value) : f.launcher != null ? Math.round(f.launcher) : 80;
   setStep("Field of view", v, min, max, [-5, -1, 1, 5], v + " degrees", "How wide you see, in first and third person. It changes as you step it and is kept for your next start.", function(n) { dboSend("set:fov", ["set", n]); });
   var at = f.launcher != null && v == Math.round(f.launcher);
   flowEntry("Launcher's value", [[at ? "In use" : "Reset", function() { setSay("fov", "reset"); }, undefined, f.launcher == null || at]],
      f.launcher != null ? Math.round(f.launcher) + " degrees, from the launcher's settings." : "The launcher has not set one.");
}

// ---- Mouse (SettingsMouse.tsx) ----

function setMouse(L)
{
   flowHeading("Mouse");
   setChoice("Leave the game window", "With chat or a panel open, the mouse may move onto another monitor, so you can reach other windows without Alt+Tab. A click outside the game switches to that window.",
      [["off", "Stay in the game"], ["on", "May leave"]], L.mouse == true ? "on" : "off", function(v) { setSay("mouse", v); });
}

// ---- Voice (SettingsVoice.tsx), on the page's voice manager ----

function setDevices(list, current)
{
   var out = [["", "System default"]];
   var seen = {};
   var all = listOf(list).concat(current != "" ? [current] : []);
   for (var i = 0; i < all.length; i++)
   {
      var l = String(all[i]);
      if (l != "" && seen[l] != true)
      {
         seen[l] = true;
         out.push([l, l]);
      }
   }
   return out;
}

function setVoice(L, s)
{
   var v = L.voice;
   if (v == null)
   {
      flowText("Voice is not running in this game just now.", 18, C_SECOND);
      return;
   }
   var p = v.prefs != undefined ? v.prefs : {};
   var inputs = v.devices != undefined ? v.devices.inputs : [];
   var outputs = v.devices != undefined ? v.devices.outputs : [];
   var input = p.inputLabel != undefined ? String(p.inputLabel) : "";
   var output = p.outputLabel != undefined ? String(p.outputLabel) : "";
   var gain = p.micGain != undefined ? Number(p.micGain) : 1;
   var vol = p.outputVolume != undefined ? Number(p.outputVolume) : 1;
   var vad = p.activation == "vad";
   var threshold = p.vadThreshold != undefined ? Number(p.vadThreshold) : 0.06;
   flowHeading("Your voice");
   setChoice("Microphone", listOf(inputs).length ? "" : "Names appear once the game has used your microphone.", setDevices(inputs, input), input, function(x) { setSay("voice", {inputLabel: x}); });
   setChoice("Speakers", "", setDevices(outputs, output), output, function(x) { setSay("voice", {outputLabel: x}); });
   setStep("Your voice volume", Math.round(gain * 100), 0, 200, [-5, 5], Math.round(gain * 100) + "%", "", function(n) { dboSend("set:voice", [{micGain: n / 100}]); });
   setStep("Other players' volume", Math.round(vol * 100), 0, 300, [-5, 5], Math.round(vol * 100) + "%", "", function(n) { dboSend("set:voice", [{outputVolume: n / 100}]); });
   setChoice("Transmit", "", [["ptt", "Push to talk"], ["vad", "Voice activity"]], vad ? "vad" : "ptt", function(x) { setSay("voice", {activation: x}); });
   setMeter = null;
   if (vad)
   {
      var t = Math.round(threshold * 1000);
      setStep("Sensitivity", t, 5, 500, [-5, 5], setFixed(t / 10, 1), "Speak: the bar should pass the mark, and stay under it when you are quiet.", function(n) { dboSend("set:voice", [{vadThreshold: n / 1000}]); });
      var at = flowNeed(18);
      var m = at.clip.createEmptyMovieClip(at.name, fd());
      m._y = at.y + 4;
      dboBox(m, 0, 0, 400, 8, C_STONE, 60);
      var bar = m.createEmptyMovieClip("bar", 1);
      dboBox(bar, 0, 0, 400, 8, C_ACCENT, 100);
      bar._xscale = Math.max(0, Math.min(100, setLevel / 0.5 * 100));
      dboBox(m, Math.min(400, threshold / 0.5 * 400) - 1, -3, 2, 14, C_TEXT, 100);
      setMeter = m;
   }
   if (vad != setLevelSent)
   {
      setLevelSent = vad;
      dboSend("set:level", [vad ? "on" : "off"]);
   }
   flowHint("Changes apply at once. The launcher's Voice tab sets the same values; a change made there later wins.");

   flowHeading("Players near you");
   var near = listOf(s.nearby);
   if (!near.length)
   {
      flowText("Nobody is near enough to hear.", 18, C_SECOND);
   }
   // the player asked for (X's "Voice settings for <name>") first
   var order = [];
   for (var i = 0; i < near.length; i++)
   {
      if (String(near[i].identity) == String(s.focusPeer))
      {
         order.unshift(near[i]);
      }
      else
      {
         order.push(near[i]);
      }
   }
   for (var j = 0; j < order.length; j++)
   {
      var who = order[j];
      var id = String(who.identity);
      var ps = v.peers != undefined && v.peers[id] != undefined ? v.peers[id] : {gain: 1, muted: false};
      var g = Math.round(Number(ps.gain) * 100);
      var muted = ps.muted == true;
      var e = flowEntry(String(who.name) + (who.meters != undefined ? "  " + who.meters + " m" : "") + ":  " + (muted ? "muted" : g + "%"),
         [["-5", setPeerStep, undefined, g <= 0], ["+5", setPeerStep, undefined, g >= 400], [muted ? "Unmute" : "Mute", setPeerMute], ["Reset", setPeerReset, undefined, !muted && g == 100]],
         id == String(s.focusPeer) ? "The voice you asked for." : "");
      for (var k = 0; k < 4; k++)
      {
         e["btn" + k].peer = id;
         e["btn" + k].who = String(who.name);
         e["btn" + k].gain = g;
         e["btn" + k].muted = muted;
      }
      e.btn0.by = -5;
      e.btn1.by = 5;
   }
   flowHint("Each voice's volume is kept on this PC for this character.");
}

function setPeerStep()
{
   dboSound("UIMenuOK");
   dboSend("set:peer", [this.peer, "set", this.who, Math.max(0, Math.min(400, this.gain + this.by)) / 100]);
}

function setPeerMute()
{
   dboSound("UIMenuOK");
   dboSend("set:peer", [this.peer, this.muted ? "unmute" : "mute", this.who]);
}

function setPeerReset()
{
   dboSound("UIMenuOK");
   dboSend("set:peer", [this.peer, "reset", this.who]);
}

// ---- the tab ----

function setSection(s, ctx)
{
   tabKey = function(code)
   {
      if (setLocal != null && setLocal.capture != undefined && setLocal.capture != "")
      {
         if (code == 27)
         {
            dboSound("UIMenuCancel");
            dboSend("set:keyCancel", []);
         }
         return true;
      }
      if (code == 27)
      {
         setBack();
         return true;
      }
      return false;
   };
   flowButtons([["Back to Settings", function() { setBack(); }]]);
   var peer = setSub == "voice" && s.focusPeer != undefined && s.focusPeer != "";
   flowHeading(peer ? "Voice for " + setPeerName(s) : setLabel(setSub));
   if (setLocal == null)
   {
      if (getTimer() - setAskedAt < SET_WAIT_MS)
      {
         flowText("Reading this PC's settings...", 18, C_SECOND);
         tabTick = function() { return getTimer() - setAskedAt >= SET_WAIT_MS; };
         return;
      }
      flowText("This game cannot show these settings here yet. They open in the overlay instead.", 18, C_SECOND);
      var e = flowEntry(setLabel(setSub), [["Open", function() { ctx.browser(this.focusArg); }]], "");
      e.btn0.focusArg = peer ? {section: "voice", peer: String(s.focusPeer)} : {section: setSub};
      return;
   }
   if (setLocal.file == false && (setSub == "interface" || setSub == "mouse"))
   {
      flowText("Your settings file could not be read, so these cannot be changed just now.", 18, C_SECOND);
      return;
   }
   if (setSub == "interface")
   {
      setInterface(setLocal, ctx);
   }
   else if (setSub == "general")
   {
      setKeys(setLocal, s);
   }
   else if (setSub == "camera")
   {
      setCamera(setLocal);
   }
   else if (setSub == "mouse")
   {
      setMouse(setLocal);
   }
   else if (setSub == "voice")
   {
      setVoice(setLocal, s);
   }
   if (setSub != "general" && setLocal.note != undefined && setLocal.note != "")
   {
      flowHint(String(setLocal.note));
   }
}

JT.settings = function(s, ctx)
{
   var voiceOn = s.voiceOn == true;
   // A link to one section (X's "Voice settings for <name>") opens it, once per journal payload that names it
   var want = s.focusPeer != undefined && s.focusPeer != "" && voiceOn ? "voice" : s.section != undefined ? String(s.section) : "";
   var link = ctx.nonce + "|" + want + "|" + (s.focusPeer != undefined ? s.focusPeer : "");
   if (want != "" && setLabel(want) != "" && (want != "voice" || voiceOn) && link != setLinked)
   {
      setLinked = link;
      setSub = want;
      setAsk(s);
   }
   if (setSub == "voice" && !voiceOn)
   {
      setSub = "";
   }
   if (setSub != "")
   {
      setSection(s, ctx);
      return;
   }
   if (setLevelSent)
   {
      setLevelSent = false;
      dboSend("set:level", ["off"]);
   }
   var off = ctx.busy || ctx.readOnly;
   flowHeading("Help");
   flowEntry("Report a problem", [["Report...", function() { setReport(ctx); }, undefined, off]],
      "Say what you were doing and what went wrong. Where you stand and what is around you are sent with it, as with /bug.");
   flowText("Repairing the game files, opening the log folder and resetting every setting are done from the launcher, with the game closed.", 16, C_SECOND);
   flowHeading("Controls");
   flowText("Activate, Jump, Sprint, Sneak, Shout, Toggle POV and Invert Y are kept in the game's own control map, which the game reads once as it starts. Change these in the launcher (Settings), then restart the game.", 16, C_SECOND);
   flowHeading("This PC's settings");
   flowText("Interface size, the bars, chat, names over heads, the camera, the mouse, your own keys and voice are kept on this PC.", 16, C_SECOND);
   var row = [];
   var ids = [];
   for (var i = 0; i < SET_OVERLAY.length; i++)
   {
      if (SET_OVERLAY[i][0] != "voice" || voiceOn)
      {
         row.push([SET_OVERLAY[i][1], function() { setOpen(this.section, this.s); }]);
         ids.push(SET_OVERLAY[i][0]);
      }
   }
   var b = flowButtons(row);
   for (var j = 0; j < ids.length; j++)
   {
      b["btn" + j].section = ids[j];
      b["btn" + j].s = s;
   }
};
