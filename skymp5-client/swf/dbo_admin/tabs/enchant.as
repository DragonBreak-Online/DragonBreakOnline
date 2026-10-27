// Enchant (server staffenchant.js): the acted-on character's weapons and apparel, the enchantments of the piece's kind
// searched, its effects at the chosen strength, a new name, and Enchant (or Replace, which asks first), as the browser's
// Enchant tab. The catalog and the pack come as staffData widgets the service keeps; buttons go out as dbo:staffEnchant.
var enchLocal = {strength: "", name: "", piecePage: 0};

function round1(n)
{
   return Math.round(n * 10) / 10;
}

TABS.enchant = {
   open: function()
   {
      var E = data.enchant;
      if (E == undefined || E.loading == true)
      {
         dboSend("dbo:staffEnchant", ["catalog"]);
      }
      dboSend("dbo:staffEnchant", ["items", str(ui.acting)]);
   },
   acting: function()
   {
      ui.piece = "";
      ui.ench = "";
      setUi("piece", "", true);
      dboSend("dbo:staffEnchant", ["items", str(ui.acting)]);
   },
   leave: function()
   {
      dboSend("dbo:staffEnchant", ["close"]);
   },
   draw: function(c, x, y, w, h)
   {
      var E = data.enchant != undefined ? data.enchant : {loading: true, pieces: [], rows: []};
      var lw = 300;
      // the pack, left
      section(c, "packHead", 1, x, y, lw, E.packLoading == true ? "Loading the pack" : "Pack of " + cut(E.packName, 20));
      var pieces = E.pieces instanceof Array ? E.pieces : [];
      var per = 7;
      var pages = Math.max(1, Math.ceil(pieces.length / per));
      enchLocal.piecePage = Math.max(0, Math.min(pages - 1, enchLocal.piecePage));
      var shown = pieces.slice(enchLocal.piecePage * per, enchLocal.piecePage * per + per);
      for (var i = 0; i < shown.length; i++)
      {
         var p = shown[i];
         var pb = button(c, "piece" + i, 10 + i, x, y + 32 + i * 50, lw - 10, cut(p.name + (p.count > 1 ? " x" + p.count : ""), 26), F_MEDIUM, 18, p.key == E.piece ? A_FOCUS : A_BUTTON_REST, function()
         {
            dboSound("UIMenuOK");
            ui.ench = "";
            setUi("piece", this.key);
         });
         pb.key = p.key;
         if (p.key == E.piece)
         {
            dboTabMark(pb, lw - 40);
            pb.rest = A_FOCUS;
         }
         if (p.ok != true)
         {
            disable(pb);
         }
         hint(c, "pieceSub" + i, 30 + i, x, y + 58 + i * 50, lw - 10, cut(p.ok == true ? (p.kind == "w" ? "weapon" : "apparel") + (str(p.now) != "" ? " - " + p.now : "") : p.why, 34));
      }
      if (E.packLoading != true && !pieces.length)
      {
         empty(c, "noPieces", 40, x, y + 40, lw, "No weapons or apparel");
      }
      var py = y + 32 + per * 50;
      if (pages > 1)
      {
         btn(c, "piecePrev", 41, x, py, 70, "Up", function()
         {
            enchLocal.piecePage--;
            draw();
         }, enchLocal.piecePage <= 0);
         btn(c, "pieceNext", 42, x + 76, py, 80, "Down", function()
         {
            enchLocal.piecePage++;
            draw();
         }, enchLocal.piecePage >= pages - 1);
      }
      btn(c, "reload", 43, x + 170, py, 120, "Reload pack", function()
      {
         dboSound("UIMenuOK");
         dboSend("dbo:staffEnchant", ["items", str(ui.acting)]);
      });
      // the enchantments, right
      var rx = x + lw + 20;
      var rw = w - lw - 20;
      var kind = "";
      for (var k = 0; k < pieces.length; k++)
      {
         if (pieces[k].key == E.piece)
         {
            kind = pieces[k].kind;
         }
      }
      field(c, "search", 50, rx, y, 360, str(ui.q), kind == "w" ? "Search weapon enchantments" : kind == "a" ? "Search apparel enchantments" : "Search enchantments (pick a piece first)", 60, function(text)
      {
         setUi("q", text);
      }, true);
      hint(c, "count", 51, rx + 376, y + 4, rw - 376, E.loading == true ? "Loading enchantments" : E.total + " of " + E.all);
      var rows = E.rows instanceof Array ? E.rows : [];
      var ly = rowList(c, "r", 60, rx, y + 38, rw, rows, function(r)
      {
         return [[cut(r.n, 24), 0, 230], [cut(r.fx, 34), 236, rw - 380, C_SECOND], [cut(r.p, 14), rw - 136, 110, C_SECOND]];
      }, function(r)
      {
         enchLocal.strength = "";
         setUi("ench", r.id, true);
      }, function(r)
      {
         return E.ench != null && r.id == E.ench.id;
      });
      pager(c, "pg", 80, rx, ly + 2, Number(E.page), Number(E.pages), Number(E.total), "enchantment");
      var ench = E.ench;
      var main = ench != null ? (ench.fx[ench.m] != undefined ? ench.fx[ench.m] : ench.fx[0]) : null;
      var own = main != null ? Number(main[1]) : 0;
      var cap = own * Number(E.maxScale);
      var want = trimText(enchLocal.strength) == "" ? own : Number(enchLocal.strength);
      var strengthOk = !own || (!isNaN(want) && want > 0 && want <= cap + 0.000001);
      var scale = own && strengthOk ? want / own : 1;
      var fy = ly + 36;
      if (ench != null)
      {
         for (var f = 0; f < ench.fx.length && f < 4; f++)
         {
            var fx = ench.fx[f];
            hint(c, "fx" + f, 90 + f, rx, fy + f * 22, rw, fx[0] + (fx[1] ? ": " + round1(fx[1] * scale) + (f == ench.m ? " (main)" : "") : "") + (fx[2] ? " for " + fx[2] + " s" : "") + (fx[3] ? ", area " + fx[3] : ""));
         }
      }
      var ay = CB - 72;
      var pieceName = "";
      var pieceNow = "";
      for (var q = 0; q < pieces.length; q++)
      {
         if (pieces[q].key == E.piece)
         {
            pieceName = pieces[q].name;
            pieceNow = pieces[q].now;
         }
      }
      label(c, "what", 100, rx, ay, rw, (pieceName != "" ? cut(pieceName, 26) : "Pick a piece") + (ench != null ? "  ->  " + cut(ench.n, 26) : ""), 18, pieceName != "" ? C_TEXT : C_SECOND);
      var bx = rx;
      if (own)
      {
         hint(c, "strL", 101, bx, ay + 40, 80, "Strength");
         field(c, "strength", 102, bx + 80, ay + 36, 80, enchLocal.strength, String(own), 8, function(text)
         {
            enchLocal.strength = text;
         });
         hint(c, "strH", 103, bx + 170, ay + 40, 150, "own " + own + ", max " + round1(cap));
         bx += 320;
      }
      field(c, "name", 104, bx, ay + 36, 220, enchLocal.name, "New name (optional)", 64, function(text)
      {
         enchLocal.name = text;
      });
      var apply = function()
      {
         var o = {target: str(ui.acting), key: data.enchant.piece, ench: data.enchant.ench.id, name: trimText(enchLocal.name)};
         var m = data.enchant.ench.fx[data.enchant.ench.m] != undefined ? data.enchant.ench.fx[data.enchant.ench.m] : data.enchant.ench.fx[0];
         if (Number(m[1]))
         {
            o.strength = trimText(enchLocal.strength) == "" ? Number(m[1]) : Number(enchLocal.strength);
         }
         dboSound("UIMenuOK");
         dboSend("dbo:staffEnchant", ["apply", dboJson(o)]);
         enchLocal.name = "";
      };
      var off = pieceName == "" || ench == null || !strengthOk;
      if (pieceNow != "")
      {
         confirmBtn(c, "apply", 105, bx + 232, ay + 32, 0, "Replace enchantment", "replace:" + E.piece + ":" + (ench != null ? ench.id : ""), apply, off);
      }
      else
      {
         btn(c, "apply", 105, bx + 232, ay + 32, 110, "Enchant", apply, off);
      }
   }
};
