{
  DBO - Sentinel's gilded female Steel Plate cuirass shows the plain texture (Frigga Hux, 9 Oct): the ARMA's alternate
  textures (MO3S world, MO5S first person) name a shape, "CuirassF:0", that the CBBE SFW replacement of
  armor\nordplate\nordcuirassf_0/1.nif and 1stpersonnordcuirassf_0/1.nif (Nexus 74257) does not have, so the swap finds
  nothing. For every winning ARMA on those female meshes whose swap names a shape the meshes in Data lack, this writes an
  override into DragonBreak Nexus Patches.esp with the shape name the meshes do have. Sentinel.esp is never touched.
  A swap is changed only when exactly one armour shape of the mesh can take it (not a body shape); anything else is
  reported and left alone. Every mesh's shape names, every ARMA seen and every change go to the result file.
  Load the server order from the Data that holds the CBBE SFW meshes (the Steam install, or the dev copy once synced).
  Result: Edit Scripts\DBO_GildedCuirassF_result.txt
  Run: SSEEdit.exe -D:"<Data>" -P:"<server\plugins.server.txt>" -autoload -script:DBO_GildedCuirassF.pas -autoexit
  After: diff DragonBreak Nexus Patches.esp record by record against the old one (only the reported ARMA may differ),
  then deploy-plugins.
}
unit DBOGildedCuirassF;

const
  PATCH_NAME  = 'DragonBreak Nexus Patches.esp';
  RESULT_FILE = 'DBO_GildedCuirassF_result.txt';

var
  slLog, slWorld, slFirst: TStringList;
  Patch: IwbFile;
  Changed, Skipped, Errors: integer;

function FileByName(aName: string): IwbFile;
var i: integer;
begin
  Result := nil;
  for i := 0 to Pred(FileCount) do
    if SameText(GetFileName(FileByIndex(i)), aName) then begin
      Result := FileByIndex(i); Exit;
    end;
end;

// The first element below e (e included) with this signature
function FindSig(e: IInterface; sig: string): IInterface;
var i: integer;
begin
  Result := nil;
  if not Assigned(e) then Exit;
  if Signature(e) = sig then begin Result := e; Exit; end;
  for i := 0 to Pred(ElementCount(e)) do begin
    Result := FindSig(ElementByIndex(e, i), sig);
    if Assigned(Result) then Exit;
  end;
end;

function IsBodyShape(s: string): boolean;
var l: string;
begin
  l := LowerCase(s);
  Result := (Pos('body', l) > 0) or (Pos('baseshape', l) > 0) or (Pos('3ba', l) > 0) or (Pos('cbbe', l) > 0)
    or (Pos('skin', l) > 0) or (Pos('hands', l) > 0) or (Pos('feet', l) > 0);
end;

// Shape names of a loose mesh in Data; False when it cannot be read (not loose, or not a NIF)
function ReadShapes(rel: string; sl: TStringList): boolean;
var nif: TwbNifFile; blk: TwbNifBlock; j: integer; full: string;
begin
  Result := False;
  full := DataPath + 'meshes\' + rel;
  if not FileExists(full) then begin slLog.Add('MESH NOT LOOSE ' + full); Exit; end;
  nif := TwbNifFile.Create;
  try
    try nif.LoadFromFile(full); except slLog.Add('MESH UNREADABLE ' + full); Exit; end;
    for j := 0 to Pred(nif.BlocksCount) do begin
      blk := nif.Blocks[j];
      if blk.IsNiObject('BSTriShape', True) or blk.IsNiObject('NiTriShape', True) or blk.IsNiObject('BSDynamicTriShape', True)
        or blk.IsNiObject('BSSubIndexTriShape', True) then
        sl.Add(blk.EditValues['Name']);
    end;
    Result := sl.Count > 0;
  finally
    nif.Free;
  end;
end;

// Shapes in both weights of a female mesh (the engine loads _0 and _1); the list is the names they share
function MeshShapes(base: string; sl: TStringList): boolean;
var a, b: TStringList; i: integer;
begin
  Result := False;
  a := TStringList.Create; b := TStringList.Create;
  try
    if not ReadShapes(base + '_0.nif', a) then Exit;
    if not ReadShapes(base + '_1.nif', b) then Exit;
    slLog.Add('MESH ' + base + '_0.nif shapes: ' + a.CommaText);
    slLog.Add('MESH ' + base + '_1.nif shapes: ' + b.CommaText);
    for i := 0 to Pred(a.Count) do
      if b.IndexOf(a[i]) >= 0 then sl.Add(a[i]);
    Result := sl.Count > 0;
  finally
    a.Free; b.Free;
  end;
end;

// The one armour shape of the mesh a swap can go to, or '' when it is not exactly one
function Target(shapes: TStringList): string;
var i, n: integer; cuirass, armour: string;
begin
  Result := ''; cuirass := ''; armour := ''; n := 0;
  for i := 0 to Pred(shapes.Count) do begin
    if IsBodyShape(shapes[i]) then Continue;
    Inc(n); armour := shapes[i];
    if Pos('cuirass', LowerCase(shapes[i])) > 0 then begin
      if cuirass <> '' then Exit;
      cuirass := shapes[i];
    end;
  end;
  if cuirass <> '' then Result := cuirass
  else if n = 1 then Result := armour;
end;

function MeshKey(path: string): string;
var l: string;
begin
  l := LowerCase(StringReplace(path, '/', '\', [rfReplaceAll]));
  if Copy(l, 1, 7) = 'meshes\' then l := Copy(l, 8, Length(l));
  Result := l;
end;

// Whether this swap list names a shape the mesh lacks
function NeedsFix(alts: IInterface; shapes: TStringList): boolean;
var i: integer; alt: IInterface;
begin
  Result := False;
  for i := 0 to Pred(ElementCount(alts)) do begin
    alt := ElementByIndex(alts, i);
    if Assigned(ElementByName(alt, '3D Name')) and (shapes.IndexOf(GetElementEditValues(alt, '3D Name')) < 0) then Result := True;
  end;
end;

// Whether every swap of the list can be pointed at the mesh's one armour shape
function CanFix(alts: IInterface; shapes: TStringList): boolean;
var i: integer;
begin
  Result := Target(shapes) <> '';
  for i := 0 to Pred(ElementCount(alts)) do
    if not Assigned(ElementByName(ElementByIndex(alts, i), '3D Name')) then Result := False;
end;

function YesNo(b: boolean): string;
begin
  if b then Result := 'yes' else Result := 'no';
end;

procedure FixSwaps(rec: IInterface; sig, what: string; shapes: TStringList);
var alts, alt: IInterface; i: integer; nm, tgt: string;
begin
  alts := FindSig(rec, sig);
  tgt := Target(shapes);
  for i := 0 to Pred(ElementCount(alts)) do begin
    alt := ElementByIndex(alts, i);
    nm := GetElementEditValues(alt, '3D Name');
    if shapes.IndexOf(nm) >= 0 then Continue;
    SetElementEditValues(alt, '3D Name', tgt);
    if GetElementEditValues(alt, '3D Name') <> tgt then begin
      slLog.Add('ERROR|' + Name(rec) + ' ' + what + ': could not set "' + nm + '" to "' + tgt + '"'); Inc(Errors);
    end else
      slLog.Add('CHANGED ' + Name(rec) + ' ' + what + ' "' + nm + '" -> "' + tgt + '"');
  end;
end;

function Initialize: integer;
var f, i, j: integer; g, rec, win, ov, alts: IInterface; m3, m5: string;
  w3, w5, fix3, fix5, ok3, ok5: boolean;
begin
  Result := 0; Changed := 0; Skipped := 0; Errors := 0;
  slLog := TStringList.Create; slWorld := TStringList.Create; slFirst := TStringList.Create;
  slWorld.CaseSensitive := True; slFirst.CaseSensitive := True;
  slLog.Add('DBO_GildedCuirassF, Data ' + DataPath);
  Patch := FileByName(PATCH_NAME);
  if not Assigned(Patch) then begin slLog.Add('ERROR|' + PATCH_NAME + ' is not loaded'); Inc(Errors); end;
  if not MeshShapes('armor\nordplate\nordcuirassf', slWorld) then begin slLog.Add('ERROR|no shared shapes in the female world mesh'); Inc(Errors); end;
  if not MeshShapes('armor\nordplate\1stpersonnordcuirassf', slFirst) then begin slLog.Add('ERROR|no shared shapes in the female first-person mesh'); Inc(Errors); end;
  slLog.Add('TARGET world "' + Target(slWorld) + '", first person "' + Target(slFirst) + '"');
  if Errors = 0 then
    for f := 0 to Pred(FileCount) do begin
      g := GroupBySignature(FileByIndex(f), 'ARMA');
      if not Assigned(g) then Continue;
      for j := 0 to Pred(ElementCount(g)) do begin
        rec := ElementByIndex(g, j);
        if not IsMaster(rec) then Continue;
        win := WinningOverride(rec);
        m3 := MeshKey(GetEditValue(FindSig(win, 'MOD3')));
        m5 := MeshKey(GetEditValue(FindSig(win, 'MOD5')));
        w3 := (m3 = 'armor\nordplate\nordcuirassf_1.nif') or (m3 = 'armor\nordplate\nordcuirassf_0.nif');
        w5 := (m5 = 'armor\nordplate\1stpersonnordcuirassf_1.nif') or (m5 = 'armor\nordplate\1stpersonnordcuirassf_0.nif');
        fix3 := False; fix5 := False; ok3 := True; ok5 := True;
        alts := FindSig(win, 'MO3S');
        if w3 and Assigned(alts) then begin fix3 := NeedsFix(alts, slWorld); ok3 := CanFix(alts, slWorld); end;
        alts := FindSig(win, 'MO5S');
        if w5 and Assigned(alts) then begin fix5 := NeedsFix(alts, slFirst); ok5 := CanFix(alts, slFirst); end;
        if not (w3 or w5) then Continue;
        slLog.Add('ARMA ' + Name(win) + ' winner ' + GetFileName(GetFile(win)) + ' world swap off ' + YesNo(fix3) + ', first person swap off ' + YesNo(fix5));
        if not (fix3 or fix5) then Continue;
        if (fix3 and not ok3) or (fix5 and not ok5) then begin
          slLog.Add('SKIPPED ' + Name(win) + ': no single armour shape to point the swap at');
          Inc(Skipped); Continue;
        end;
        if GetFileName(GetFile(win)) = PATCH_NAME then ov := win
        else begin
          AddRequiredElementMasters(win, Patch, False);
          ov := wbCopyElementToFile(win, Patch, False, True);
        end;
        if not Assigned(ov) then begin slLog.Add('ERROR|could not override ' + Name(win)); Inc(Errors); Continue; end;
        if fix3 then FixSwaps(ov, 'MO3S', 'world', slWorld);
        if fix5 then FixSwaps(ov, 'MO5S', 'first person', slFirst);
        Inc(Changed);
      end;
    end;
  slLog.Add(Format('DONE changed %d, skipped %d, errors %d', [Changed, Skipped, Errors]));
  slLog.SaveToFile(ScriptsPath + RESULT_FILE);
end;

function Finalize: integer;
begin
  Result := 0;
  slLog.Free; slWorld.Free; slFirst.Free;
end;

end.
