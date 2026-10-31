// Faction (guilds.js, the faction menu inside the journal): invitations, your factions and the open one's members with their
// rank and Remove, Leave and Found a faction. Its actions carry the faction menu's own nonce (dbo:faction* [faction nonce, ...]).
// A row of views picks Members, Realm, War, Treasury, Guild or Rebellion (tabs/factionviews.as draws all but Members);
// staff get every faction. Inviting by name and the rank editor are forms in place of the tab (ctx.form)
var FACTION_KIND = {hold: "Hold", stronghold: "Stronghold", guild: "Guild", cult: "Cult"};
var facSelected = "";
var facPicked = "";
var facNonce = "";
var facRanking = "";
var facOf = "";
// facView: the view shown, "" for Members, else realm, war, treasury, guild or rebellion
var facView = "";

function facSend(s, ctx, key, args)
{
   if (busy || ctx.readOnly)
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   dboSound("UIMenuOK");
   send(key, [s.nonce].concat(args));
   showResult();
}

JT.faction = function(s, ctx)
{
   if (s.nonce != facNonce)
   {
      if (facNonce != "")
      {
         busy = false;
         ctx.busy = false;
      }
      facNonce = s.nonce;
      facRanking = "";
   }
   var off = ctx.busy || ctx.readOnly;
   if (facOf != cacheOf)
   {
      facOf = cacheOf;
      facPicked = "";
      facView = "";
   }
   if (s.selected != undefined && s.selected != "" && s.selected != facSelected)
   {
      facPicked = s.selected;
   }
   facSelected = s.selected != undefined ? s.selected : "";
   if (s.result != undefined && s.result != "")
   {
      flowText(s.result, 17, s.resultKind == "refused" ? C_RED : C_TEXT);
   }
   var views = [[s.staff == true ? "Every faction" : "Members", ""], ["Realm", "realm"]];
   var realm = s.realm;
   var wars = realm != undefined && realm != null ? listOf(realm.wars).length : 0;
   views.push(["War" + (wars ? " (" + wars + ")" : ""), "war"]);
   if (s.economy != undefined && s.economy != null && listOf(s.economy.factions).length)
   {
      views.push(["Treasury", "treasury"]);
   }
   if (s.band != undefined && s.band != null && s.staff != true)
   {
      views.push(["Guild" + (listOf(s.band.invites).length ? " (" + s.band.invites.length + ")" : ""), "guild"]);
   }
   if (s.rebellion != undefined && s.rebellion != null && s.staff != true)
   {
      views.push(["Rebellion", "rebellion"]);
   }
   var shownView = "";
   for (var sv = 0; sv < views.length; sv++)
   {
      if (views[sv][1] == facView)
      {
         shownView = facView;
      }
   }
   var subs = [];
   for (var vi = 0; vi < views.length; vi++)
   {
      subs.push([views[vi][0], function() { facView = this.view; pages[tab] = 0; dboSound("UIMenuPrevNext"); draw(); }, undefined, false, views[vi][1] == shownView]);
   }
   if (s.charters == true && s.staff != true)
   {
      subs.push(["Found a faction", function() { dboSound("UIMenuOK"); send("dbo:menuFind", ["charter"]); }]);
   }
   var vb = flowButtons(subs);
   for (var vq = 0; vq < views.length; vq++)
   {
      vb["btn" + vq].view = views[vq][1];
   }
   if (shownView == "realm")
   {
      facRealm(s, ctx, off);
      return;
   }
   if (shownView == "war")
   {
      facWar(s, ctx, off);
      return;
   }
   if (shownView == "treasury")
   {
      facTreasury(s, ctx, off);
      return;
   }
   if (shownView == "guild")
   {
      facGuild(s, ctx, off);
      return;
   }
   if (shownView == "rebellion")
   {
      facRebellion(s, ctx, off);
      return;
   }
   if (s.staff == true)
   {
      facStaff(s, ctx, off);
      return;
   }
   var invites = listOf(s.invites);
   for (var i = 0; i < invites.length; i++)
   {
      var iv = flowEntry(invites[i].from + " invites you to " + invites[i].name, [["Join", function() { facSend(s, ctx, "dbo:factionAccept", [this._parent.factionId]); }, undefined, off],
         ["Decline", function() { facSend(s, ctx, "dbo:factionDecline", [this._parent.factionId]); }, undefined, off]]);
      iv.factionId = invites[i].factionId;
   }
   var all = listOf(s.factions);
   var factions = [];
   var courtHidden = false;
   for (var a = 0; a < all.length; a++)
   {
      if (all[a].court == true)
      {
         if (all[a].myRank >= 0)
         {
            courtHidden = true;
         }
         continue;
      }
      factions.push(all[a]);
   }
   if (courtHidden)
   {
      flowHint("Your hold's household is on the Court tab.");
   }
   if (!factions.length)
   {
      flowHint("You belong to no faction. A member who may recruit can invite you, from their faction menu or with X.");
      return;
   }
   var f = null;
   var row = [];
   for (var k = 0; k < factions.length; k++)
   {
      if (factions[k].id == facPicked)
      {
         f = factions[k];
      }
   }
   if (f == null)
   {
      f = factions[0];
   }
   for (var j = 0; j < factions.length; j++)
   {
      var meta = factions[j].myTitle != undefined && factions[j].myTitle != "" ? factions[j].myTitle : FACTION_KIND[factions[j].kind] != undefined ? FACTION_KIND[factions[j].kind] : factions[j].kind;
      row.push([factions[j].name + " (" + meta + ")", function() { facPicked = this.fid; facRanking = ""; pages[tab] = 0; draw(); }, undefined, false, factions[j].id == f.id]);
   }
   var bar = flowButtons(row);
   for (var b = 0; b < factions.length; b++)
   {
      bar["btn" + b].fid = factions[b].id;
   }
   flowHeading(f.name);
   flowHint((FACTION_KIND[f.kind] != undefined ? FACTION_KIND[f.kind] : f.kind) + (f.prince != undefined && f.prince != "" ? " of " + f.prince : "") + (f.secret == true ? "  -  secret" : "")
      + (f.myTitle != undefined && f.myTitle != "" ? "  -  you are " + f.myTitle : s.admin == true ? "  -  admin view" : ""));
   var members = listOf(f.members);
   var ranks = listOf(f.ranks);
   if (!members.length)
   {
      flowHint(f.secret == true && f.myRank < 0 && s.admin != true ? "This faction keeps its members secret." : "No members yet.");
   }
   for (var m = 0; m < members.length; m++)
   {
      var mb = members[m];
      var mine = mb.actorId == s.self;
      var outranked = s.admin == true || (f.myRank >= 0 && f.myRank < mb.rank);
      var btns = [];
      if (f.canSetRank == true && !mine)
      {
         btns.push(["Rank...", function() { facRanking = facRanking == this._parent.aid ? "" : this._parent.aid; draw(); }, undefined, off]);
      }
      if (f.canKick == true && outranked)
      {
         btns.push(["Remove", function()
         {
            var r = this._parent;
            ctx.ask("Remove " + r.who + " from " + f.name + "?", "Remove", function() { facSend(s, ctx, "dbo:factionKick", [f.id, r.actorId]); }, true);
         }, C_RED, off]);
      }
      var e = flowEntry(mb.name + " #" + mb.tag + (mb.online == true ? "" : " (offline)") + "   " + mb.title, btns);
      e.aid = String(mb.actorId);
      e.actorId = mb.actorId;
      e.who = mb.name;
      if (facRanking == String(mb.actorId))
      {
         var rr = [];
         for (var q = 0; q < ranks.length; q++)
         {
            rr.push([ranks[q].title, function() { facRanking = ""; facSend(s, ctx, "dbo:factionSetRank", [f.id, this.actorId, this.rankIndex]); }, undefined, off, q == mb.rank]);
         }
         rr.push(["Cancel", function() { facRanking = ""; draw(); }]);
         var rb = flowButtons(rr);
         for (var z = 0; z < ranks.length; z++)
         {
            rb["btn" + z].rankIndex = z;
            rb["btn" + z].actorId = mb.actorId;
         }
      }
   }
   var more = [];
   if (f.canInvite == true)
   {
      more.push(["Invite someone...", function() { facInvite(s, ctx, f); }, undefined, off]);
   }
   if (f.canRename == true)
   {
      more.push(["Ranks and names...", function() { facRanks(s, ctx, f); }, undefined, off]);
   }
   if (f.myRank >= 0)
   {
      more.push(["Leave faction", function()
      {
         ctx.ask("Leave " + f.name + "?", "Leave", function() { facSend(s, ctx, "dbo:factionLeave", [f.id]); }, true);
      }, C_RED, off]);
   }
   if (more.length)
   {
      flowGap(6);
      flowButtons(more);
   }
   flowHint("X on a player invites them.");
};
