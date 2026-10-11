import {
  Actor,
  Ammo,
  Game,
  ObjectReference,
  Spell,
  Ui,
  Weapon,
  WeaponType,
  setInventory,
} from 'skyrimPlatform';

import { Entry, Inventory, getInventory, getPlayerEnchantment, isBoundItem } from './inventory';

export const enum SpellType {
  Left,
  Right,
  Voice,
  Instant,
}

export const getEquipedSpell = (
  refr: ObjectReference,
  spellType: SpellType,
): number => {
  const actor = Actor.from(refr);

  if (!actor) {
    return 0;
  }

  switch (spellType) {
    case SpellType.Left: {
      const spell = actor.getEquippedSpell(SpellType.Left);
      return spell ? spell.getFormID() : 0;
    }
    case SpellType.Right: {
      const spell = actor.getEquippedSpell(SpellType.Right);
      return spell ? spell.getFormID() : 0;
    }
    case SpellType.Voice: {
      const spell = actor.getEquippedSpell(SpellType.Voice);
      return spell ? spell.getFormID() : 0;
    }
    case SpellType.Instant: {
      const spell = actor.getEquippedSpell(SpellType.Instant);
      return spell ? spell.getFormID() : 0;
    }
    default: {
      return 0;
    }
  }
};

export interface Equipment {
  inv: Inventory;
  leftSpell?: number;
  rightSpell?: number;
  voiceSpell?: number;
  instantSpell?: number;
  numChanges: number;
}

const filterWorn = (inv: Inventory): Inventory => {
  return { entries: inv.entries.filter((x) => x.worn || x.wornLeft) };
};

const removeUnnecessaryExtra = (inv: Inventory, ignoreAmmo: boolean): Inventory => {
  return {
    entries: inv.entries.map((x) => {
      const r: Entry = JSON.parse(JSON.stringify(x));
      r.chargePercent = r.maxCharge;
      if (r.enchantmentEffects) {
        // Worn player enchantments are rebuilt in this session so the copy looks right
        const form = Game.getFormEx(x.baseId);
        const enchantment = form ? getPlayerEnchantment(r.enchantmentEffects, form) : null;
        r.enchantmentId = enchantment ? enchantment.getFormID() : undefined;
        delete r.enchantmentEffects;
      }
      if (ignoreAmmo) {
        r.count = Ammo.from(Game.getFormEx(x.baseId)) ? r.count : 1;
      } else {
        r.count = Ammo.from(Game.getFormEx(x.baseId)) ? 1000 : 1;
      }
      delete r.name;
      return r;
    }),
  };
};

export const getEquipment = (ac: Actor, numChanges: number): Equipment => {
  // Removed base container items read as negative counts the server's uint32 count refuses
  const inv = getInventory(ac);
  return {
    inv: { entries: inv.entries.filter((e) => e.count > 0) },
    leftSpell: getEquipedSpell(ac, SpellType.Left),
    rightSpell: getEquipedSpell(ac, SpellType.Right),
    voiceSpell: getEquipedSpell(ac, SpellType.Voice),
    instantSpell: getEquipedSpell(ac, SpellType.Instant),
    numChanges,
  };
};

export const syncSpellEquipment = (
  ac: Actor,
  spellBaseId: number | undefined,
  spellType: SpellType,
) => {
  if (spellBaseId !== undefined && spellBaseId > 0) {
    ac.equipSpell(Spell.from(Game.getFormEx(spellBaseId)), spellType);
  } else {
    const equipedSpell = ac.getEquippedSpell(spellType);

    if (equipedSpell) {
      ac.unequipSpell(equipedSpell, spellType);
    }
  }
};

// An NPC's bow comes from the server without its arrows: MpActor::EquipBestWeapon marks only the weapon worn, and the
// worn-only inventory below then took away the arrows the copy had from its base. The engine puts a bow away when it is
// drawn with nothing to shoot, so a Conjure Boneman stood in fights empty-handed (Nate, 11 Oct; the npcDrift reports show
// its right hand 302ca DraugrBow while sheathed and 0 once drawn, every time). Such a copy gets arrows or bolts to go with it.
const NPC_ARROW: [number, string] = [0x01397d, 'Skyrim.esm']; // IronArrow
const NPC_BOLT: [number, string] = [0x000bb3, 'Dawnguard.esm']; // DLC1BoltSteel

export const npcAmmoFor = (worn: Inventory): number => {
  if (worn.entries.some((x) => Ammo.from(Game.getFormEx(x.baseId)))) {
    return 0;
  }
  for (const x of worn.entries) {
    const weapon = Weapon.from(Game.getFormEx(x.baseId));
    const type = weapon ? weapon.getWeaponType() : -1;
    const ammo = type === WeaponType.Bow ? NPC_ARROW : type === WeaponType.Crossbow ? NPC_BOLT : null;
    if (ammo) {
      const form = Game.getFormFromFile(ammo[0], ammo[1]);
      return form ? form.getFormID() : 0;
    }
  }
  return 0;
};

// Server companionSystem SUMMON_SIDEARMS: the summon carries this weapon unworn, and its blows count (OnHit, NPC aggressor)
const SUMMON_SIDEARMS: [number, string, number, string][] = [
  [0x0045b9, 'Dawnguard.esm', 0x02c66f, 'Skyrim.esm'], // DLC1SoulCairnBonemanSummon: DraugrSword, Ancient Nord Sword
];

export const npcSidearmFor = (ac: Actor): number => {
  const baseId = ac.getBaseObject()?.getFormID();
  for (const [npc, npcFile, weapon, weaponFile] of SUMMON_SIDEARMS) {
    if (baseId !== undefined && baseId === Game.getFormFromFile(npc, npcFile)?.getFormID()) {
      return Game.getFormFromFile(weapon, weaponFile)?.getFormID() ?? 0;
    }
  }
  return 0;
};

export const applyEquipment = (ac: Actor, eq: Equipment, opts?: { npcAmmo?: boolean }): boolean => {
  ac.removeAllItems(null, false, true);

  ac.unequipAll();

  ac.removeAllItems(null, false, true);

  const isPlayer = ac.getFormID() === 0x14;
  const worn = filterWorn(eq.inv);
  // Saved bound items have no spell behind them after a reconnect and would never expire
  if (isPlayer) {
    worn.entries = worn.entries.filter((x) => {
      const form = Game.getFormEx(x.baseId);
      return !form || !isBoundItem(form);
    });
  }
  if (!isPlayer && opts?.npcAmmo && !ac.isDead()) {
    const ammoId = npcAmmoFor(worn);
    if (ammoId) {
      worn.entries.push({ baseId: ammoId, count: 1, worn: true });
    }
    const sidearmId = npcSidearmFor(ac);
    if (sidearmId) {
      worn.entries.push({ baseId: sidearmId, count: 1, worn: false });
    }
  }
  const newInventory = removeUnnecessaryExtra(worn, isPlayer);

  setInventory(ac.getFormID(), newInventory);

  syncSpellEquipment(ac, eq.leftSpell, SpellType.Left);
  syncSpellEquipment(ac, eq.rightSpell, SpellType.Right);
  syncSpellEquipment(ac, eq.voiceSpell, SpellType.Voice);
  syncSpellEquipment(ac, eq.instantSpell, SpellType.Instant);

  return true;
};

export const isBadMenuShown = (): boolean => {
  return (
    Ui.isMenuOpen('InventoryMenu') ||
    Ui.isMenuOpen('FavoritesMenu') ||
    Ui.isMenuOpen('MagicMenu') ||
    Ui.isMenuOpen('ContainerMenu') ||
    Ui.isMenuOpen('Crafting Menu') // Actually I don't think it causes crashes
  );
};
