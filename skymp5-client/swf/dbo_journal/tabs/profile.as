// Profile (journal.js profileView): the character's facts, the title they go by, their backstory and origin (written in a
// form: lib/dbo-form.as), their three most proficient skills (each opens its page in Skills), every status line, their
// race's powers, and the Help actions. As the browser's ProfileTab:
//   dbo:journalProfile [nonce, backstory, origin]   dbo:journalTitle [nonce, title id]
//   dbo:journalAction [nonce, action, text?]: racialPower [key], level:<health|magicka|stamina>, gm, report, unstuck, reroll
//   dbo:menuOpen [topic]: the player menu, at Trouble or at everything
// An unsaved page outlives the form (Cancel, Escape, a closed journal): Write comes back to it until it is saved or thrown out.
var profDraft = null;
var profPowersAt = 0;
var profPowersOf = null;
var profShown = -1;

function profClock(ms)
{
   var m = Math.ceil(ms / 60000);
   return m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : Math.max(1, m) + " min";
}

function profPct(v)
{
   return Math.round(v * 100) + "%";
}

// What a power's buffs do, in words, as the browser's describePower
function profDescribe(p)
{
   var b = p.buffs != undefined && p.buffs != null ? p.buffs : {};
   var out = [];
   var share = [["meleeDamage", "+", "melee damage"], ["bowDamage", "+", "bow damage"], ["fireDealt", "+", "fire damage"], ["shockDealt", "+", "shock damage"],
      ["resistMagic", "+", "magic resistance"], ["damageTaken", "-", "damage taken"], ["physicalTaken", "-", "physical damage taken"]];
   for (var i = 0; i < share.length; i++)
   {
      if (Number(b[share[i][0]]) > 0)
      {
         out.push(share[i][1] + profPct(Number(b[share[i][0]])) + " " + share[i][2]);
      }
   }
   var regen = [["healthRegen", "health"], ["magickaRegen", "magicka"], ["staminaRegen", "stamina"]];
   for (var r = 0; r < regen.length; r++)
   {
      if (Number(b[regen[r][0]]) > 1)
      {
         out.push(regen[r][1] + " regenerates x" + Number(b[regen[r][0]]));
      }
   }
   if (Number(b.wardPoints) > 0)
   {
      out.push("a ward absorbs " + Number(b.wardPoints) + " spell damage");
   }
   if (Number(b.moveSpeed) > 0)
   {
      out.push("+" + profPct(Number(b.moveSpeed)) + " speed");
   }
   if (Number(b.jumpHeight) > 0)
   {
      out.push("+" + profPct(Number(b.jumpHeight)) + " jump height");
   }
   var text = out.length ? out.join(", ") : p.effect != undefined ? String(p.effect) : "";
   return text != "" ? text.charAt(0).toUpperCase() + text.substr(1) : "";
}

function profOften(p)
{
   var h = Number(p.cooldownHours);
   return h > 0 && h < 24 ? "Again " + profClock(h * 3600000) + " after each use." : "Once a day.";
}

// The time left on a power, counted from when its section arrived (activeMs and waitMs are what was left then)
function profLeft(ms)
{
   return Math.max(0, Number(ms != undefined ? ms : 0) - (getTimer() - profPowersAt));
}

function profPower(p, ctx)
{
   flowText(String(p.name), 18, C_TEXT);
   var what = profDescribe(p);
   flowHint((what != "" ? what + ", for " + p.seconds + " seconds." : "For " + p.seconds + " seconds.") + " " + profOften(p));
   var left = profLeft(p.activeMs);
   var wait = profLeft(p.waitMs);
   if (p.clientOnly == true)
   {
      flowHint("Comes with a later update of the game.");
   }
   else if (left > 0)
   {
      flowText("Upon you: " + Math.ceil(left / 1000) + " s", 16, C_TEXT);
   }
   else if (wait > 0)
   {
      flowHint("Returns in " + profClock(wait));
   }
   else
   {
      var b = flowButtons([["Call on " + p.name, function() { ctx.act("journalAction", this.key != undefined && this.key != "" ? ["racialPower", this.key] : ["racialPower"]); }, undefined, ctx.busy || ctx.readOnly]]);
      b.btn0.key = p.key;
   }
}

// Something to write to staff, with the least it takes, as the browser's ActionText
function profAsk(ctx, label, hint, placeholder, min, action)
{
   ctx.form(function(v)
   {
      var t = v.t != undefined ? String(v.t) : "";
      return {title: label, hint: hint, fields: [{key: "t", label: "What to say", kind: "text", max: 500, lines: 2, count: true, hint: placeholder}],
         buttons: [["Send", function(vals) { ctx.act("journalAction", [action, String(vals.t)]); }, t.length >= min]]};
   });
}

function profWrite(s, ctx)
{
   var init = profDraft != null && profDraft.name == s.name ? {backstory: profDraft.backstory, origin: profDraft.origin} : {backstory: s.backstory, origin: s.origin};
   ctx.form(function(v)
   {
      var b = v.backstory != undefined ? String(v.backstory) : "";
      var o = v.origin != undefined ? String(v.origin) : "";
      var changed = b != String(s.backstory) || o != String(s.origin);
      // what is typed is kept for later, unless it is what is saved
      profDraft = changed ? {name: s.name, backstory: b, origin: o} : null;
      return {title: "Your story", hint: "Cancel or Escape sets the page aside for later; Discard throws it away.",
         fields: [{key: "backstory", label: "Backstory", kind: "text", max: s.backstoryMax != undefined ? s.backstoryMax : 4000, lines: 10, count: true},
            {key: "origin", label: "Origin", kind: "text", max: s.originMax != undefined ? s.originMax : 1000, lines: 4, count: true},
            {kind: "buttons", items: [["Discard", function(vals) { profDraft = null; closeForm(); }, false, true]]}],
         buttons: [["Save", function(vals) { profDraft = null; ctx.act("dbo:journalProfile", [String(vals.backstory), String(vals.origin)]); }, changed]]};
   }, init);
}

function profSkills(s, ctx)
{
   flowHeading("Most proficient");
   var skills = listOf(s.skills).slice(0, 3);
   if (!skills.length)
   {
      flowHint("No skill has been taken up yet.");
      return;
   }
   var linked = false;
   var tabs = data != null ? listOf(data.tabs) : [];
   for (var t = 0; t < tabs.length; t++)
   {
      linked = linked || tabs[t].id == "skills";
   }
   for (var i = 0; i < skills.length; i++)
   {
      var k = skills[i];
      var level = Math.max(0, Math.min(100, Number(k.level) || 0));
      var e = flowEntry((i + 1) + ".  " + k.name + "   " + level, linked ? [["Open", function() { ctx.openTab("skills", {skill: this._parent.skill}); }]] : [],
         String(k.tierName) + (k.epithet != undefined && k.epithet != "" ? "  -  " + k.epithet : ""));
      e.skill = k.id;
   }
}

function profHelp(s, ctx)
{
   var off = ctx.busy || ctx.readOnly;
   flowHeading("Help");
   var points = Number(s.levelPoints) || 0;
   if (points > 0)
   {
      flowText(points + " level point" + (points == 1 ? "" : "s") + " to spend", 18, C_TEXT);
      var lv = flowButtons([["+1 Health", function() { ctx.act("journalAction", ["level:" + this.v]); }, undefined, off], ["+1 Magicka", function() { ctx.act("journalAction", ["level:" + this.v]); }, undefined, off],
         ["+1 Stamina", function() { ctx.act("journalAction", ["level:" + this.v]); }, undefined, off]]);
      lv.btn0.v = "health";
      lv.btn1.v = "magicka";
      lv.btn2.v = "stamina";
   }
   flowEntry("Call a GM", [["Call a GM...", function() { profAsk(ctx, "Call a GM", "A GM is told at once, as with /gm.", "I am stuck in the inn's wall", 3, "gm"); }, undefined, off]], "A GM is told at once, as with /gm.");
   flowEntry("Report a problem", [["Report...", function() { profAsk(ctx, "Report a problem", "Where you stand and what is around you are sent with it, as with /bug.", "the wolf near me is floating", 5, "report"); }, undefined, off]],
      "Where you stand and what is around you are sent with it, as with /bug.");
   flowEntry("Unstuck", [["Unstuck", function() { ctx.ask("Move to the respawn point?", "Move me", function() { ctx.act("journalAction", ["unstuck"]); }); }, undefined, off]],
      "Takes you to your area's respawn point, as /unstuck does: not in a fight with a player, not in jail, and not again for a while.");
   if (s.canReroll == true)
   {
      flowEntry("Identity reroll", [["Reroll", function() { ctx.ask("Spend a reroll now? The character creator reopens for a new race, look and name; your skills and gear stay.", "Reroll", function() { ctx.act("journalAction", ["reroll"]); }, true); }, C_RED, off]],
         "Reopens the character creator for a new race, look and name; your skills and gear stay. It spends one reroll, as /reroll does.");
   }
   flowButtons([["Open a ticket with staff", function() { dboSound("UIMenuOK"); send("dbo:menuOpen", ["trouble"]); }], ["Every command (U)", function() { dboSound("UIMenuOK"); send("dbo:menuOpen", [""]); }]]);
}

// The page redraws once a second while a power is upon the player or waiting to return, as the browser's ticks
function profTick()
{
   var s = cache.profile;
   if (s == undefined || s == null || s.racialPower == undefined || s.racialPower == null)
   {
      return false;
   }
   var all = [s.racialPower].concat(listOf(s.racialPower.others));
   var running = false;
   for (var i = 0; i < all.length; i++)
   {
      running = running || profLeft(all[i].activeMs) > 0 || profLeft(all[i].waitMs) > 0;
   }
   var now = Math.floor((getTimer() - profPowersAt) / 1000);
   if (!running || now == profShown)
   {
      return false;
   }
   profShown = now;
   return true;
}

JT.profile = function(s, ctx)
{
   if (s.racialPower != profPowersOf)
   {
      profPowersOf = s.racialPower;
      profPowersAt = getTimer();
      profShown = -1;
   }
   tabTick = profTick;
   flowRow("Race", String(s.race));
   flowRow("Time in Tamriel", String(s.playtime));
   if (s.created != undefined && s.created != "")
   {
      flowRow("Character made", String(s.created));
   }
   if (s.joined != undefined && s.joined != "")
   {
      flowRow("First arrived", String(s.joined));
   }
   flowHeading("Known as");
   var titles = listOf(s.titles);
   if (titles.length > 1)
   {
      var chips = [];
      for (var i = 0; i < titles.length; i++)
      {
         chips.push([String(titles[i].label), function() { ctx.act("dbo:journalTitle", [this.tid]); }, undefined, ctx.busy || ctx.readOnly, titles[i].id == s.titleId]);
      }
      var row = flowButtons(chips);
      for (var q = 0; q < titles.length; q++)
      {
         row["btn" + q].tid = titles[q].id;
      }
   }
   else
   {
      flowText(String(s.title), 18, C_TEXT);
   }
   if (s.titleEpithet != undefined && s.titleEpithet != "")
   {
      flowHint(String(s.titleEpithet));
   }
   flowHeading("Backstory");
   flowText(s.backstory != undefined && s.backstory != "" ? String(s.backstory) : "No story written yet. Who were you before you came to Bruma?", 17, s.backstory != undefined && s.backstory != "" ? C_TEXT : C_SECOND);
   flowHeading("Origin");
   flowText(s.origin != undefined && s.origin != "" ? String(s.origin) : "Where you were born, your family, what others should know of you.", 17, s.origin != undefined && s.origin != "" ? C_TEXT : C_SECOND);
   var waiting = profDraft != null && profDraft.name == s.name;
   if (waiting)
   {
      flowHint("An unsaved page is waiting.");
   }
   if (!ctx.readOnly)
   {
      flowButtons([[waiting ? "Go back to the page" : "Write", function() { profWrite(s, ctx); }, undefined, ctx.busy]]);
   }
   profSkills(s, ctx);
   var status = listOf(s.status);
   if (s.status != undefined && s.status != null)
   {
      flowHeading("Status");
      if (!status.length)
      {
         flowHint("Nothing is weighing on you.");
      }
      for (var k = 0; k < status.length; k++)
      {
         flowRow(String(status[k].label), String(status[k].value), status[k].hint != undefined ? String(status[k].hint) : "");
      }
   }
   if (s.racialPower != undefined && s.racialPower != null)
   {
      var all = [s.racialPower].concat(listOf(s.racialPower.others));
      flowHeading(all.length > 1 ? "Racial Powers" : "Racial Power");
      for (var p = 0; p < all.length; p++)
      {
         profPower(all[p], ctx);
      }
   }
   if (s.status != undefined && s.status != null)
   {
      profHelp(s, ctx);
   }
};
