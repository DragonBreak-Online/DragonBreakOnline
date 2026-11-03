// The web panels' look for a native panel (STYLE.md section 12), opt-in: a panel that lists this file after dbo.as and
// dbo-controls.as calls webLook(domain) before it draws, then uses webGround, webDivider, webButton and pageBar.
// Colours are skymp5-front/src/dbo-theme.scss's: the domain hue, the fracture line breaking into the Aedra's gold,
// the Heart's red set in each divider, and the gold buttons every web panel wears.

var C_GOLD = 0xE8D6A0;
var C_AEDRIC = 0xE0BA62;
var C_LORKHAN = 0xD65454;
var C_GROUND_3 = 0x16383D;
// dbo-theme.scss $dbo-hue-*: the glow and the deep tint of each part of the world
var DBO_HUES = {aqua: [0x8FD3D0, 0x2F7C80], aedric: [0xE0BA62, 0x7A5E24], lorkhan: [0xD65454, 0x6E1E20],
   dragonbreak: [0xA88CEC, 0x4E3C8A], bronze: [0xD08E54, 0x684020]};
var C_ACCENT_DEEP = 0x2F7C80;
var webDomain = "aqua";

// The panel's domain, as constructor.js gives a web widget its data-domain: the accent (tab marks, the focus wash,
// the corners) follows it from here on
function webLook(domain)
{
   var hue = DBO_HUES[domain] != undefined ? DBO_HUES[domain] : DBO_HUES.aqua;
   webDomain = DBO_HUES[domain] != undefined ? domain : "aqua";
   C_ACCENT = hue[0];
   C_ACCENT_DEEP = hue[1];
}

// dbo-theme's dbo-panel: the branded ground, the domain's deep tint washing down from the top, the Heart's red glowing
// faintly through it, and the fracture line along the top edge
function webGround(clip, w, h)
{
   dboGround(clip, w, h);
   dboGradientBox(clip, 2, 2, w - 4, h * 0.45, [C_ACCENT_DEEP, C_ACCENT_DEEP], [34, 0], [0, 255], Math.PI / 2);
   // the web's radial glow, from linear fills only (the kind every panel already draws in game): strips that fade out
   // to both sides, each fainter and narrower than the one above
   var strips = 12;
   var sh = h * 0.3 / strips;
   for (var i = 0; i < strips; i++)
   {
      var k = 1 - i / strips;
      var sw = w * (0.55 + 0.35 * k);
      dboGradientBox(clip, (w - sw) / 2, 2 + i * sh, sw, sh, [C_LORKHAN, C_LORKHAN, C_LORKHAN], [0, 14 * k * k, 0], [0, 128, 255], 0);
   }
   webFracture(clip, 0, 0, w, 2);
}

// The fracture line: the domain hue from nothing, the Aedra's gold at its centre, back to nothing
function webFracture(clip, x, y, w, h)
{
   dboGradientBox(clip, x, y, w, h, [C_ACCENT, C_ACCENT, C_AEDRIC, C_ACCENT, C_ACCENT], [0, 85, 100, 85, 0], [10, 76, 128, 179, 245], 0);
}

// dbo-theme's dbo-rule: the fracture line with the Heart's red diamond set in its middle
function webDivider(clip, x, y, w)
{
   webFracture(clip, x, y, w, 1);
   var cx = x + w / 2;
   dboPoly(clip, [[cx, y - 4], [cx + 4, y], [cx, y + 4], [cx - 4, y]], C_LORKHAN, 100);
}

// The web's controls drawn over a button() (its label is w wide and size + 8 high): "gold" is dbo-theme's dbo-button,
// translucent gold behind a gold label and edged in gold; "chip" its filter and sort chips, a hairline of the domain hue
// round a plain label; "on" a chosen chip, filled and edged brighter. The label is centred; a disabled one stays grey
function webSkin(b, kind)
{
   var w = b.label._width;
   var h = b.label._height + 2;
   var c = kind == "gold" ? C_GOLD : C_ACCENT;
   var fill = kind == "gold" ? 16 : kind == "on" ? 16 : 5;
   var edge = kind == "gold" ? 55 : kind == "on" ? 90 : 40;
   b.clear();
   dboBox(b, 0, 0, w, h, c, fill);
   dboBox(b, 0, 0, w, 1, c, edge);
   dboBox(b, 0, h - 1, w, 1, c, edge);
   dboBox(b, 0, 0, 1, h, c, edge);
   dboBox(b, w - 1, 0, 1, h, c, edge);
   var f = new TextFormat();
   f.align = "center";
   b.label.setTextFormat(f);
   b.label.setNewTextFormat(f);
   if (kind == "gold" && b.disabled != true)
   {
      b.label.textColor = C_GOLD;
   }
   return b;
}

// Every button a dbo-flow row made (btn0, btn1, ...), skinned: a chip row's chosen one (drawn at A_FOCUS) as "on"
function webSkinRow(c, kind)
{
   for (var i = 0; c["btn" + i] != undefined; i++)
   {
      var b = c["btn" + i];
      webSkin(b, kind == "chip" && b.rest == A_FOCUS ? "on" : kind);
   }
   return c;
}

// A gold button: button()'s arguments and focus behaviour, disable() greys it as it does any control
function webButton(parent, name, depth, x, y, w, label, font, size, rest, onPick)
{
   return webSkin(button(parent, name, depth, x, y, w, label, font, size, rest, onPick), "gold");
}

// A chip, for the lesser controls beside the gold buttons (the web's filters, sorts and row actions)
function webChip(parent, name, depth, x, y, w, label, font, size, rest, onPick)
{
   return webSkin(button(parent, name, depth, x, y, w, label, font, size, rest, onPick), "chip");
}

// The page footer: Previous, "Page n of m", Next, w wide at x, y, drawn into its own clip "pager" on parent. Nothing
// when there is one page. onTurn(-1 or 1) turns; the ends are greyed. Returns the clip, or null
function pageBar(parent, depth, x, y, w, shown, total, onTurn)
{
   if (parent.pager != undefined)
   {
      parent.pager.removeMovieClip();
   }
   if (total <= 1)
   {
      return null;
   }
   var c = parent.createEmptyMovieClip("pager", depth);
   c._x = x;
   c._y = y;
   var bw = 104;
   var pv = webButton(c, "prev", 1, 0, 0, bw, "Previous", F_MEDIUM, 17, A_BUTTON_REST, function() { onTurn(-1); });
   var nx = webButton(c, "next", 2, w - bw, 0, bw, "Next", F_MEDIUM, 17, A_BUTTON_REST, function() { onTurn(1); });
   var t = dboText(c, "where", 3, bw, 3, w - bw * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5, "center"), false);
   t.text = "Page " + (shown + 1) + " of " + total;
   if (shown <= 0)
   {
      disable(pv);
   }
   if (shown >= total - 1)
   {
      disable(nx);
   }
   return c;
}

// For a panel on dbo-flow (list it before this file): every page is drawn already, so a page turn only shows another
// one instead of drawing them all again. The panel calls flowKeep() right before its flowShow, and flowTurn(n) to show
// page n (clamped; the count comes back), then draws its foot again
var flowAll = [];

function flowKeep()
{
   flowAll = actions.slice();
}

function flowTurn(n)
{
   if (focus >= 0 && focus < actions.length)
   {
      actions[focus]._alpha = actions[focus].rest;
      dboWash(actions[focus], false);
   }
   actions = flowAll.slice();
   return flowShow(n);
}

// The mouse wheel turns pages: up is back, down is on. onTurn as pageBar's
function wheelPaging(onTurn)
{
   var l = {};
   l.onMouseWheel = function(delta)
   {
      onTurn(delta > 0 ? -1 : 1);
   };
   Mouse.addListener(l);
   return l;
}
