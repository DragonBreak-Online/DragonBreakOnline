// Skills (journalskills.js, the masteryMenu object): two views, All skills (the Wheel's spokes and the skills as chips under
// their groups) and the open skill's page: its line and rule, the level and the three moons (Raise, Hold, Lower), the offer to take it up, and its five
// tiers (Blacksmithing: its craft tiers). Actions are journalSkill [nonce, op, skill, arg]: lock <mode>, takeUp
var SKILL_TIERS = ["Novice", "Apprentice", "Adept", "Expert", "Master"];
var SKILL_FLOORS = [1, 25, 50, 75, 90];
var SKILL_LOCKS = [["raise", "Raise", "Goes up when you use it, and gives up points only if no skill is set to Lower."], ["hold", "Hold", "Never goes up, and never gives up points: it stays where it is."], ["lower", "Lower", "Never goes up, and gives its points first when another skill needs room."]];
var SKILL_EPIGRAPH = "Time broke over Nirn, and every life you might have lived is true at once. Only one of them can be mastered.";
var SKILL_ROLE = {primary: "Primary", secondary: "Secondary", resting: "Resting", closed: "Closed"};
var skillsOf = "";
var skillsViewing = "";
var skillsFocus = "";
var skillsList = false;

function heldOf(points, id)
{
   var h = points != null ? listOf(points.held) : [];
   for (var i = 0; i < h.length; i++)
   {
      if (h[i].id == id)
      {
         return h[i];
      }
   }
   return null;
}

function skillsThread(s, k, points, tiers, ctx)
{
   var held = listOf(points.held);
   var h = heldOf(points, k.id);
   var offers = listOf(points.offers);
   var offer = null;
   for (var o = 0; o < offers.length; o++)
   {
      if (offers[o].id == k.id)
      {
         offer = offers[o];
      }
   }
   if (h != null)
   {
      var above = function(floor) { var n = 0; for (var i = 0; i < held.length; i++) { if (held[i].level > floor) { n++; } } return n; };
      var seatTaken = above(points.seatAbove) >= points.seatCount && h.level <= points.seatAbove;
      var expertsTaken = above(points.expertAbove) >= points.expertCount && h.level <= points.expertAbove;
      var ceiling = seatTaken ? (expertsTaken ? points.expertAbove : points.seatAbove) : points.capPerSkill;
      flowText(h.level + " of " + ceiling + "   " + (tiers[h.tier] != undefined ? tiers[h.tier] : ""), 22, C_TEXT);
      var row = [];
      for (var l = 0; l < SKILL_LOCKS.length; l++)
      {
         row.push([SKILL_LOCKS[l][1], function() { ctx.act("dbo:journalSkill", ["lock", k.id, this.mode]); }, undefined, ctx.busy || ctx.readOnly, h.lock == SKILL_LOCKS[l][0]]);
      }
      var bar = flowButtons(row);
      for (var m = 0; m < SKILL_LOCKS.length; m++)
      {
         bar["btn" + m].mode = SKILL_LOCKS[m][0];
      }
      var hint;
      if (ceiling < points.capPerSkill)
      {
         hint = "Another hand already holds the " + (ceiling == points.seatAbove ? "Seat" : "mastery") + " above " + ceiling + ". This craft rises no further until it is given up.";
      }
      else if (h.lock == "hold")
      {
         hint = "Held: it neither rises nor falls. Set it to Raise to train it.";
      }
      else if (h.lock == "lower")
      {
         hint = "Set to Lower: it does not rise, and gives its points first when another skill needs room.";
      }
      else
      {
         hint = "Using it raises it. When the Wheel is full, points come from a skill set to Lower (down to " + (points.waningFloor != undefined ? points.waningFloor : points.transferFloor) + "), then from a raised skill (down to " + points.transferFloor + ").";
      }
      flowHint(hint);
      return h.tier;
   }
   if (offer != null)
   {
      flowText((k.category == "combat" ? "You have fought often enough this way to call it your own." : "You have done this often enough to call it your own.") + " " + offer.banked + " unit(s) of work already stand to your name.", 17, C_TEXT);
      flowButtons([["Take up " + k.label + " - one spoke", function() { ctx.act("dbo:journalSkill", ["takeUp", k.id]); }, undefined, ctx.busy || ctx.readOnly]]);
      return -1;
   }
   flowHint(k.openable == "work" ? "Untaken. Work at it and it will offer itself once there is a level's worth to your name."
      : "Untaken. Set your hand to " + (k.hint != undefined && k.hint != "" ? k.hint : "its station") + " and the first spoke is yours.");
   return -1;
}

function skillsSmith(sm)
{
   var tier = Math.max(1, Math.min(7, Math.floor(Number(sm.tier) || 1)));
   var nextAt = sm.nextAt == null || sm.nextAt == undefined ? null : Number(sm.nextAt);
   var fams = listOf(sm.families);
   var names = listOf(sm.tierNames);
   flowHeading("Craft tier " + tier + "   " + sm.tierName);
   flowHint(nextAt != null ? sm.points + " points, tier " + (tier + 1) + " at " + nextAt : sm.points + " points, the highest tier");
   if (sm.apprentice != null && sm.apprentice != undefined)
   {
      var an = sm.apprentice.family;
      for (var a = 0; a < fams.length; a++)
      {
         if (fams[a].id == sm.apprentice.family)
         {
            an = fams[a].name;
         }
      }
      flowHint("Apprenticeship: " + an + ", " + sm.apprentice.count + " of " + sm.apprentice.of);
   }
   flowHint(sm.upgradeRule);
   for (var t = 1; t <= 7; t++)
   {
      var inTier = [];
      for (var i = 0; i < fams.length; i++)
      {
         if (Math.max(1, Math.min(7, Math.floor(Number(fams[i].tier) || 1))) == t)
         {
            inTier.push(fams[i]);
         }
      }
      if (!inTier.length)
      {
         continue;
      }
      var reached = t <= tier;
      flowText("Tier " + t + (names[t - 1] != undefined ? ": " + names[t - 1] : "") + (reached ? "" : " (needs craft tier " + t + ")"), 19, reached ? C_TEXT : C_SECOND);
      var learned = [];
      var locked = [];
      var fl = [];
      for (var j = 0; j < inTier.length; j++)
      {
         var f = inTier[j];
         fl.push(f.name + (reached && f.known == true && f.how != undefined && f.how != null ? " (" + (f.how == "book" ? "from a book" : f.how == "apprentice" ? "as an apprentice" : f.how == "staff" ? "from staff" : f.how) + ")" : ""));
         var rs = listOf(f.recipes);
         var lockedHere = [];
         for (var r = 0; r < rs.length; r++)
         {
            var nm = typeof rs[r] == "string" ? rs[r] : rs[r] != null && typeof rs[r].name == "string" ? rs[r].name : "";
            if (nm == "")
            {
               continue;
            }
            var got = reached && (typeof rs[r] == "object" && rs[r] != null && typeof rs[r].learned == "boolean" ? rs[r].learned : f.known == true);
            if (got)
            {
               learned.push(nm);
            }
            else
            {
               lockedHere.push(nm);
            }
         }
         if (lockedHere.length || (f.known != true && !(f.recipes instanceof Array)))
         {
            locked.push(f.name + (f.learnHint != undefined && f.learnHint != "" && reached ? ": " + f.learnHint : "") + (lockedHere.length ? "  -  " + lockedHere.join(", ") : ""));
         }
      }
      flowRow("Craftable equipment", fl.join(", "));
      flowRow("Learned recipes", learned.length ? learned.join(", ") : "None yet.");
      for (var u = 0; u < locked.length; u++)
      {
         flowRow(u == 0 ? "Unlearned recipes" : "", locked[u]);
      }
   }
}

JT.skills = function(s, ctx)
{
   var skills = listOf(s.skills);
   var cats = listOf(s.categories);
   if (!cats.length)
   {
      cats = [{id: "combat", label: "Combat"}, {id: "profession", label: "Professions"}, {id: "support", label: "Support"}];
   }
   var tiers = listOf(s.tierNames).length ? s.tierNames : SKILL_TIERS;
   var points = s.points != undefined && s.points != null && s.points.enabled == true ? s.points : null;
   var chosen = listOf(s.chosen);
   var held = points != null ? listOf(points.held) : [];
   if (skillsOf != cacheOf)
   {
      skillsOf = cacheOf;
      skillsViewing = s.focus != undefined && s.focus != "" ? s.focus : held.length ? held[0].id : skills.length ? skills[0].id : "";
      skillsList = false;
   }
   if (s.focus != undefined && s.focus != "" && s.focus != skillsFocus)
   {
      skillsViewing = s.focus;
      skillsList = false;
   }
   skillsFocus = s.focus != undefined ? s.focus : "";
   var k = null;
   for (var i = 0; i < skills.length; i++)
   {
      if (skills[i].id == skillsViewing)
      {
         k = skills[i];
      }
   }
   if (k == null && skills.length)
   {
      k = skills[0];
   }
   if (k == null)
   {
      flowText("No skills are known to this server.", 18, C_SECOND);
      return;
   }
   flowButtons([["All skills", function() { dboSound("UIMenuPrevNext"); skillsList = true; pages[tab] = 0; draw(); }, undefined, false, skillsList],
      [k.label, function() { dboSound("UIMenuPrevNext"); skillsList = false; pages[tab] = 0; draw(); }, undefined, false, !skillsList]]);
   if (skillsList)
   {
      skillsPicker(s, skills, cats, points, chosen, tiers, k);
      return;
   }
   skillsPage(s, k, points, chosen, tiers, ctx);
};

function skillsPicker(s, skills, cats, points, chosen, tiers, k)
{
   if (points != null)
   {
      flowText(points.used + " / " + points.pool + " spokes of the Wheel", 18, C_SECOND);
   }
   for (var c = 0; c < cats.length; c++)
   {
      var row = [];
      var ids = [];
      for (var j = 0; j < skills.length; j++)
      {
         if (skills[j].category != cats[c].id)
         {
            continue;
         }
         var h = heldOf(points, skills[j].id);
         var mine = null;
         for (var m = 0; m < chosen.length; m++)
         {
            if (chosen[m].id == skills[j].id)
            {
               mine = chosen[m];
            }
         }
         var tag = points != null ? (h != null ? " " + h.level + (h.lock != "raise" ? " " + h.lock : "") : "") : mine != null ? " " + (tiers[mine.rank] != undefined ? tiers[mine.rank] : "") : "";
         row.push([skills[j].label + tag, function() { dboSound("UIMenuFocus"); skillsViewing = this.skill; skillsList = false; pages[tab] = 0; draw(); }, undefined, false, skills[j].id == k.id]);
         ids.push(skills[j].id);
      }
      if (!row.length)
      {
         continue;
      }
      flowText(cats[c].label, 15, C_SECOND);
      var bar = flowButtons(row);
      for (var b = 0; b < ids.length; b++)
      {
         bar["btn" + b].skill = ids[b];
      }
   }
}

function skillsPage(s, k, points, chosen, tiers, ctx)
{
   flowHint(s.epigraph != undefined && s.epigraph != "" ? s.epigraph : SKILL_EPIGRAPH);
   flowHeading(k.label + (k.title != undefined && k.title != "" ? ", " + k.title : ""));
   if (k.lore != undefined && k.lore != "")
   {
      flowText(k.lore, 17, C_SECOND);
   }
   flowText(k.description, 17, C_TEXT);
   var ms = s.magicSchools;
   if (k.id == "arcane" && ms != undefined && ms != null)
   {
      var sch = listOf(ms.schools);
      for (var q = 0; q < sch.length; q++)
      {
         var x = sch[q];
         var on = x.role == "primary" || x.role == "secondary";
         flowRow(x.name, (SKILL_ROLE[x.role] != undefined ? SKILL_ROLE[x.role] : x.role) + (x.level > 0 ? "  -  " + x.level : ""), on ? (x.castToday >= ms.castCap ? "Casting limit reached today" : "Casting today " + Math.floor(x.castToday) + " / " + ms.castCap) : "");
      }
      flowHint(ms.chosen == true ? "Casting trains only your primary and secondary schools. A resting or closed school's spells train Arcane Arts alone. Study Magic and classes still count after the casting limit."
         : "Your schools of magic open at Arcane Arts " + ms.firstAt + ". Until then, casting trains Arcane Arts alone.");
   }
   if ((k.id == "arcane" || k.id == "priest") && JT.magic != undefined)
   {
      flowEntry("Your schools of magic are on the Magic tab.", [["Open Magic", function() { ctx.openTab("magic"); }]]);
   }
   var tier = -1;
   if (points != null)
   {
      tier = skillsThread(s, k, points, tiers, ctx);
   }
   else
   {
      var my = null;
      for (var n = 0; n < chosen.length; n++)
      {
         if (chosen[n].id == k.id)
         {
            my = chosen[n];
         }
      }
      tier = my != null ? my.rank : -1;
      flowText(my != null ? (tiers[my.rank] != undefined ? tiers[my.rank] : "") + "  -  " + my.hours : "Untaken. Press K beside a standing stone to change your path.", 17, my != null ? C_TEXT : C_SECOND);
   }
   if (k.id == "blacksmith" && s.smith != undefined && s.smith != null)
   {
      skillsSmith(s.smith);
      return;
   }
   var hours = listOf(s.tierHours);
   flowHeading("The tiers");
   for (var t = 0; t < tiers.length; t++)
   {
      var cost = points != null ? (t == 0 ? "the first spoke" : "level " + SKILL_FLOORS[t]) : (hours[t] == undefined || hours[t] == 0 ? "from the start" : hours[t] + " hours");
      var lore = listOf(k.tierLore)[t];
      var perk = listOf(k.tiers)[t];
      var tr = flowRow(tiers[t] + (t == tier ? "  (yours)" : ""), (lore != undefined && lore != "" ? lore + "  " : "") + (perk != undefined ? perk : ""), cost);
      tr.textColor = tier >= t ? C_TEXT : C_SECOND;
   }
}
