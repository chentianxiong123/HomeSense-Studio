$ErrorActionPreference = 'Stop'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$documentsRoot = Join-Path $HOME 'Documents'
$ps7Dir = Join-Path $documentsRoot 'PowerShell'
$ps5Dir = Join-Path $documentsRoot 'WindowsPowerShell'

$bootstrapPath = Join-Path $ps7Dir 'HomeSense.Encoding.ps1'

$profileTargets = @(
  (Join-Path $ps7Dir 'profile.ps1'),
  (Join-Path $ps7Dir 'Microsoft.PowerShell_profile.ps1'),
  (Join-Path $ps5Dir 'profile.ps1'),
  (Join-Path $ps5Dir 'Microsoft.PowerShell_profile.ps1')
)

$utf8Bom = New-Object System.Text.UTF8Encoding($true)

function Write-Utf8BomFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  [System.IO.File]::WriteAllText($Path, $Content, $utf8Bom)
}

$bootstrapContent = @'
$script:__HomeSenseEncodingBootstrapLoaded = $script:__HomeSenseEncodingBootstrapLoaded -as [bool]
if ($script:__HomeSenseEncodingBootstrapLoaded) {
  return
}
$script:__HomeSenseEncodingBootstrapLoaded = $true
$utf8 = New-Object System.Text.UTF8Encoding($false)

try {
  [Console]::InputEncoding = $utf8
} catch {
}

try {
  [Console]::OutputEncoding = $utf8
} catch {
}

$OutputEncoding = $utf8

try {
  $null = chcp 65001
} catch {
}

$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Add-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Export-Csv:Encoding'] = 'utf8'
$PSDefaultParameterValues['ConvertTo-Csv:NoTypeInformation'] = $true

$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:LESSCHARSET = 'utf-8'
'@

$profileLoaderContent = @'
$bootstrap = Join-Path $HOME 'Documents\PowerShell\HomeSense.Encoding.ps1'
if (Test-Path -LiteralPath $bootstrap) {
  . $bootstrap
}
'@

Write-Utf8BomFile -Path $bootstrapPath -Content $bootstrapContent

foreach ($profilePath in $profileTargets) {
  if (Test-Path -LiteralPath $profilePath) {
    Copy-Item -LiteralPath $profilePath -Destination "$profilePath.bak-$timestamp" -Force
  }

  Write-Utf8BomFile -Path $profilePath -Content $profileLoaderContent
}

Write-Output "Updated bootstrap: $bootstrapPath"
Write-Output 'Updated profiles:'
$profileTargets | ForEach-Object { Write-Output " - $_" }
