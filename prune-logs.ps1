# Prunes _server-logs for run-logged.cmd. A rotated log whose run ended in a native crash is kept for
# ever; everything else goes after 30 days.
#
# Both September 2026 crash logs were lost to the old blanket 14-day delete before anyone could read
# them, which is why neither crash can be explained today.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File prune-logs.ps1 [-DryRun]
param(
  [string]$Root = $PSScriptRoot,
  [int]$KeepDays = 30,
  [switch]$DryRun
)

$exitLog = Join-Path $Root "server-exit.log"
$dir = Join-Path $Root "_server-logs"
if (-not (Test-Path $dir)) { return }

# A kill from outside leaves -1 and a reaped background task 1073807364; only a large negative code
# is a native crash.
$crashes = @()
if (Test-Path $exitLog) {
  foreach ($line in Get-Content $exitLog) {
    if ($line -match '^(.+?)\s+exit code\s+(-\d+)\s*$') {
      if ([int64]$matches[2] -lt -1000000 -and
          $matches[1] -match '(\d{2})/(\d{2})/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})') {
        $crashes += Get-Date -Year $matches[3] -Month $matches[1] -Day $matches[2] `
                             -Hour $matches[4] -Minute $matches[5] -Second $matches[6]
      }
    }
  }
}

# server-<stamp>.log takes its stamp from server.log's last write, which is the last line the crashed
# run managed, at or shortly before the crash itself. One known case went silent for 40 s first.
# Erring long is the safe direction: a short window prunes the log of a run that died quietly, which
# is the failure this exists to stop. Keeping an innocent log costs nothing.
$windowMinutes = 60
$cut = (Get-Date).AddDays(-$KeepDays)

foreach ($f in Get-ChildItem -Path $dir -Filter "server-*.log" -ErrorAction SilentlyContinue) {
  $stamp = $null
  if ($f.Name -match '^server-(\d{8})-(\d{6})\.log$') {
    try {
      $stamp = [datetime]::ParseExact($matches[1] + $matches[2], "yyyyMMddHHmmss", $null)
    } catch { $stamp = $null }
  }
  $isCrash = $false
  if ($stamp) {
    foreach ($c in $crashes) {
      if ($stamp -le $c -and $stamp -gt $c.AddMinutes(-$windowMinutes)) { $isCrash = $true; break }
    }
  }
  # An unparseable name is kept rather than guessed at
  if ($isCrash -or -not $stamp) { continue }
  if ($f.LastWriteTime -lt $cut) {
    if ($DryRun) { Write-Output ("would delete " + $f.Name) }
    else { Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue }
  }
}
