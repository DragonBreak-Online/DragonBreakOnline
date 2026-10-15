{
  DBO - Skyrim opens: disable only the troublesome plugin-placed living actors (Nate, 15 Oct; check 3, narrowed). The same
  technique as the Bruma pass (DBO_BrumaInteriors.pas, DBO_DisableBrumaActors.pas): Initially Disabled, Enable Parent
  removed so the flag sticks.

  List: DBO_SkyrimActorsList.txt, one per line
    disable|owningplugin|localObjectID|expectedBaseEditorID|targetPlugin|reason
  Made on CT 115 by tools/skyrim_actor_narrow.py from the Skyrim release package's 140-plugin order. Of every winning living
  ACHR in the open lands (not deleted, not Initially Disabled, not Starts Dead, not sunk, outside the hub and the closed
  lands) only these are listed:
    near     a hostile actor or creature within 4000 units of a hold-gate landing spot or of the creator landing / Pale Pass
             arrival (guards, townsfolk, merchants, children and friendly NPCs at the gates stay: Nate, 15 Oct);
    town     a hostile actor or creature in a city or town (city worldspace, or a cell whose location is LocTypeCity/Town);
    hostile  an actor whose factions or AI make it attack players (bandits, Forsworn, vampires, necromancers, hostile animals...).
  Guards, townsfolk, merchants, children and friendly NPCs stay enabled, and so do the Ysgramor's Tomb ghosts, Vaermina's
  devotees in Nightcaller Temple and giants (Nate, 15 Oct). The reason is logged with each line.
  targetPlugin: DragonBreak Online Edits.esp for vanilla/DLC/DragonBreak refs, DragonBreak Nexus Patches.esp for a
  Nexus mod's own refs (third-party edits never go in the DLE or the mod) or a ref whose winner is already Nexus Patches.
  The expected base EditorID is checked first; "*" skips the check. Idempotent.
  Result: Edit Scripts\DBO_SkyrimActors_result.txt
  DRY RUN FIRST: DRY_RUN is True; run, read the result, then set it to False.
  Check afterwards on CT 115: tools/skyrim_actor_check.py.
}
unit DBOSkyrimActors;

const
  LIST_FILE     = 'DBO_SkyrimActorsList.txt';
  RESULT_FILE   = 'DBO_SkyrimActors_result.txt';
  DRY_RUN       = True;
  SINK_Z        = -30000.0;
  FLAG_DISABLED = $800;

var
  slLog, slList, slParts: TStringList;
  TargetFile: IwbFile;
  tgtName: string;
  cDone, cSkip, cFail: integer;

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
  i, flags: integer;
  op, plug, hex, want, got, tag, why: string;
  f: IwbFile;
  rec, win, ovr, base: IwbMainRecord;
  fid: cardinal;
  ok: boolean;
begin
  Result := 0;
  slLog := TStringList.Create;
  slList := TStringList.Create;
  slParts := TStringList.Create;
  slParts.Delimiter := '|';
  slParts.StrictDelimiter := True;
  cDone := 0; cSkip := 0; cFail := 0;


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

    base := LinksTo(ElementByPath(rec, 'NAME'));
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
    if DRY_RUN then begin slLog.Add('WOULD  ' + tag + ' -> ' + tgtName + ' (winner ' + GetFileName(GetFile(win)) + ')'); Inc(cDone); Continue; end;
    if SameText(GetFileName(GetFile(win)), tgtName) then
      ovr := win
    else begin
      AddRequiredElementMasters(win, TargetFile, False);
      ovr := wbCopyElementToFile(win, TargetFile, False, True);
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
  slLog.Add('SUMMARY done=' + IntToStr(cDone) + ' skipped=' + IntToStr(cSkip) + ' failed=' + IntToStr(cFail));
  slLog.SaveToFile(ScriptsPath + RESULT_FILE);
  slLog.Free;
  slList.Free;
  slParts.Free;
end;

end.
