$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$StartupScript = Join-Path $Root 'scripts/start-homesense-dev.ps1'
$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop '启动 HomeSense Studio v2.lnk'

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = 'powershell.exe'
$Shortcut.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$StartupScript`""
$Shortcut.WorkingDirectory = [string]$Root
$Shortcut.IconLocation = 'powershell.exe,0'
$Shortcut.Description = 'Start HomeSense Studio v2 server and web dev services.'
$Shortcut.Save()

Write-Host "Shortcut created: $ShortcutPath"
