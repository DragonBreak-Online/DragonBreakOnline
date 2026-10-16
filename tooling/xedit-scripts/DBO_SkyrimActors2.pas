{
  DBO - Skyrim NPC pass 2 (Nate, 16 Oct: "Server spawns only, like normal", as in Bruma): disable every plugin-placed
  living actor still enabled in open Skyrim - guards, townsfolk, merchants, children, friendly NPCs, harmless creatures,
  mannequins and pass 1's decision keeps (Ysgramor's ghosts, Vaermina's devotees, giants). Enemies and wildlife come only
  from the server's own spawns. Same technique as pass 1 (DBO_SkyrimActors.pas): Initially Disabled, Enable Parent (XESP)
  removed so the flag sticks. Nothing else on the record changes.

  List: DBO_SkyrimActorsList2.txt, one per line
    disable|owningplugin|localObjectID|expectedBaseEditorID|targetPlugin|reason
  Made on CT 115 by tools/skyrim_actor_all.py from the LIVE 140 order (DLE 4bb30e63, Nexus Patches 94cd9935, which carry
  pass 1). reason: guard, townsfolk, merchant, child, friendly, creature, kept-decision or other, with a note.
  targetPlugin: DragonBreak Online Edits.esp for vanilla/DLC/Creation Club/DragonBreak refs, DragonBreak Nexus Patches.esp
  for a Nexus mod's own refs (third-party edits never go in the DLE or the mod) or a ref whose winner is Nexus Patches.

  Rules (pass 1 lessons):
  - the expected base is checked on the WINNING override ("*" skips the check); a mismatch is skipped and logged;
  - a ref the winner already has Initially Disabled is left untouched (SKIP already disabled);
  - a ref the target plugin already overrides: that override - the target's OWN record - gets only the flag and the XESP
    removal. It is never rebuilt from an earlier plugin's version (that lost Greymoor and Tamriel edits in pass 1);
  - otherwise the winning version is copied into the target as an override (xEdit adds masters and parent CELL/WRLD as
    needed; every parent it copies must then be the winning version: tooling/xedit-scripts/DBO_SkyrimActorsList2_parents.txt).
  Result: Edit Scripts\DBO_SkyrimActors2_result.txt. DRY RUN FIRST: DRY_RUN is True; run, read the result, then set False.
  Check on CT 115: tools/skyrim_npc_gate.py --pass2.
}
unit DBOSkyrimActors2;

const
  LIST_FILE     = 'DBO_SkyrimActorsList2.txt';
  RESULT_FILE   = 'DBO_SkyrimActors2_result.txt';
  DRY_RUN       = True;
  SINK_Z        = -30000.0;
  FLAG_DISABLED = $800;

var
  slLog, slList, slParts: TStringList;
  TargetFile: IwbFile;
  tgtName: string;
  cDone, cSkip, cFail, cOwn, cCopy: integer;

function FileByName(aName: string): IwbFile;
var i: integer;
begin
  Result := nil;
  for i := 0 to Pred(FileCount) do
    if SameText(GetFileName(FileByIndex(i)), aName) then begin
      Result := FileByIndex(i); Exit;
    end;
end;

function Initialize: integer;
var
  i, j, flags: integer;
  op, plug, hex, want, got, tag, why: string;
  f: IwbFile;
  rec, win, ovr, base, m, own: IwbMainRecord;
  fid: cardinal;
  ok: boolean;
begin
  Result := 0;
  slLog := TStringList.Create;
  slList := TStringList.Create;
  slParts := TStringList.Create;
  slParts.Delimiter := '|';
  slParts.StrictDelimiter := True;
  cDone := 0; cSkip := 0; cFail := 0; cOwn := 0; cCopy := 0;


  slList.LoadFromFile(ScriptsPath + LIST_FILE);
  slLog.Add('targets in list: ' + IntToStr(slList.Count));

  for i := 0 to Pred(slList.Count) do begin
    if Trim(slList[i]) = '' then Continue;
    slParts.DelimitedText := Trim(slList[i]);
    if slParts.Count < 5 then begin slLog.Add('FAIL   bad line ' + slList[i]); Inc(cFail); Continue; end;
    op := slParts[0]; plug := slParts[1]; hex := slParts[2]; want := slParts[3]; tgtName := slParts[4];
    why := '';
    if slParts.Count > 5 then why := slParts[5];
    tag := op + ' ' + plug + ':' + hex + ' ' + want + ' [' + why + ']';

    f := FileByName(plug);
    if not Assigned(f) then begin slLog.Add('FAIL   plugin not loaded  ' + tag); Inc(cFail); Continue; end;
    fid := (MasterCount(f) shl 24) or StrToInt('$' + hex);
    rec := RecordByFormID(f, fid, True);
    if not Assigned(rec) then begin slLog.Add('FAIL   not found          ' + tag); Inc(cFail); Continue; end;

    base := LinksTo(ElementByPath(WinningOverride(rec), 'NAME'));
    got := '';
    if Assigned(base) then got := EditorID(base);
    if (want <> '*') and (not SameText(got, want)) then begin
      slLog.Add('SKIP   base mismatch      ' + tag + ' got ' + got); Inc(cSkip); Continue;
    end;

    if op <> 'disable' then begin slLog.Add('FAIL   unknown op         ' + tag); Inc(cFail); Continue; end;
    TargetFile := FileByName(tgtName);
    if not Assigned(TargetFile) then begin slLog.Add('FAIL   target not loaded  ' + tag + ' -> ' + tgtName); Inc(cFail); Continue; end;
    win := WinningOverride(rec);
    if (GetElementNativeValues(win, 'Record Header\Record Flags') and FLAG_DISABLED) <> 0 then begin
      slLog.Add('SKIP   already disabled   ' + tag + ' in ' + GetFileName(GetFile(win))); Inc(cSkip); Continue;
    end;
    if GetLoadOrder(GetFile(win)) > GetLoadOrder(TargetFile) then begin
      slLog.Add('FAIL   winner loads after ' + tgtName + ': ' + tag + ' in ' + GetFileName(GetFile(win))); Inc(cFail); Continue;
    end;
    // the target's own record of this ref, if it has one: the master itself (a ref the target owns) or its override there
    m := MasterOrSelf(rec);
    own := nil;
    if SameText(GetFileName(GetFile(m)), tgtName) then own := m;
    for j := 0 to Pred(OverrideCount(m)) do
      if SameText(GetFileName(GetFile(OverrideByIndex(m, j))), tgtName) then own := OverrideByIndex(m, j);
    if Assigned(own) and (not SameText(GetFileName(GetFile(win)), tgtName)) then begin
      slLog.Add('FAIL   target overrides it but does not win: ' + tag + ' winner ' + GetFileName(GetFile(win))); Inc(cFail); Continue;
    end;
    if DRY_RUN then begin
      if Assigned(own) then begin slLog.Add('WOULD  OWN   ' + tag + ' -> ' + tgtName + ' (its own record)'); Inc(cOwn); end
      else begin slLog.Add('WOULD  COPY  ' + tag + ' -> ' + tgtName + ' (winner ' + GetFileName(GetFile(win)) + ')'); Inc(cCopy); end;
      Inc(cDone); Continue;
    end;
    if Assigned(own) then begin
      ovr := own; Inc(cOwn);                 // never rebuilt: only the flag and the XESP change below
    end
    else begin
      AddRequiredElementMasters(win, TargetFile, False);
      ovr := wbCopyElementToFile(win, TargetFile, False, True);
      Inc(cCopy);
    end;
    if not Assigned(ovr) then begin slLog.Add('FAIL   override not made  ' + tag); Inc(cFail); Continue; end;

    if (op = 'disable') or (op = 'sink') then begin
      flags := GetElementNativeValues(ovr, 'Record Header\Record Flags');
      SetElementNativeValues(ovr, 'Record Header\Record Flags', flags or FLAG_DISABLED);
      if Assigned(ElementByPath(ovr, 'XESP')) then RemoveElement(ovr, 'XESP');
      if op = 'sink' then SetElementNativeValues(ovr, 'DATA\Position\Z', SINK_Z);
    end
    else if (op = 'unlock') or (op = 'unseal') then begin
      if Assigned(ElementByPath(ovr, 'XLOC')) then RemoveElement(ovr, 'XLOC');
      if (op = 'unseal') and Assigned(ElementByPath(ovr, 'VMAD')) then RemoveElement(ovr, 'VMAD');
    end
    else begin
      slLog.Add('FAIL   unknown op         ' + tag); Inc(cFail); Continue;
    end;

    // read back
    flags := GetElementNativeValues(ovr, 'Record Header\Record Flags');
    ok := True;
    if (op = 'disable') or (op = 'sink') then
      ok := ((flags and FLAG_DISABLED) <> 0) and (not Assigned(ElementByPath(ovr, 'XESP')));
    if ok and (op = 'sink') then
      ok := GetElementNativeValues(ovr, 'DATA\Position\Z') <= -29999.0;
    if ok and ((op = 'unlock') or (op = 'unseal')) then
      ok := not Assigned(ElementByPath(ovr, 'XLOC'));
    if ok and (op = 'unseal') then
      ok := not Assigned(ElementByPath(ovr, 'VMAD'));
    if not ok then begin slLog.Add('FAIL   readback           ' + tag); Inc(cFail); Continue; end;

    slLog.Add('DONE   ' + IntToHex(GetLoadOrderFormID(ovr), 8) + '  ' + tag);
    Inc(cDone);
  end;
end;

function Process(e: IInterface): integer;
begin
  Result := 0;
end;

function Finalize: integer;
begin
  Result := 0;
  slLog.Add('');
  slLog.Add('SUMMARY done=' + IntToStr(cDone) + ' own=' + IntToStr(cOwn) + ' copied=' + IntToStr(cCopy) + ' skipped=' + IntToStr(cSkip) + ' failed=' + IntToStr(cFail));
  if DRY_RUN then slLog.Add('DRY RUN: nothing was changed; set DRY_RUN = False for the real run');
  slLog.SaveToFile(ScriptsPath + RESULT_FILE);
  slLog.Free;
  slList.Free;
  slParts.Free;
end;

end.
