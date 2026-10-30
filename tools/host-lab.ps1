# Run from a normal PowerShell terminal; does not change firewall or install software.
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$Port = 8080,
  [ValidateRange(2, 40)][int]$Players = 40,
  [string]$DataDirectory,
  [ValidateSet('mongodb', 'sqlite')][string]$DatabaseBackend = 'mongodb',
  [switch]$Build
)
$ErrorActionPreference = 'Stop'
$taskRepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $DataDirectory) { $DataDirectory = Join-Path $taskRepoRoot 'apps/server/data' }
$taskDataPath = [IO.Path]::GetFullPath($DataDirectory)
$taskNodeVersion = (& node --version).TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [version]$taskNodeVersion -lt [version]'22.19.0') { throw 'Node 22.19.0 or newer is required.' }
Push-Location $taskRepoRoot
try {
  if ($Build) { & npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed; server not started.' } }
  foreach ($taskRequiredFile in 'apps/server/dist/main.js', 'apps/client/dist/index.html', 'maps/art-world.json') {
    if (-not (Test-Path -LiteralPath (Join-Path $taskRepoRoot $taskRequiredFile))) { throw "Missing $taskRequiredFile. Run npm ci and npm run build first." }
  }
  if ($DatabaseBackend -eq 'sqlite' -and -not $env:HEIST_ADMIN_TOKEN) {
    $taskOrganizerSecret = Read-Host 'Choose/enter your private organizer token (retain it for admin.html)' -AsSecureString
    $env:HEIST_ADMIN_TOKEN = [System.Net.NetworkCredential]::new('', $taskOrganizerSecret).Password
  }
  if ($DatabaseBackend -eq 'sqlite' -and $env:HEIST_ADMIN_TOKEN.Length -lt 24) { throw 'Use an organizer token of at least 24 characters.' }
  if ($DatabaseBackend -eq 'mongodb' -and $DataDirectory -and $PSBoundParameters.ContainsKey('DataDirectory')) {
    throw 'MongoDB does not use DataDirectory. For a separate rehearsal use an explicitly separate MONGODB_DATABASE, or -DatabaseBackend sqlite.'
  }
  if ($DatabaseBackend -eq 'mongodb' -and -not (Test-Path -LiteralPath (Join-Path $taskRepoRoot '.env')) -and -not $env:MONGODB_URI) { throw 'Configure the private root .env with MONGODB_URI and MONGODB_DATABASE first.' }
  $env:DATABASE_BACKEND = $DatabaseBackend
  $env:NODE_ENV = 'production'
  $env:DEBUG_ENDPOINTS = 'false'
  $env:ALLOW_REGISTER = 'true'
  $env:PORT = [string]$Port
  $env:MAX_PLAYERS = [string]$Players
  $env:DB_URL = 'sqlite:' + (Join-Path $taskDataPath 'heist.db')
  $env:EVENT_DB_PATH = Join-Path $taskDataPath 'heist.db.event.db'
  $env:MAP_PATH = Join-Path $taskRepoRoot 'maps/art-world.json'
  $env:CLIENT_BUILD_PATH = Join-Path $taskRepoRoot 'apps/client/dist'
  $env:EVENT_DURATION_MINUTES = '180'
  $env:LOG_LEVEL = 'info'
  $env:TICK_RATE = '20'
  $env:STEP_TICKS = '5'
  $env:CHUNK_SIZE = '16'
  $env:MAX_PENDING_MOVES = '2'
  $env:MSG_RATE_PER_SEC = '60'
  $env:MSG_BURST = '100'
  $env:HEARTBEAT_TIMEOUT_MS = '15000'
  $env:GHOST_GRACE_MS = '30000'
  $env:SNAPSHOT_INTERVAL_MS = '10000'
  $env:BACKPRESSURE_BYTES = '256000'
  $env:UV_THREADPOOL_SIZE = '4'
  Write-Host "Host: http://localhost:$Port/ ; players use http://HOST-LAN-IP:$Port/"
  if ($DatabaseBackend -eq 'mongodb') { Write-Host 'Persistent data: MongoDB configured in private .env. Sign in with a super-admin account for controls.' }
  else { Write-Host "Persistent data: $taskDataPath (existing accounts/event are preserved)" }
  Write-Host 'This does not start/reset the prize event. Keep this terminal open; Ctrl+C stops the server.'
  # No watcher/Vite/bots in production. Heap cap is not a total process-RAM cap.
  & node --max-old-space-size=1024 (Join-Path $taskRepoRoot 'apps/server/dist/main.js')
  if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE" }
} finally { Pop-Location }
