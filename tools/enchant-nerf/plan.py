import json, csv, collections
E=json.load(open('ench.json'))
BASE={'Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm'}
OWN={'DragonBreak Online Edits.esp','DragonBreak.esp','DragonBreak Nexus Patches.esp','DragonBreak Armory.esp'}
# (arch, av) -> (category, factor, where it acts today)
C={}
for av in (108,109,110,111,112): C[av]=('spell cost (Fortify school)',0.5,'client: spell cost')
C.update({155:('health regen',0.5,'client'),156:('magicka regen',0.5,'client'),157:('stamina regen',0.5,'client'),
 24:('fortify health',0.5,'client max; server damage judge unverified'),25:('fortify magicka',0.5,'client'),26:('fortify stamina',0.5,'client'),
 96:('fortify one-handed',0.5,'server gear-fortify (set perPoint 0.01 after this edit)'),97:('fortify two-handed',0.5,'server gear-fortify (set perPoint 0.01 after this edit)'),98:('fortify archery',0.5,'server gear-fortify (set perPoint 0.01 after this edit)'),
 99:('fortify block',0.5,'client only, server block ignores it'),11:('fortify heavy armor',0.5,'client only, server armour ignores it'),12:('fortify light armor',0.5,'client only, server armour ignores it'),
 105:('fortify sneak',0.5,'client'),103:('fortify pickpocket',0.5,'client'),104:('fortify lockpicking',0.5,'client'),107:('fortify speech',0.5,'client'),17:('fortify speech',0.5,'client'),
 100:('fortify smithing',0.5,'client tempering; server Blacksmith tiers ignore it'),32:('carry weight',0.5,'client')})
rows=[]; skipped=collections.Counter()
for e in E:
    player_family=e['edid'].endswith('Base') or e['edid'].startswith(('EnchWeapon','EnchArmor','EnchRobes'))
    if not e['items'] and not player_family: continue
    if e['edid'].startswith('CCHorseArmor'): continue  # a horse's armour, not a player's
    src=e['id'].split(':',1)[1]
    target='DragonBreak Online Edits.esp (override)' if src in BASE else (src+' (in place)' if src in OWN else 'DragonBreak Nexus Patches.esp (override)')
    for i,f in enumerate(e['effects']):
        c=C.get(f['av']) if f['arch'] in (0,34) else None
        if not c or f['mag']<=0: skipped[(f['mgef_edid'])]+=1; continue
        new=max(1,int(f['mag']*c[1]+0.5)) if f['mag']>=1 else round(f['mag']*c[1],2)
        rows.append({'ench':e['id'],'edid':e['edid'],'winner':e['winner'],'edit_in':target,'effect_index':i,'mgef':f['mgef_edid'],'category':c[0],'magnitude':f['mag'],'new_magnitude':new,'items':e['items'],'acts':c[2]})
with open('enchant-nerf.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(len(rows),'effect edits in',len({r['ench'] for r in rows}),'ENCH records')
print(collections.Counter(r['edit_in'].split(' (')[0] if 'Nexus' in r['edit_in'] or 'Online Edits' in r['edit_in'] else 'own' for r in rows))
print(collections.Counter(r['category'] for r in rows).most_common())
print('left alone (top):',skipped.most_common(25))
