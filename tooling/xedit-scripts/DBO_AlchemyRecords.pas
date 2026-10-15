{
  DBO - the Alchemy Rework's records (Nate, 14 Oct; specs/alchemy-pc-records.md, server branch alchemy-rework-1014).
  Builds 10 MGEF, 129 ALCH, 2 FLOR, 28 COBJ bench fixes in one run:
  - each new MGEF, ALCH and FLOR is a copy (as new record) of a vanilla template into DragonBreak Online Edits.esp, with
    EDID, FULL, the description (MGEF), value and weight (ALCH ENIT/DATA) and the effects (EFID, magnitude, area 0,
    duration) set exactly as the data block below; the template's model, sounds, flags and keywords are kept;
  - 28 COBJs of DragonBreak Nexus Patches.esp that sit on the cooking pot (BNAM CraftTypeCookpot) get their right bench;
    AOTVRecipeArmorBeetleCloak keeps the cooking pot on purpose (it hides the forge recipe; the loom one makes the cloak).
  Safety:
  - first every template, magic effect, bench and recipe is looked up and checked against its editor id and record type,
    and every form a template points at must be in a master of DragonBreak Online Edits; if anything is missing or wrong,
    nothing is changed and the result says FATAL with the list;
  - a record whose EDID already exists in DragonBreak Online Edits is skipped (a rerun is safe) and still reported;
  - every record built is read back; any mismatch removes everything this run created, restores the benches, and FATAL.
  Result: Edit Scripts\DBO_AlchemyRecords_result.txt, a JSON object whose "records" maps EDID -> "localid:DragonBreak Online
  Edits.esp" for every record of the data block (node tools/alchemy-records-apply.js fills alchemy-rework.json from it);
  the log: Edit Scripts\DBO_AlchemyRecords_log.txt.
  Run: SSEEdit.exe -D:"<dev Data>" -P:"<server\plugins.server.txt>" -autoload -script:DBO_AlchemyRecords.pas -autoexit
  After: see DBO_AlchemyRecords_README.md (the leftover .save file, the record-by-record diff, deploy-plugins).
  The data block is generated from the spec; do not edit it by hand.
}
unit DBOAlchemyRecords;

const
  DLE_NAME    = 'DragonBreak Online Edits.esp';
  NP_NAME     = 'DragonBreak Nexus Patches.esp';
  RESULT_FILE = 'DBO_AlchemyRecords_result.txt';
  LOG_FILE    = 'DBO_AlchemyRecords_log.txt';

var
  slData, slLog, slOut, slMade, slBench: TStringList;
  Dle, Np: IwbFile;
  Errors, Created, Existing, Fixed: integer;

procedure D(s: string);
begin
  slData.Add(s);
end;

procedure LoadData;
begin
  D('M|DBO_AlchRestoreHealthEffect|Restore Health|Skyrim.esm|03eb15|AlchRestoreHealth|Restores <mag>% of your Health.');
  D('M|DBO_AlchRestoreMagickaEffect|Restore Magicka|Skyrim.esm|03eb17|AlchRestoreMagicka|Restores <mag>% of your Magicka.');
  D('M|DBO_AlchRestoreStaminaEffect|Restore Stamina|Skyrim.esm|03eb16|AlchRestoreStamina|Restores <mag>% of your Stamina.');
  D('M|DBO_AlchRestoreHealthSlowEffect|Restore Health|Skyrim.esm|03eb15|AlchRestoreHealth|Restores <mag>% of your Health over 5 seconds.');
  D('M|DBO_AlchRestoreMagickaSlowEffect|Restore Magicka|Skyrim.esm|03eb17|AlchRestoreMagicka|Restores <mag>% of your Magicka over 5 seconds.');
  D('M|DBO_AlchRestoreStaminaSlowEffect|Restore Stamina|Skyrim.esm|03eb16|AlchRestoreStamina|Restores <mag>% of your Stamina over 5 seconds.');
  D('M|DBO_AlchFortifyBladeEffect|Fortify Blade|Skyrim.esm|03eb19|AlchFortifyOneHanded|Blades do <mag>% more damage for <dur> seconds.');
  D('M|DBO_AlchFortifyBluntEffect|Fortify Blunt|Skyrim.esm|03eb1a|AlchFortifyTwoHanded|Blunt weapons do <mag>% more damage for <dur> seconds.');
  D('M|DBO_AlchFortifyArmorEffect|Fortify Armor|Skyrim.esm|03eb1e|AlchFortifyHeavyArmor|Worn armor counts <mag>% more for <dur> seconds.');
  D('M|DBO_AlchSleepingTreeSapEffect|Sleeping Tree Sap|Skyrim.esm|03eb1c|AlchFortifyBlock|You take <mag>% less damage for <dur> seconds.');
  D('A|DBO_AlchRestoreHealthT1|Potion of Healing|Skyrim.esm|03eade|RestoreHealth02|73|500|NEW:DBO_AlchRestoreHealthEffect:20:0');
  D('A|DBO_AlchRestoreHealthT2|Draught of Healing|Skyrim.esm|03eadf|RestoreHealth03|57|500|NEW:DBO_AlchRestoreHealthEffect:30:0');
  D('A|DBO_AlchRestoreHealthT3|Solution of Healing|Skyrim.esm|03eae3|RestoreHealth04|79|500|NEW:DBO_AlchRestoreHealthEffect:45:0');
  D('A|DBO_AlchRestoreHealthT4|Philter of Healing|Skyrim.esm|039be4|RestoreHealth05|123|500|NEW:DBO_AlchRestoreHealthSlowEffect:60:0');
  D('A|DBO_AlchRestoreHealthT5|Elixir of Healing|Skyrim.esm|039be5|RestoreHealth06|251|500|NEW:DBO_AlchRestoreHealthSlowEffect:75:0');
  D('A|DBO_AlchRestoreMagickaT1|Potion of Magicka|Skyrim.esm|03eae1|RestoreMagicka02|73|500|NEW:DBO_AlchRestoreMagickaEffect:20:0');
  D('A|DBO_AlchRestoreMagickaT2|Draught of Magicka|Skyrim.esm|03eae2|RestoreMagicka03|115|500|NEW:DBO_AlchRestoreMagickaEffect:30:0');
  D('A|DBO_AlchRestoreMagickaT3|Solution of Magicka|Skyrim.esm|03eae4|RestoreMagicka04|158|500|NEW:DBO_AlchRestoreMagickaEffect:45:0');
  D('A|DBO_AlchRestoreMagickaT4|Philter of Magicka|Skyrim.esm|039be6|RestoreMagicka05|247|500|NEW:DBO_AlchRestoreMagickaSlowEffect:60:0');
  D('A|DBO_AlchRestoreMagickaT5|Elixir of Magicka|Skyrim.esm|039be7|RestoreMagicka06|150|500|NEW:DBO_AlchRestoreMagickaSlowEffect:75:0');
  D('A|DBO_AlchRestoreStaminaT1|Potion of Stamina|Skyrim.esm|039be8|RestoreStamina02|44|500|NEW:DBO_AlchRestoreStaminaEffect:20:0');
  D('A|DBO_AlchRestoreStaminaT2|Draught of Stamina|Skyrim.esm|03eae7|RestoreStamina03|28|500|NEW:DBO_AlchRestoreStaminaEffect:30:0');
  D('A|DBO_AlchRestoreStaminaT3|Solution of Stamina|Skyrim.esm|03eae8|RestoreStamina04|39|500|NEW:DBO_AlchRestoreStaminaEffect:45:0');
  D('A|DBO_AlchRestoreStaminaT4|Philter of Stamina|Skyrim.esm|03eae6|RestoreStamina05|61|500|NEW:DBO_AlchRestoreStaminaSlowEffect:60:0');
  D('A|DBO_AlchRestoreStaminaT5|Elixir of Stamina|Skyrim.esm|039cf3|RestoreStamina06|150|500|NEW:DBO_AlchRestoreStaminaSlowEffect:75:0');
  D('A|DBO_AlchRegenHealthT1|Potion of Health Regen|Skyrim.esm|03eb09|FortifyHealRate01|62|500|Skyrim.esm:03eb06:AlchFortifyHealRate:50:300');
  D('A|DBO_AlchRegenHealthT2|Draught of Health Regen|Skyrim.esm|03eb0a|FortifyHealRate02|2285|500|Skyrim.esm:03eb06:AlchFortifyHealRate:100:300');
  D('A|DBO_AlchRegenHealthT3|Solution of Health Regen|Skyrim.esm|03eb0b|FortifyHealRate03|451|500|Skyrim.esm:03eb06:AlchFortifyHealRate:150:300');
  D('A|DBO_AlchRegenHealthT4|Philter of Health Regen|Skyrim.esm|03eb0c|FortifyHealRate04|3136|500|Skyrim.esm:03eb06:AlchFortifyHealRate:175:300');
  D('A|DBO_AlchRegenHealthT5|Elixir of Health Regen|Skyrim.esm|0ff9ff|FortifyHealRate05|4008|500|Skyrim.esm:03eb06:AlchFortifyHealRate:200:300');
  D('A|DBO_AlchRegenMagickaT1|Potion of Magicka Regen|Skyrim.esm|03eb0d|FortifyMagickaRate01|311|500|Skyrim.esm:03eb07:AlchFortifyMagickaRate:50:300');
  D('A|DBO_AlchRegenMagickaT2|Draught of Magicka Regen|Skyrim.esm|03eb0e|FortifyMagickaRate02|380|500|Skyrim.esm:03eb07:AlchFortifyMagickaRate:100:300');
  D('A|DBO_AlchRegenMagickaT3|Solution of Magicka Regen|Skyrim.esm|03eb0f|FortifyMagickaRate03|451|500|Skyrim.esm:03eb07:AlchFortifyMagickaRate:150:300');
  D('A|DBO_AlchRegenMagickaT4|Philter of Magicka Regen|Skyrim.esm|03eb10|FortifyMagickaRate04|522|500|Skyrim.esm:03eb07:AlchFortifyMagickaRate:175:300');
  D('A|DBO_AlchRegenMagickaT5|Elixir of Magicka Regen|Skyrim.esm|0ffa00|FortifyMagickaRate05|668|500|Skyrim.esm:03eb07:AlchFortifyMagickaRate:200:300');
  D('A|DBO_AlchRegenStaminaT1|Potion of Stamina Regen|Skyrim.esm|03eb11|FortifyStaminaRate01|311|500|Skyrim.esm:03eb08:AlchFortifyStaminaRate:50:300');
  D('A|DBO_AlchRegenStaminaT2|Draught of Stamina Regen|Skyrim.esm|03eb12|FortifyStaminaRate02|380|500|Skyrim.esm:03eb08:AlchFortifyStaminaRate:100:300');
  D('A|DBO_AlchRegenStaminaT3|Solution of Stamina Regen|Skyrim.esm|039b0c|FortifyStaminaRate03|451|500|Skyrim.esm:03eb08:AlchFortifyStaminaRate:150:300');
  D('A|DBO_AlchRegenStaminaT4|Philter of Stamina Regen|Skyrim.esm|03eb14|FortifyStaminaRate04|522|500|Skyrim.esm:03eb08:AlchFortifyStaminaRate:175:300');
  D('A|DBO_AlchRegenStaminaT5|Elixir of Stamina Regen|Skyrim.esm|0ffa02|FortifyStaminaRate05|668|500|Skyrim.esm:03eb08:AlchFortifyStaminaRate:200:300');
  D('A|DBO_AlchResistFireT1|Potion of Resist Fire|Skyrim.esm|039b4a|ResistFire25|96|500|Skyrim.esm:03eaea:AlchResistFire:15:60');
  D('A|DBO_AlchResistFireT2|Draught of Resist Fire|Skyrim.esm|039b4a|ResistFire25|96|500|Skyrim.esm:03eaea:AlchResistFire:20:60');
  D('A|DBO_AlchResistFireT3|Solution of Resist Fire|Skyrim.esm|03eae9|ResistFire50|151|500|Skyrim.esm:03eaea:AlchResistFire:30:60');
  D('A|DBO_AlchResistFireT4|Philter of Resist Fire|Skyrim.esm|039b4b|ResistFire75|207|500|Skyrim.esm:03eaea:AlchResistFire:40:60');
  D('A|DBO_AlchResistFireT5|Elixir of Resist Fire|Skyrim.esm|03eaef|ResistFire100|265|500|Skyrim.esm:03eaea:AlchResistFire:50:60');
  D('A|DBO_AlchResistFrostT1|Potion of Resist Frost|Skyrim.esm|039b8a|ResistFrost25|96|500|Skyrim.esm:03eaeb:AlchResistFrost:15:60');
  D('A|DBO_AlchResistFrostT2|Draught of Resist Frost|Skyrim.esm|039b8a|ResistFrost25|96|500|Skyrim.esm:03eaeb:AlchResistFrost:20:60');
  D('A|DBO_AlchResistFrostT3|Solution of Resist Frost|Skyrim.esm|03eaed|ResistFrost50|151|500|Skyrim.esm:03eaeb:AlchResistFrost:30:60');
  D('A|DBO_AlchResistFrostT4|Philter of Resist Frost|Skyrim.esm|039bdf|ResistFrost75|207|500|Skyrim.esm:03eaeb:AlchResistFrost:40:60');
  D('A|DBO_AlchResistFrostT5|Elixir of Resist Frost|Skyrim.esm|03eaf0|ResistFrost100|265|500|Skyrim.esm:03eaeb:AlchResistFrost:50:60');
  D('A|DBO_AlchResistShockT1|Potion of Resist Shock|Skyrim.esm|039be1|ResistShock25|96|500|Skyrim.esm:03eaec:AlchResistShock:15:60');
  D('A|DBO_AlchResistShockT2|Draught of Resist Shock|Skyrim.esm|039be1|ResistShock25|96|500|Skyrim.esm:03eaec:AlchResistShock:20:60');
  D('A|DBO_AlchResistShockT3|Solution of Resist Shock|Skyrim.esm|03eaee|ResistShock50|151|500|Skyrim.esm:03eaec:AlchResistShock:30:60');
  D('A|DBO_AlchResistShockT4|Philter of Resist Shock|Skyrim.esm|039be3|ResistShock75|207|500|Skyrim.esm:03eaec:AlchResistShock:40:60');
  D('A|DBO_AlchResistShockT5|Elixir of Resist Shock|Skyrim.esm|03eaf1|ResistShock100|265|500|Skyrim.esm:03eaec:AlchResistShock:50:60');
  D('A|DBO_AlchFortifyHealthT1|Potion of Fortify Health|Skyrim.esm|03eaf2|FortifyHealth01|77|500|Skyrim.esm:03eaf3:AlchFortifyHealth:30:60');
  D('A|DBO_AlchFortifyHealthT2|Draught of Fortify Health|Skyrim.esm|03eaf4|FortifyHealth02|166|500|Skyrim.esm:03eaf3:AlchFortifyHealth:50:60');
  D('A|DBO_AlchFortifyHealthT3|Solution of Fortify Health|Skyrim.esm|03eaf6|FortifyHealth03|259|500|Skyrim.esm:03eaf3:AlchFortifyHealth:70:60');
  D('A|DBO_AlchFortifyHealthT4|Philter of Fortify Health|Skyrim.esm|03eaf5|FortifyHealth04|355|500|Skyrim.esm:03eaf3:AlchFortifyHealth:90:60');
  D('A|DBO_AlchFortifyHealthT5|Elixir of Fortify Health|Skyrim.esm|0ff9fc|FortifyHealth05|455|500|Skyrim.esm:03eaf3:AlchFortifyHealth:110:60');
  D('A|DBO_AlchFortifyMagickaT1|Potion of Fortify Magicka|Skyrim.esm|03eaf7|FortifyMagicka01|58|500|Skyrim.esm:03eaf8:AlchFortifyMagicka:30:60');
  D('A|DBO_AlchFortifyMagickaT2|Draught of Fortify Magicka|Skyrim.esm|03eafa|FortifyMagicka02|124|500|Skyrim.esm:03eaf8:AlchFortifyMagicka:50:60');
  D('A|DBO_AlchFortifyMagickaT3|Solution of Fortify Magicka|Skyrim.esm|03eafb|FortifyMagicka03|194|500|Skyrim.esm:03eaf8:AlchFortifyMagicka:70:60');
  D('A|DBO_AlchFortifyMagickaT4|Philter of Fortify Magicka|Skyrim.esm|03eafc|FortifyMagicka04|266|500|Skyrim.esm:03eaf8:AlchFortifyMagicka:90:60');
  D('A|DBO_AlchFortifyMagickaT5|Elixir of Fortify Magicka|Skyrim.esm|0ff9fd|FortifyMagicka05|341|500|Skyrim.esm:03eaf8:AlchFortifyMagicka:110:60');
  D('A|DBO_AlchFortifyStaminaT1|Potion of Fortify Stamina|Skyrim.esm|03eafd|FortifyStamina01|170|500|Skyrim.esm:03eaf9:AlchFortifyStamina:30:60');
  D('A|DBO_AlchFortifyStaminaT2|Draught of Fortify Stamina|Skyrim.esm|03eb00|FortifyStamina02|365|500|Skyrim.esm:03eaf9:AlchFortifyStamina:50:60');
  D('A|DBO_AlchFortifyStaminaT3|Solution of Fortify Stamina|Skyrim.esm|03eafe|FortifyStamina03|571|500|Skyrim.esm:03eaf9:AlchFortifyStamina:70:60');
  D('A|DBO_AlchFortifyStaminaT4|Philter of Fortify Stamina|Skyrim.esm|03eaff|FortifyStamina04|784|500|Skyrim.esm:03eaf9:AlchFortifyStamina:90:60');
  D('A|DBO_AlchFortifyStaminaT5|Elixir of Fortify Stamina|Skyrim.esm|0ffa01|FortifyStamina05|341|500|Skyrim.esm:03eaf9:AlchFortifyStamina:110:60');
  D('A|DBO_AlchPoisonHealthT1|Poison of Damage Health|Skyrim.esm|03a5a4|DamageHealth01|58|500|Skyrim.esm:03eb42:AlchDamageHealth:30:0');
  D('A|DBO_AlchPoisonHealthT2|Poison of Damage Health|Skyrim.esm|073f31|DamageHealth02|103|500|Skyrim.esm:03eb42:AlchDamageHealth:35:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:2:10');
  D('A|DBO_AlchPoisonHealthT3|Potent Poison of Damage Health|Skyrim.esm|073f32|DamageHealth03|149|500|Skyrim.esm:03eb42:AlchDamageHealth:40:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:3:10');
  D('A|DBO_AlchPoisonHealthT4|Virulent Poison of Damage Health|Skyrim.esm|073f32|DamageHealth03|149|500|Skyrim.esm:03eb42:AlchDamageHealth:50:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:5:10');
  D('A|DBO_AlchPoisonHealthT5|Deadly Poison of Damage Health|Skyrim.esm|073f34|DamageHealth05|296|500|Skyrim.esm:03eb42:AlchDamageHealth:65:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:5:10');
  D('A|DBO_AlchPoisonMagickaT1|Poison of Damage Magicka|Skyrim.esm|065a65|DamageMagicka01|92|500|Skyrim.esm:03a2b6:AlchDamageMagicka:30:0');
  D('A|DBO_AlchPoisonMagickaT2|Poison of Damage Magicka|Skyrim.esm|073f39|DamageMagicka02|162|500|Skyrim.esm:03a2b6:AlchDamageMagicka:35:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:2:10');
  D('A|DBO_AlchPoisonMagickaT3|Potent Poison of Damage Magicka|Skyrim.esm|073f3a|DamageMagicka03|235|500|Skyrim.esm:03a2b6:AlchDamageMagicka:40:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:3:10');
  D('A|DBO_AlchPoisonMagickaT4|Virulent Poison of Damage Magicka|Skyrim.esm|073f3b|DamageMagicka04|348|500|Skyrim.esm:03a2b6:AlchDamageMagicka:50:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:5:10');
  D('A|DBO_AlchPoisonMagickaT5|Deadly Poison of Damage Magicka|Skyrim.esm|073f3c|DamageMagicka05|465|500|Skyrim.esm:03a2b6:AlchDamageMagicka:65:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:5:10');
  D('A|DBO_AlchPoisonStaminaT1|Poison of Damage Stamina|Skyrim.esm|065a66|DamageStamina01|75|500|Skyrim.esm:03a2c6:AlchDamageStamina:30:0');
  D('A|DBO_AlchPoisonStaminaT2|Poison of Damage Stamina|Skyrim.esm|073f41|DamageStamina02|133|500|Skyrim.esm:03a2c6:AlchDamageStamina:35:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:2:10');
  D('A|DBO_AlchPoisonStaminaT3|Potent Poison of Damage Stamina|Skyrim.esm|073f42|DamageStamina03|192|500|Skyrim.esm:03a2c6:AlchDamageStamina:40:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:3:10');
  D('A|DBO_AlchPoisonStaminaT4|Virulent Poison of Damage Stamina|Skyrim.esm|073f43|DamageStamina04|285|500|Skyrim.esm:03a2c6:AlchDamageStamina:50:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:5:10');
  D('A|DBO_AlchPoisonStaminaT5|Deadly Poison of Damage Stamina|Skyrim.esm|073f44|DamageStamina05|380|500|Skyrim.esm:03a2c6:AlchDamageStamina:65:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:5:10');
  D('A|DBO_AlchFortifyOneHandedT3|Solution of Fortify One-handed|Skyrim.esm|039954|FortifySkillOneHanded02|302|500|Skyrim.esm:03eb19:AlchFortifyOneHanded:10:60');
  D('A|DBO_AlchFortifyOneHandedT4|Philter of Fortify One-handed|Skyrim.esm|039955|FortifySkillOneHanded03|415|500|Skyrim.esm:03eb19:AlchFortifyOneHanded:15:60');
  D('A|DBO_AlchFortifyOneHandedT5|Elixir of Fortify One-handed|Skyrim.esm|039956|FortifySkillOneHanded04|530|500|Skyrim.esm:03eb19:AlchFortifyOneHanded:20:60');
  D('A|DBO_AlchFortifyTwoHandedT3|Solution of Fortify Two-handed|Skyrim.esm|039974|FortifySkillTwoHanded02|302|500|Skyrim.esm:03eb1a:AlchFortifyTwoHanded:10:60');
  D('A|DBO_AlchFortifyTwoHandedT4|Philter of Fortify Two-handed|Skyrim.esm|039980|FortifySkillTwoHanded03|415|500|Skyrim.esm:03eb1a:AlchFortifyTwoHanded:15:60');
  D('A|DBO_AlchFortifyTwoHandedT5|Elixir of Fortify Two-handed|Skyrim.esm|039aa6|FortifySkillTwoHanded04|530|500|Skyrim.esm:03eb1a:AlchFortifyTwoHanded:20:60');
  D('A|DBO_AlchFortifyBladeT3|Solution of Fortify Blade|Skyrim.esm|039954|FortifySkillOneHanded02|302|500|NEW:DBO_AlchFortifyBladeEffect:10:60');
  D('A|DBO_AlchFortifyBladeT4|Philter of Fortify Blade|Skyrim.esm|039955|FortifySkillOneHanded03|415|500|NEW:DBO_AlchFortifyBladeEffect:15:60');
  D('A|DBO_AlchFortifyBladeT5|Elixir of Fortify Blade|Skyrim.esm|039956|FortifySkillOneHanded04|530|500|NEW:DBO_AlchFortifyBladeEffect:20:60');
  D('A|DBO_AlchFortifyBluntT3|Solution of Fortify Blunt|Skyrim.esm|039974|FortifySkillTwoHanded02|302|500|NEW:DBO_AlchFortifyBluntEffect:10:60');
  D('A|DBO_AlchFortifyBluntT4|Philter of Fortify Blunt|Skyrim.esm|039980|FortifySkillTwoHanded03|415|500|NEW:DBO_AlchFortifyBluntEffect:15:60');
  D('A|DBO_AlchFortifyBluntT5|Elixir of Fortify Blunt|Skyrim.esm|039aa6|FortifySkillTwoHanded04|530|500|NEW:DBO_AlchFortifyBluntEffect:20:60');
  D('A|DBO_AlchFortifyArcheryT3|Solution of Fortify Archery|Skyrim.esm|039949|FortifySkillMarksman02|75|500|Skyrim.esm:03eb1b:AlchFortifyMarksman:10:60');
  D('A|DBO_AlchFortifyArcheryT4|Philter of Fortify Archery|Skyrim.esm|03994b|FortifySkillMarksman03|103|500|Skyrim.esm:03eb1b:AlchFortifyMarksman:15:60');
  D('A|DBO_AlchFortifyArcheryT5|Elixir of Fortify Archery|Skyrim.esm|03994e|FortifySkillMarksman04|132|500|Skyrim.esm:03eb1b:AlchFortifyMarksman:20:60');
  D('A|DBO_AlchFortifyDefenceT3|Solution of Fortify Defence|Skyrim.esm|03989b|FortifySkillBlock02|70|500|Skyrim.esm:03eb1c:AlchFortifyBlock:10:60');
  D('A|DBO_AlchFortifyDefenceT4|Philter of Fortify Defence|Skyrim.esm|0398ab|FortifySkillBlock03|193|500|Skyrim.esm:03eb1c:AlchFortifyBlock:15:60');
  D('A|DBO_AlchFortifyDefenceT5|Elixir of Fortify Defence|Skyrim.esm|0398ac|FortifySkillBlock04|247|500|Skyrim.esm:03eb1c:AlchFortifyBlock:20:60');
  D('A|DBO_AlchFortifyArmorT3|Solution of Fortify Armor|Skyrim.esm|0398f4|FortifySkillHeavyArmor02|141|500|NEW:DBO_AlchFortifyArmorEffect:10:60');
  D('A|DBO_AlchFortifyArmorT4|Philter of Fortify Armor|Skyrim.esm|0398f5|FortifySkillHeavyArmor03|193|500|NEW:DBO_AlchFortifyArmorEffect:15:60');
  D('A|DBO_AlchFortifyArmorT5|Elixir of Fortify Armor|Skyrim.esm|0398f6|FortifySkillHeavyArmor04|247|500|NEW:DBO_AlchFortifyArmorEffect:20:60');
  D('A|DBO_AlchFortifyDestructionT3|Solution of Fortify Destruction|Skyrim.esm|0398ee|FortifySkillDestruction02|302|500|Skyrim.esm:03eb26:AlchFortifyDestruction:10:60');
  D('A|DBO_AlchFortifyDestructionT4|Philter of Fortify Destruction|Skyrim.esm|0398f1|FortifySkillDestruction03|415|500|Skyrim.esm:03eb26:AlchFortifyDestruction:15:60');
  D('A|DBO_AlchFortifyDestructionT5|Elixir of Fortify Destruction|Skyrim.esm|0398f3|FortifySkillDestruction04|530|500|Skyrim.esm:03eb26:AlchFortifyDestruction:20:60');
  D('A|DBO_AlchFortifyRestorationT3|Solution of Fortify Restoration|Skyrim.esm|03995a|FortifySkillRestoration02|302|500|Skyrim.esm:03eb28:AlchFortifyRestoration:10:60');
  D('A|DBO_AlchFortifyRestorationT4|Philter of Fortify Restoration|Skyrim.esm|03995b|FortifySkillRestoration03|311|500|Skyrim.esm:03eb28:AlchFortifyRestoration:15:60');
  D('A|DBO_AlchFortifyRestorationT5|Elixir of Fortify Restoration|Skyrim.esm|03995c|FortifySkillRestoration04|530|500|Skyrim.esm:03eb28:AlchFortifyRestoration:20:60');
  D('A|DBO_AlchFortifyAlterationT3|Solution of Fortify Alteration|Skyrim.esm|03988e|FortifySkillAlteration02|530|500|Skyrim.esm:03eb24:AlchFortifyAlteration:25:60');
  D('A|DBO_AlchFortifyAlterationT4|Philter of Fortify Alteration|Skyrim.esm|039899|FortifySkillAlteration03|828|500|Skyrim.esm:03eb24:AlchFortifyAlteration:50:60');
  D('A|DBO_AlchFortifyAlterationT5|Elixir of Fortify Alteration|Skyrim.esm|03989a|FortifySkillAlteration04|227|500|Skyrim.esm:03eb24:AlchFortifyAlteration:75:60');
  D('A|DBO_AlchFortifyConjurationT3|Solution of Fortify Conjuration|Skyrim.esm|0398ad|FortifySkillConjuration02|530|500|Skyrim.esm:03eb25:AlchFortifyConjuration:25:60');
  D('A|DBO_AlchFortifyConjurationT4|Philter of Fortify Conjuration|Skyrim.esm|0398ec|FortifySkillConjuration03|828|500|Skyrim.esm:03eb25:AlchFortifyConjuration:50:60');
  D('A|DBO_AlchFortifyConjurationT5|Elixir of Fortify Conjuration|Skyrim.esm|0398ed|FortifySkillConjuration04|284|500|Skyrim.esm:03eb25:AlchFortifyConjuration:75:60');
  D('A|DBO_AlchFortifyLockpickingT3|Solution of Fortify Lockpicking|Skyrim.esm|039945|FortifySkillLockpicking02|70|500|Skyrim.esm:03eb21:AlchFortifyLockpicking:20:30');
  D('A|DBO_AlchFortifyLockpickingT4|Philter of Fortify Lockpicking|Skyrim.esm|039946|FortifySkillLockpicking03|96|500|Skyrim.esm:03eb21:AlchFortifyLockpicking:30:30');
  D('A|DBO_AlchFortifyLockpickingT5|Elixir of Fortify Lockpicking|Skyrim.esm|039948|FortifySkillLockpicking04|123|500|Skyrim.esm:03eb21:AlchFortifyLockpicking:50:30');
  D('A|DBO_AlchLightT2|Draught of Light|Skyrim.esm|03ac2e|Waterbreathing01|46|500|BSAssets.esm:60193e:BSKAlchLight:5:60');
  D('A|DBO_AlchLightT3|Solution of Light|Skyrim.esm|03ac2f|Waterbreathing02|100|500|BSAssets.esm:60193e:BSKAlchLight:5:120');
  D('A|DBO_AlchLightT4|Philter of Light|Skyrim.esm|03ac30|Waterbreathing03|156|500|BSAssets.esm:60193e:BSKAlchLight:5:180');
  D('A|DBO_AlchLightT5|Elixir of Light|Skyrim.esm|03ac31|Waterbreathing04|215|500|BSAssets.esm:60193e:BSKAlchLight:5:300');
  D('A|DBO_AlchComboRestoreHealthStaminaT4|Philter of Health and Stamina|Skyrim.esm|039be4|RestoreHealth05|123|500|NEW:DBO_AlchRestoreHealthSlowEffect:45:0;NEW:DBO_AlchRestoreStaminaSlowEffect:45:0');
  D('A|DBO_AlchComboRestoreHealthStaminaT5|Elixir of Health and Stamina|Skyrim.esm|039be5|RestoreHealth06|251|500|NEW:DBO_AlchRestoreHealthSlowEffect:60:0;NEW:DBO_AlchRestoreStaminaSlowEffect:60:0');
  D('A|DBO_AlchComboRestoreHealthMagickaT4|Philter of Health and Magicka|Skyrim.esm|039be4|RestoreHealth05|123|500|NEW:DBO_AlchRestoreHealthSlowEffect:45:0;NEW:DBO_AlchRestoreMagickaSlowEffect:45:0');
  D('A|DBO_AlchComboRestoreHealthMagickaT5|Elixir of Health and Magicka|Skyrim.esm|039be5|RestoreHealth06|251|500|NEW:DBO_AlchRestoreHealthSlowEffect:60:0;NEW:DBO_AlchRestoreMagickaSlowEffect:60:0');
  D('A|DBO_AlchComboRestoreMagickaStaminaT4|Philter of Magicka and Stamina|Skyrim.esm|039be6|RestoreMagicka05|247|500|NEW:DBO_AlchRestoreMagickaSlowEffect:45:0;NEW:DBO_AlchRestoreStaminaSlowEffect:45:0');
  D('A|DBO_AlchComboRestoreMagickaStaminaT5|Elixir of Magicka and Stamina|Skyrim.esm|039be7|RestoreMagicka06|150|500|NEW:DBO_AlchRestoreMagickaSlowEffect:60:0;NEW:DBO_AlchRestoreStaminaSlowEffect:60:0');
  D('A|DBO_AlchComboPoisonHealthStaminaT4|Virulent Poison of Health and Stamina|Skyrim.esm|073f32|DamageHealth03|149|500|Skyrim.esm:03eb42:AlchDamageHealth:40:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:3:10;Skyrim.esm:03a2c6:AlchDamageStamina:40:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:3:10');
  D('A|DBO_AlchComboPoisonHealthStaminaT5|Deadly Poison of Health and Stamina|Skyrim.esm|073f34|DamageHealth05|296|500|Skyrim.esm:03eb42:AlchDamageHealth:50:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:5:10;Skyrim.esm:03a2c6:AlchDamageStamina:50:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:5:10');
  D('A|DBO_AlchComboPoisonMagickaStaminaT4|Virulent Poison of Magicka and Stamina|Skyrim.esm|073f3a|DamageMagicka03|235|500|Skyrim.esm:03a2b6:AlchDamageMagicka:40:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:3:10;Skyrim.esm:03a2c6:AlchDamageStamina:40:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:3:10');
  D('A|DBO_AlchComboPoisonMagickaStaminaT5|Deadly Poison of Magicka and Stamina|Skyrim.esm|073f3c|DamageMagicka05|465|500|Skyrim.esm:03a2b6:AlchDamageMagicka:50:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:5:10;Skyrim.esm:03a2c6:AlchDamageStamina:50:0;Skyrim.esm:10de5e:AlchDamageStaminaDuration:5:10');
  D('A|DBO_AlchComboPoisonHealthMagickaT4|Virulent Poison of Health and Magicka|Skyrim.esm|073f32|DamageHealth03|149|500|Skyrim.esm:03eb42:AlchDamageHealth:40:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:3:10;Skyrim.esm:03a2b6:AlchDamageMagicka:40:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:3:10');
  D('A|DBO_AlchComboPoisonHealthMagickaT5|Deadly Poison of Health and Magicka|Skyrim.esm|073f34|DamageHealth05|296|500|Skyrim.esm:03eb42:AlchDamageHealth:50:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:5:10;Skyrim.esm:03a2b6:AlchDamageMagicka:50:0;Skyrim.esm:10de5f:AlchDamageMagickaDuration:5:10');
  D('A|DBO_AlchBloodPotion|Blood Potion|Dawnguard.esm|018ef3|DLC1BloodPotion|75|500|Dawnguard.esm:018ef4:DLC1BloodPotionEffect:0:0;NEW:DBO_AlchRestoreHealthEffect:20:0');
  D('A|DBO_AlchSleepingTreeSap|Sleeping Tree Sap|Skyrim.esm|0aed90|dunSleepingTreeCampSap|100|500|Skyrim.esm:0e3cba:dunSleepingTreeSlowAlch:25:45;Skyrim.esm:0e3cbb:dunSleepingTreeDruggedAlch:0:45;NEW:DBO_AlchSleepingTreeSapEffect:25:45');
  D('F|DBO_HarvestJugOfMilk|DragonBreak Harvest.esp|000801|RP_HarvestJugOfMilk');
  D('F|DBO_HarvestFlourSack|DragonBreak Harvest.esp|000803|RP_HarvestFlourSack');
  D('C|DBOLOOM_ArmorBonesaintCloak|DragonBreak Nexus Patches.esp|000858|MoreCraftableEquipment.esp|MCE_CraftingLoom');
  D('C|DBOLOOM_RedoranWatchmanCloak|DragonBreak Nexus Patches.esp|00085a|MoreCraftableEquipment.esp|MCE_CraftingLoom');
  D('C|DBOLOOM_RhinoBeetleCloak|DragonBreak Nexus Patches.esp|00085b|MoreCraftableEquipment.esp|MCE_CraftingLoom');
  D('C|DBOSM_Bronze_CYRArmorGuardHelmetCheydinhal|DragonBreak Nexus Patches.esp|000be3|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardHelmetChorrol|DragonBreak Nexus Patches.esp|000be2|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardHelmetKvatch|DragonBreak Nexus Patches.esp|000be5|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardHelmetLeyawiin|DragonBreak Nexus Patches.esp|000be4|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldAnvil|DragonBreak Nexus Patches.esp|000be0|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldBravil|DragonBreak Nexus Patches.esp|000be1|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldCheydinhal|DragonBreak Nexus Patches.esp|000be7|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldChorrol|DragonBreak Nexus Patches.esp|000be8|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldKvatch|DragonBreak Nexus Patches.esp|000be6|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldLeyawiin|DragonBreak Nexus Patches.esp|000be9|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_Bronze_CYRArmorGuardShieldSkingrad|DragonBreak Nexus Patches.esp|000bea|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardCuirassCheydinhal|DragonBreak Nexus Patches.esp|00097e|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardCuirassChorrol|DragonBreak Nexus Patches.esp|00097b|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardCuirassKvatch|DragonBreak Nexus Patches.esp|00097d|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardHelmetCheydinhal|DragonBreak Nexus Patches.esp|00097f|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardHelmetChorrol|DragonBreak Nexus Patches.esp|00097c|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardHelmetKvatch|DragonBreak Nexus Patches.esp|000981|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardHelmetLeyawiin|DragonBreak Nexus Patches.esp|000980|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldAnvil|DragonBreak Nexus Patches.esp|000977|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldBravil|DragonBreak Nexus Patches.esp|000978|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldCheydinhal|DragonBreak Nexus Patches.esp|000983|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldChorrol|DragonBreak Nexus Patches.esp|000984|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldKvatch|DragonBreak Nexus Patches.esp|000982|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldLeyawiin|DragonBreak Nexus Patches.esp|000985|Skyrim.esm|CraftingSmithingForge');
  D('C|DBOSM_CYRArmorGuardShieldSkingrad|DragonBreak Nexus Patches.esp|000986|Skyrim.esm|CraftingSmithingForge');
end;

function FileByName(aName: string): IwbFile;
var i: integer;
begin
  Result := nil;
  for i := 0 to Pred(FileCount) do
    if SameText(GetFileName(FileByIndex(i)), aName) then begin
      Result := FileByIndex(i); Exit;
    end;
end;

function Fail(msg: string): integer;
begin
  slLog.Add('ERROR|' + msg); Inc(Errors); Result := 0;
end;

// The fields of a data line (|-separated), into sl
procedure SplitTo(s, delim: string; sl: TStringList);
begin
  sl.Clear; sl.Delimiter := delim; sl.StrictDelimiter := True; sl.DelimitedText := s;
end;

// A record of plugin by its local id, checked against its signature and editor id; nil (and an error) otherwise
function Lookup(plugin, localHex, sig, edid: string): IInterface;
var f: IwbFile; r: IInterface;
begin
  Result := nil;
  f := FileByName(plugin);
  if not Assigned(f) then begin Fail(plugin + ' is not loaded (for ' + edid + ')'); Exit; end;
  r := RecordByFormID(f, (GetLoadOrder(f) shl 24) or StrToInt('$' + localHex), True);
  if not Assigned(r) then begin Fail(edid + ' ' + localHex + ':' + plugin + ' not found'); Exit; end;
  r := MasterOrSelf(r);
  if (Signature(r) <> sig) or (EditorID(r) <> edid) then begin
    Fail(localHex + ':' + plugin + ' is ' + Signature(r) + ' ' + EditorID(r) + ', not ' + sig + ' ' + edid); Exit;
  end;
  Result := r;
end;

// A record of plugin by editor id (for an injected keyword, read from the plugin that defines it)
function ByEditorId(plugin, sig, edid: string): IInterface;
var f: IwbFile;
begin
  Result := nil;
  f := FileByName(plugin);
  if not Assigned(f) then begin Fail(plugin + ' is not loaded (for ' + edid + ')'); Exit; end;
  Result := MainRecordByEditorID(GroupBySignature(f, sig), edid);
  if not Assigned(Result) then Fail(sig + ' ' + edid + ' not found in ' + plugin);
end;

function InDle(sig, edid: string): IInterface;
begin
  Result := MainRecordByEditorID(GroupBySignature(Dle, sig), edid);
end;

// Every form e points at must be in DragonBreak Online Edits or one of its masters, or the copy would add a master
function MastersOk(e: IInterface; what: string): boolean;
var i: integer; t: IInterface; f: IwbFile;
begin
  Result := True;
  t := LinksTo(e);
  if Assigned(t) then begin
    f := GetFile(MasterOrSelf(t));
    if not (Equals(f, Dle) or HasMaster(Dle, GetFileName(f))) then begin
      Fail(what + ' points at ' + Name(t) + ' in ' + GetFileName(f) + ', not a master of ' + DLE_NAME); Result := False; Exit;
    end;
  end;
  for i := 0 to Pred(ElementCount(e)) do
    if not MastersOk(ElementByIndex(e, i), what) then begin Result := False; Exit; end;
end;

// The magic effect an effect field names: NEW:<edid> (made by this run, or already in DLE) or plugin:local:edid
function EffectOf(spec: TStringList; checkOnly: boolean): IInterface;
var j: integer;
begin
  Result := nil;
  if spec[0] = 'NEW' then begin
    j := slMade.IndexOf(spec[1]);
    if j >= 0 then Result := ObjectToElement(slMade.Objects[j])
    else Result := InDle('MGEF', spec[1]);
    if (not Assigned(Result)) and (not checkOnly) then Fail('new magic effect ' + spec[1] + ' not made');
    if checkOnly then begin
      // before the build: it must be one of the data block's own MGEF lines
      Result := nil;
      for j := 0 to Pred(slData.Count) do
        if Pos('M|' + spec[1] + '|', slData[j]) = 1 then Exit;
      Fail('effect NEW:' + spec[1] + ' has no MGEF line');
    end;
  end else
    Result := Lookup(spec[0], spec[1], 'MGEF', spec[2]);
end;

function FileId(e: IInterface; f: IwbFile): cardinal;
begin
  Result := LoadOrderFormIDtoFileFormID(f, GetLoadOrderFormID(e));
end;

// ---- pass 1: check everything, change nothing --------------------------------------------------------------------
procedure CheckAll;
var i, k: integer; fl, ef, sp: TStringList; t, r: IInterface; ok: boolean;
begin
  fl := TStringList.Create; ef := TStringList.Create; sp := TStringList.Create;
  try
    for i := 0 to Pred(slData.Count) do begin
      SplitTo(slData[i], '|', fl);
      if fl[0] = 'M' then begin
        t := Lookup(fl[3], fl[4], 'MGEF', fl[5]);
        if Assigned(t) then MastersOk(t, fl[1]);
      end else if fl[0] = 'A' then begin
        t := Lookup(fl[3], fl[4], 'ALCH', fl[5]);
        if Assigned(t) then MastersOk(t, fl[1]);
        SplitTo(fl[8], ';', ef);
        for k := 0 to Pred(ef.Count) do begin
          SplitTo(ef[k], ':', sp);
          r := EffectOf(sp, True);
          if Assigned(r) then MastersOk(r, fl[1] + ' effect ' + ef[k]);
        end;
      end else if fl[0] = 'F' then begin
        t := Lookup(fl[2], fl[3], 'FLOR', fl[4]);
        // PC 14 Oct: the two FLOR templates live in DragonBreak Harvest.esp (not a DLE master); copied as new, only what they
        // point at matters, so the record header (which links to the template itself) is left out of the check
        if Assigned(t) then for k := 1 to Pred(ElementCount(t)) do MastersOk(ElementByIndex(t, k), fl[1]);
      end else if fl[0] = 'C' then begin
        r := MainRecordByEditorID(GroupBySignature(Np, 'COBJ'), fl[1]);
        if not Assigned(r) then Fail('COBJ ' + fl[1] + ' not in ' + NP_NAME)
        else if not Equals(GetFile(r), Np) then Fail('COBJ ' + fl[1] + ' found outside ' + NP_NAME);
        t := ByEditorId(fl[4], 'KYWD', fl[5]);
        if Assigned(t) and Assigned(r) then begin
          ok := HasMaster(Np, GetFileName(GetFile(MasterOrSelf(t)))) or (GetLoadOrderFormID(t) shr 24 < GetLoadOrder(Np));
          if not ok then Fail('bench ' + fl[5] + ' is not reachable from ' + NP_NAME);
        end;
      end else Fail('data line ' + IntToStr(i) + ' has kind ' + fl[0]);
    end;
  finally
    fl.Free; ef.Free; sp.Free;
  end;
end;

// ---- pass 2: build ------------------------------------------------------------------------------------------------
function Report(edid: string; r: IInterface): string;
begin
  Result := LowerCase(IntToHex(FormID(r) and $FFFFFF, 6)) + ':' + DLE_NAME;
  slOut.Add('  "' + edid + '": "' + Result + '"');
end;

procedure Made(edid: string; r: IInterface);
begin
  slMade.AddObject(edid, TObject(r));
  Inc(Created);
end;

procedure BuildMgef(fl: TStringList);
var t, r: IInterface;
begin
  r := InDle('MGEF', fl[1]);
  if Assigned(r) then begin slLog.Add('EXISTS|' + fl[1]); Inc(Existing); slMade.AddObject(fl[1], TObject(r)); Report(fl[1], r); Exit; end;
  t := Lookup(fl[3], fl[4], 'MGEF', fl[5]);
  if not Assigned(t) then Exit;
  r := wbCopyElementToFile(t, Dle, True, True);
  if not Assigned(r) then begin Fail('copy of ' + fl[5] + ' for ' + fl[1] + ' failed'); Exit; end;
  Made(fl[1], r);
  SetEditorID(r, fl[1]);
  SetElementEditValues(r, 'FULL', fl[2]);
  SetElementEditValues(r, 'DNAM', fl[6]);
  if (EditorID(r) <> fl[1]) or (GetElementEditValues(r, 'FULL') <> fl[2]) or (GetElementEditValues(r, 'DNAM') <> fl[6]) then Fail(fl[1] + ' did not take its EDID, FULL or DNAM');
  slLog.Add('MGEF|' + fl[1] + '|from ' + fl[5] + '|' + Report(fl[1], r));
end;

procedure BuildAlch(fl: TStringList);
var t, r, effs, e: IInterface; ef, sp: TStringList; k: integer; mg: IInterface; want: string;
begin
  r := InDle('ALCH', fl[1]);
  if Assigned(r) then begin slLog.Add('EXISTS|' + fl[1]); Inc(Existing); Report(fl[1], r); Exit; end;
  t := Lookup(fl[3], fl[4], 'ALCH', fl[5]);
  if not Assigned(t) then Exit;
  r := wbCopyElementToFile(t, Dle, True, True);
  if not Assigned(r) then begin Fail('copy of ' + fl[5] + ' for ' + fl[1] + ' failed'); Exit; end;
  Made(fl[1], r);
  SetEditorID(r, fl[1]);
  SetElementEditValues(r, 'FULL', fl[2]);
  SetElementNativeValues(r, 'ENIT\Value', StrToInt(fl[6]));
  SetElementNativeValues(r, 'DATA', StrToInt(fl[7]) / 1000);
  ef := TStringList.Create; sp := TStringList.Create;
  try
    SplitTo(fl[8], ';', ef);
    effs := ElementByName(r, 'Effects');
    if not Assigned(effs) then begin Fail(fl[1] + ' has no Effects'); Exit; end;
    while ElementCount(effs) > 1 do RemoveByIndex(effs, Pred(ElementCount(effs)), True);
    e := ElementByIndex(effs, 0);
    if Assigned(ElementByName(e, 'Conditions')) then RemoveElement(e, 'Conditions');
    for k := 1 to Pred(ef.Count) do ElementAssign(effs, HighInteger, e, False);
    if ElementCount(effs) <> ef.Count then begin Fail(fl[1] + ' has ' + IntToStr(ElementCount(effs)) + ' effects, wants ' + IntToStr(ef.Count)); Exit; end;
    want := '';
    for k := 0 to Pred(ef.Count) do begin
      SplitTo(ef[k], ':', sp);
      mg := EffectOf(sp, False);
      if not Assigned(mg) then Exit;
      e := ElementByIndex(effs, k);
      SetElementNativeValues(e, 'EFID', FileId(mg, Dle));
      SetElementNativeValues(e, 'EFIT\Magnitude', StrToInt(sp[sp.Count - 2]));
      SetElementNativeValues(e, 'EFIT\Area', 0);
      SetElementNativeValues(e, 'EFIT\Duration', StrToInt(sp[sp.Count - 1]));
      // read back
      if not Equals(MasterOrSelf(LinksTo(ElementByPath(e, 'EFID'))), MasterOrSelf(mg)) then Fail(fl[1] + ' effect ' + IntToStr(k) + ' is not ' + EditorID(mg));
      if (GetElementNativeValues(e, 'EFIT\Magnitude') <> StrToInt(sp[sp.Count - 2])) or (GetElementNativeValues(e, 'EFIT\Duration') <> StrToInt(sp[sp.Count - 1])) then Fail(fl[1] + ' effect ' + IntToStr(k) + ' magnitude or duration did not take');
      want := want + EditorID(mg) + ' ' + sp[sp.Count - 2] + '/' + sp[sp.Count - 1] + ' ';
    end;
  finally
    ef.Free; sp.Free;
  end;
  if (EditorID(r) <> fl[1]) or (GetElementEditValues(r, 'FULL') <> fl[2]) or (GetElementNativeValues(r, 'ENIT\Value') <> StrToInt(fl[6])) then Fail(fl[1] + ' did not take its EDID, FULL or value');
  slLog.Add('ALCH|' + fl[1] + '|' + fl[2] + '|from ' + fl[5] + '|' + want + '|' + Report(fl[1], r));
end;

procedure BuildFlor(fl: TStringList);
var t, r: IInterface;
begin
  r := InDle('FLOR', fl[1]);
  if Assigned(r) then begin slLog.Add('EXISTS|' + fl[1]); Inc(Existing); Report(fl[1], r); Exit; end;
  t := Lookup(fl[2], fl[3], 'FLOR', fl[4]);
  if not Assigned(t) then Exit;
  r := wbCopyElementToFile(t, Dle, True, True);
  if not Assigned(r) then begin Fail('copy of ' + fl[4] + ' for ' + fl[1] + ' failed'); Exit; end;
  Made(fl[1], r);
  SetEditorID(r, fl[1]);
  if EditorID(r) <> fl[1] then Fail(fl[1] + ' did not take its EDID');
  slLog.Add('FLOR|' + fl[1] + '|from ' + fl[4] + '|' + Report(fl[1], r));
end;

procedure FixBench(fl: TStringList);
var r, kw: IInterface; was: cardinal;
begin
  r := MainRecordByEditorID(GroupBySignature(Np, 'COBJ'), fl[1]);
  kw := ByEditorId(fl[4], 'KYWD', fl[5]);
  if not (Assigned(r) and Assigned(kw)) then Exit;
  if Equals(MasterOrSelf(LinksTo(ElementBySignature(r, 'BNAM'))), MasterOrSelf(kw)) then begin slLog.Add('BENCH OK|' + fl[1] + '|' + fl[5]); Exit; end;
  was := GetElementNativeValues(r, 'BNAM');
  slBench.AddObject(IntToStr(was), TObject(r));
  SetElementNativeValues(r, 'BNAM', FileId(kw, Np));
  if not Equals(MasterOrSelf(LinksTo(ElementBySignature(r, 'BNAM'))), MasterOrSelf(kw)) then Fail(fl[1] + ' BNAM did not take ' + fl[5])
  else begin Inc(Fixed); slLog.Add('BENCH|' + fl[1] + '|' + IntToHex(was, 8) + ' -> ' + fl[5]); end;
end;

// Everything this run made goes again, every bench goes back, after any error in the build
procedure Rollback;
var i: integer;
begin
  for i := Pred(slMade.Count) downto 0 do
    if Equals(GetFile(ObjectToElement(slMade.Objects[i])), Dle) and (slLog.IndexOf('EXISTS|' + slMade[i]) < 0) then
      Remove(ObjectToElement(slMade.Objects[i]));
  for i := 0 to Pred(slBench.Count) do
    SetElementNativeValues(ObjectToElement(slBench.Objects[i]), 'BNAM', StrToInt64(slBench[i]));
  slLog.Add('ROLLBACK|' + IntToStr(slMade.Count) + ' records removed, ' + IntToStr(slBench.Count) + ' benches restored');
end;

procedure SaveResult(status: string);
var sl: TStringList; i: integer;
begin
  sl := TStringList.Create;
  sl.Add('{');
  sl.Add('  "status": "' + status + '",');
  sl.Add('  "created": ' + IntToStr(Created) + ', "existing": ' + IntToStr(Existing) + ', "benchesFixed": ' + IntToStr(Fixed) + ', "errors": ' + IntToStr(Errors) + ',');
  sl.Add(' "records": {');
  for i := 0 to Pred(slOut.Count) do
    if i < Pred(slOut.Count) then sl.Add(slOut[i] + ',') else sl.Add(slOut[i]);
  sl.Add(' }');
  sl.Add('}');
  sl.SaveToFile(ScriptsPath + RESULT_FILE);
  sl.Free;
  slLog.SaveToFile(ScriptsPath + LOG_FILE);
end;

function Initialize: integer;
var i: integer; fl: TStringList;
begin
  Result := 0; Errors := 0; Created := 0; Existing := 0; Fixed := 0;
  slData := TStringList.Create; slLog := TStringList.Create; slOut := TStringList.Create;
  slMade := TStringList.Create; slBench := TStringList.Create;
  LoadData;
  slLog.Add('DBO_AlchemyRecords, ' + IntToStr(slData.Count) + ' data lines, ' + IntToStr(FileCount) + ' files loaded');
  Dle := FileByName(DLE_NAME); Np := FileByName(NP_NAME);
  if not Assigned(Dle) then Fail(DLE_NAME + ' is not loaded');
  if not Assigned(Np) then Fail(NP_NAME + ' is not loaded');
  if Errors = 0 then CheckAll;
  if Errors > 0 then begin
    slLog.Add('FATAL|' + IntToStr(Errors) + ' problem(s) before the build; nothing was changed');
    slOut.Clear; SaveResult('FATAL: nothing changed, see ' + LOG_FILE); Result := 1; Exit;
  end;
  fl := TStringList.Create;
  try
    // the magic effects first, so the potions can point at them
    for i := 0 to Pred(slData.Count) do begin SplitTo(slData[i], '|', fl); if fl[0] = 'M' then BuildMgef(fl); end;
    for i := 0 to Pred(slData.Count) do begin SplitTo(slData[i], '|', fl); if fl[0] = 'A' then BuildAlch(fl); end;
    for i := 0 to Pred(slData.Count) do begin SplitTo(slData[i], '|', fl); if fl[0] = 'F' then BuildFlor(fl); end;
    for i := 0 to Pred(slData.Count) do begin SplitTo(slData[i], '|', fl); if fl[0] = 'C' then FixBench(fl); end;
  finally
    fl.Free;
  end;
  if Errors > 0 then begin
    Rollback;
    slOut.Clear; SaveResult('FATAL: build failed and was rolled back, see ' + LOG_FILE); Result := 1; Exit;
  end;
  slLog.Add(Format('DONE created %d, existing %d, benches fixed %d', [Created, Existing, Fixed]));
  SaveResult(Format('DONE created %d, existing %d, benches fixed %d', [Created, Existing, Fixed]));
end;

function Finalize: integer;
begin
  Result := 0;
  slData.Free; slLog.Free; slOut.Free; slMade.Free; slBench.Free;
end;

end.
