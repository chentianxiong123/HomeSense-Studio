param(
  [switch]$Restart = $true,
  [switch]$ServerOnly = $false,
  [switch]$WebOnly = $false
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$ServerDir = Join-Path $Root 'apps/server'
$WebDir = Join-Path $Root 'apps/web'
$LogDir = Join-Path $Root 'data/logs'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Stop-PortProcess {
  param(
    [int]$Port,
    [string]$Name
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $processId = [int]$connection.OwningProcess
    if ($processId -le 0 -or $processId -eq $PID) { continue }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    $commandLine = [string]$process.CommandLine
    if ($commandLine -notmatch [regex]::Escape([string]$Root)) {
      Write-Host "Skip $Name port $Port process $processId because it is outside this workspace."
      continue
    }

    Write-Host "Stop $Name on port $Port (PID $processId)."
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-WorkspaceServerProcess {
  $processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    $commandLine = [string]$process.CommandLine
    if ($commandLine -notmatch [regex]::Escape([string]$Root)) { continue }
    if ($commandLine -notmatch 'apps[\\/]server|dist[\\/]main|nest\.js') { continue }
    if ([int]$process.ProcessId -eq $PID) { continue }
    Write-Host "Stop HomeSense server process (PID $($process.ProcessId))."
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
  }
}

function Start-DevProcess {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command,
    [string]$LogFile
  )

  $fullLog = Join-Path $LogDir $LogFile
  $cmd = "/c $Command > `"$fullLog`" 2>&1"
  Write-Host "Start $Name from $WorkingDirectory"
  Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList $cmd -WorkingDirectory $WorkingDirectory
}

if ($Restart) {
  if (-not $WebOnly) {
    Stop-PortProcess -Port 3100 -Name 'server'
    Stop-WorkspaceServerProcess
  }
  if (-not $ServerOnly) { Stop-PortProcess -Port 5173 -Name 'web' }
}

if (-not $WebOnly) {
  Start-DevProcess -Name 'HomeSense server' -WorkingDirectory $ServerDir -Command 'npm run build && node --enable-source-maps dist/main' -LogFile 'server-dev.log'
}

if (-not $ServerOnly) {
  Start-DevProcess -Name 'HomeSense web' -WorkingDirectory $WebDir -Command 'npm run dev' -LogFile 'web-dev.log'
}

Write-Host ''
Write-Host 'HomeSense dev startup requested.'
Write-Host 'Server: http://localhost:3100'
Write-Host 'Web:    http://localhost:5173'
Write-Host "Logs:   $LogDir"
