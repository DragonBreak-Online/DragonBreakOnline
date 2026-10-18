@echo off
rem Backs up the local git state BEFORE a push, so a bad push, a rewrite or a damaged repo can be undone.
rem Two layers per repo: a branch at the current head (instant, in-repo) and a bundle of every ref
rem (offline, outside the repo, restorable with "git clone <bundle>" even if the repo is lost).
rem Run with no arguments before every push. Keeps the 10 newest bundles per repo.
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "OUT=_git-backups"
rem How many backup/pre-push-* branches to keep per repo, matching the 10 newest bundles below
set "KEEP_BRANCHES=10"
if not exist "%OUT%" mkdir "%OUT%"

for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMdd-HHmmss')"`) do set "STAMP=%%s"
if not defined STAMP set "STAMP=unstamped"

rem fork is the pushed repo; server is local only and has no remote at all, so it matters more
call :backup fork fork
call :backup server server

echo.
echo Backups in %CD%\%OUT%:
dir /b /o-d "%OUT%\*.bundle" 2>nul
echo.
echo Restore a whole repo:   git clone %OUT%\^<name^>-^<stamp^>.bundle restored
echo Undo a push:            git reset --hard backup/pre-push-^<stamp^>   ^(inside that repo^)
goto :eof

:backup
rem %1 = folder, %2 = label
if not exist "%~1\.git" (
  echo [%~2] no git repo at %~1, skipped
  goto :eof
)
git -C "%~1" branch "backup/pre-push-%STAMP%" >nul 2>&1
if errorlevel 1 (
  echo [%~2] WARNING: could not create backup/pre-push-%STAMP% ^(detached head or duplicate^)
) else (
  echo [%~2] branch backup/pre-push-%STAMP% at current head
)
git -C "%~1" bundle create "%CD%\%OUT%\%~2-%STAMP%.bundle" --all >nul 2>&1
if errorlevel 1 (
  echo [%~2] ERROR: bundle failed, DO NOT PUSH until this is understood
) else (
  for %%f in ("%OUT%\%~2-%STAMP%.bundle") do echo [%~2] bundle %%~nxf, %%~zf bytes
)
rem A bundle holds committed history only, and the live gameplay files are often uncommitted:
rem also save the working-tree diff and the status, so uncommitted work is recoverable too
git -C "%~1" diff HEAD > "%OUT%\%~2-%STAMP%.patch" 2>nul
git -C "%~1" status --porcelain > "%OUT%\%~2-%STAMP%.status.txt" 2>nul
for %%f in ("%OUT%\%~2-%STAMP%.patch") do echo [%~2] working-tree patch %%~zf bytes ^(apply with: git apply^)

rem Keep the 10 newest sets for this repo
powershell -NoProfile -Command "foreach ($p in '*.bundle','*.patch','*.status.txt') { Get-ChildItem (Join-Path '%OUT%' ('%~2-' + $p)) -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item -Force -ErrorAction SilentlyContinue }"

rem Prune old backup branches. The bundles keep the 10 newest sets, but the branches used to accumulate for
rem ever: 129 of them in each repo by 17 Oct 2026, which made "git branch" useless for reading and buried the
rem few refs that matter among a month of labels.
rem
rem It does NOT shrink the bundles, which was the first guess and is wrong: a bundle holds reachable OBJECTS,
rem and a label on a commit already in history contributes none. Pruning 113 refs here moved the server bundle
rem from 86.2 to 87.6 MB (it grew, with the run's own new commits). The bundles grow because the history does.
rem
rem A branch is deleted ONLY when its tip is already reachable from HEAD or from the upstream, so the commit
rem survives the ref and nothing is lost: deleting the label of a state that is still in history costs nothing.
rem A tip that is reachable from NEITHER is the only thing holding that state (it was reset or rewritten away),
rem so it is kept however old it is, and the run says how many were kept for that reason.
powershell -NoProfile -Command "$ErrorActionPreference = 'SilentlyContinue'; $k = [int]'%KEEP_BRANCHES%'; $r = '%~1'; $all = @(git -C $r branch --list 'backup/pre-push-*' | ForEach-Object { $_.Trim().TrimStart('*').Trim() } | Where-Object { $_ } | Sort-Object -Descending); $old = @($all | Select-Object -Skip $k); if ($old.Count -eq 0) { Write-Output ('[%~2] ' + $all.Count + ' backup branch(es), none to prune'); exit 0 }; $up = (git -C $r rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'); $del = 0; $held = 0; foreach ($b in $old) { git -C $r merge-base --is-ancestor $b HEAD; $safe = ($LASTEXITCODE -eq 0); if (-not $safe -and $up) { git -C $r merge-base --is-ancestor $b $up; $safe = ($LASTEXITCODE -eq 0) }; if ($safe) { git -C $r branch -D $b | Out-Null; $del++ } else { $held++ } }; Write-Output ('[%~2] pruned ' + $del + ' old backup branch(es), kept ' + ($all.Count - $del) + ' (' + $k + ' newest' + $(if ($held) { ' + ' + $held + ' whose commits are reachable from nothing else' } else { '' }) + ')')"
goto :eof
