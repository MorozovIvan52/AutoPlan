# Fix Cursor Agent: ERROR_EXTENSION_HOST_TIMEOUT / waitForProviderRegistration
# Run from OUTSIDE Cursor (Windows PowerShell as user). Closes Cursor, clears stale state.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\1\Desktop\автоплан\scripts\fix-cursor-agent.ps1"

$ErrorActionPreference = "Continue"
Write-Host "=== Cursor Agent Repair ===" -ForegroundColor Cyan

# 1) Kill ALL Cursor processes (orphaned extension hosts cause the timeout)
Write-Host "`n[1/5] Closing Cursor processes..."
Get-Process -Name "Cursor","cursor" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "  kill PID $($_.Id) ($($_.ProcessName))"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$left = Get-Process -Name "Cursor","cursor" -ErrorAction SilentlyContinue
if ($left) {
  Write-Host "  force-kill remaining..." -ForegroundColor Yellow
  $left | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# 2) Clear caches that break agent-exec after upgrades
Write-Host "`n[2/5] Clearing Cursor caches..."
$toClear = @(
  "$env:APPDATA\Cursor\CachedData",
  "$env:APPDATA\Cursor\CachedExtensions",
  "$env:APPDATA\Cursor\CachedExtensionVSIXs",
  "$env:APPDATA\Cursor\Code Cache",
  "$env:APPDATA\Cursor\GPUCache",
  "$env:APPDATA\Cursor\logs"
)
foreach ($p in $toClear) {
  if (Test-Path $p) {
    Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  removed $p"
  } else {
    Write-Host "  skip (missing) $p"
  }
}

# 3) Soft-reset workspace storage (keeps login; resets broken window state)
Write-Host "`n[3/5] Resetting workspaceStorage (backup kept)..."
$ws = "$env:APPDATA\Cursor\User\workspaceStorage"
$bak = "$env:APPDATA\Cursor\User\workspaceStorage.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path $ws) {
  Rename-Item -LiteralPath $ws -NewName (Split-Path $bak -Leaf) -ErrorAction SilentlyContinue
  if (-not (Test-Path $ws)) {
    Write-Host "  renamed -> $bak"
  } else {
    Write-Host "  could not rename (file lock?) — continue" -ForegroundColor Yellow
  }
}

# 4) Patch settings for agent stability
Write-Host "`n[4/5] Patching Cursor User settings..."
$settingsPath = "$env:APPDATA\Cursor\User\settings.json"
if (Test-Path $settingsPath) {
  try {
    $raw = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8
    $json = $raw | ConvertFrom-Json
    $json | Add-Member -NotePropertyName "cursor.terminal.usePreviewBox" -NotePropertyValue $false -Force
    $json | Add-Member -NotePropertyName "cursor.general.disableHttp2" -NotePropertyValue $true -Force
    $json | Add-Member -NotePropertyName "extensions.autoUpdate" -NotePropertyValue $false -Force
    $json | Add-Member -NotePropertyName "extensions.autoCheckUpdates" -NotePropertyValue $false -Force
    ($json | ConvertTo-Json -Depth 30) | Set-Content -LiteralPath $settingsPath -Encoding UTF8
    Write-Host "  usePreviewBox=false, disableHttp2=true"
  } catch {
    Write-Host "  settings patch failed: $_" -ForegroundColor Yellow
  }
}

# 5) Verify agent-exec bundle on disk
Write-Host "`n[5/5] Checking cursor-agent-exec install..."
$main = "$env:LOCALAPPDATA\Programs\cursor\resources\app\extensions\cursor-agent-exec\dist\main.js"
if (Test-Path $main) {
  $len = (Get-Item $main).Length
  Write-Host "  OK main.js size=$len" -ForegroundColor Green
  if ($len -lt 10000) {
    Write-Host "  WARNING: main.js too small — reinstall Cursor from https://cursor.com/download" -ForegroundColor Red
  }
} else {
  Write-Host "  BROKEN: main.js missing — reinstall Cursor from https://cursor.com/download" -ForegroundColor Red
}

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host @"

NEXT STEPS (обязательно):
1. Открой ОДНО окно Cursor (не 5 штук).
2. File → Open Folder → только папка «автоплан».
3. Новый Agent chat → напиши «пинг».
4. Если снова Timed Out → Help → About, скачай свежий Cursor и переустанови поверх.
   Причина в логах: No bundle location found for anysphere.cursor-agent-exec
   + зависание waitForProviderRegistration (~70с).

"@
