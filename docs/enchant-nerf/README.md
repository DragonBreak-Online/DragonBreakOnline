# Enchantment nerf: analysis and xEdit plan (18 Oct 2026)

**What Nate asked for (18 Oct):** "tone down enchantments so they're not too op", then "analyze and nerf enchantments,
to local claude for xedits".

**Who does what:**
- The server session wrote this from the live load order (`/opt/alduinak/deploy/skyrim-data/loadorder.txt`, 140 plugins).
- The PC session makes the edits in xEdit.

**What is here:**
- `enchant-nerf.csv`: one row per effect to change.
- `tools/enchant-nerf/scan.py` and `plan.py`: these regenerate the table. Run them on CT 115 after any plugin change.

## What the server does with enchantments today

The server decides most combat numbers itself, so an enchantment matters only where something reads it. Three groups:

### 1. Read by the server

- **Fortify One-handed, Two-handed and Archery** (actor values 96/97/98).
  - From server branch `gear-fortify` (Nate GO 18 Oct), `gamemode.js gearAttackMult` reads them.
  - It adds `gearFortify.perPoint` 0.005 a point (half of vanilla), all gear together capped at 25%.
- **Crafted enchantments** are clamped to twice the strongest base-game `EnchWeapon*` / `EnchArmor*` / `EnchRobes*`
  enchantment of that effect (fork `craftedExtrasSystem.enchantmentCaps`). The caps are read from the winning record at
  boot, so lowering the base-game player families in DragonBreak Online Edits also lowers the crafted caps.
  - Deploy check: the log line `[crafted] N enchantment effects known from 5 base game files`.

### 2. Applied by the game client (they work in play, and these are the ones that feel OP)

- **Fortify school** (spell cost):
  - 25% each, and four slots reach 100%, so spells become free.
  - This is the biggest one: 148 effects.
- **Magicka regen:**
  - the College robes give 150%;
  - health and stamina regen.
- **Fortify Magicka, Stamina and Health.**
  - Health: the client's maximum goes up.
  - Whether the server's damage judge honours it is unverified.
- **Carry weight** (up to 200), Sneak, Pickpocket, Lockpicking, Speech, Smithing (tempering).
- **Fortify Block, Heavy Armor, Light Armor:** the client's skill only. The server's block (combat.js) and armour
  (defenseDamageMult) read neither, so these do nothing in a fight.

### 3. Inert on the server (they do nothing to anyone but the wearer's own screen)

- **Weapon on-hit effects:** fire, frost and shock damage, absorb, stamina and magicka damage, paralysis, banish,
  turn undead, fear, frost slow, soul trap.
  - The client sends a hit only when its source is a weapon, spell or scroll (`hitService.ts`).
  - The enchantment's own hit names the ENCH, so it is dropped.
  - Only staves are routed, by C++ ActionListener (11 Oct).
- **Worn resistances** (fire, frost, shock, magic, poison, disease): the damage judge reads resistances only from potions
  and race.
- **Fortify Alchemy and Enchanting:** brewing is server-authored, and crafted enchantments refuse those effects.

## The proposal: halve group 1 and group 2

`enchant-nerf.csv` covers 590 effects in 441 ENCH records:
- every enchantment an item carries;
- plus the player families (`EnchWeapon*` / `EnchArmor*` / `EnchRobes*`, `*Base`), because those set what a player can
  craft.

Each magnitude is multiplied by 0.5:
- rounded to the nearest whole number, at least 1;
- values under 1 keep two decimals.

The effects in group 3 are left alone, because changing them changes nothing in play. Re-check them if the server ever
starts reading them.

| Category | Effects | Example |
|---|---|---|
| Spell cost (Fortify school, AV 108-112, armour and robes) | 148 | 25 -> 13 |
| Fortify Health / Magicka / Stamina | 116 / 30 / 36 | 70 -> 35 |
| Magicka regen (AV 156) | 82 | College robes 150 -> 75 |
| Health / stamina regen | 8 / 7 | 50 -> 25 |
| Fortify One-handed / Two-handed / Archery | 19 / 7 / 10 | 40 -> 20 |
| Speech, carry weight, lockpicking, block, sneak, pickpocket, heavy/light armour, smithing | 29, 24, 15, 13, 11, 11, 9, 8, 7 | carry weight 200 -> 100 |

Left out on purpose:
- Creation Club horse armour, which has Fortify Health 1000 on a horse;
- enchantments that no item carries, other than the player families;
- utilities (Muffle, Waterbreathing, Water Walking, shout cooldown).

## How to apply on the PC

The `edit_in` column says where each record goes. Never edit a Nexus mod's own file.
- **Base game** (Skyrim, Update, Dawnguard, HearthFires, Dragonborn): 508 effects. Override in
  **DragonBreak Online Edits.esp**.
- **Our own plugins:** 4 effects already in DragonBreak Online Edits. Edit in place.
- **Third-party** (Beyond Skyrim, Gray Fox Cowl and others): 78 effects. Override in
  **DragonBreak Nexus Patches.esp**.

Edit only `EFIT` magnitude of effect number `effect_index` (0-based, in record order). Leave area, duration, cost and
everything else alone.
- Keep the ENCH's `ENIT` "Enchant cost" as it is, so charge use and prices do not move. A cost override is a separate
  decision.
- Check the `magnitude` column against the winning record before writing.
  - The table was read from CT 115's `/opt/skyrim-data` with the live 140-plugin load order on 18 Oct.
  - A differing value means the PC's load order differs.
  - Stop and regenerate rather than guess.

Release afterwards: `deploy-plugins` as usual (plugin release, SHA256SUMS, the launcher sync). Then:
1. Set `gearFortify.perPoint` to **0.01** in `gamemode-config.json`, so the server gives the full value the tooltip now
   shows: a halved 40 shows 20% and gives 20%. Without this the two halvings stack to a quarter.
2. Check the `[crafted] ... known from 5 base game files` line at boot.
3. Spot-check in game: a College robe's text reads 75% magicka regen, and the Ancient Redguard Hood reads Fortify
   Archery 20.

## Decisions for Nate

1. **The factor:**
   - 0.5 everywhere is the proposal.
   - A different factor per category is one edit in `plan.py` (`C` table).
   - Spell cost is the one most worth going further: 0.4 keeps four pieces of gear at 40% instead of 50%.
2. **Fortify Health:** it may do nothing server-side (unverified); halving it is safe either way.
3. **Weapon damage enchantments are inert.** Making them work is a client and fork job. Decide their strength then.
