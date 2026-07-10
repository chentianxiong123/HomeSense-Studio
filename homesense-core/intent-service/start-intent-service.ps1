$ErrorActionPreference = "Stop"

try {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  Set-Location $scriptDir

  $venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"

  if (Test-Path $venvPython) {
    Write-Host "Using virtual environment: $venvPython" -ForegroundColor Green
    & $venvPython main.py
  }
  else {
    Write-Host "Virtual environment not found, using system python" -ForegroundColor Yellow
    python main.py
  }
}
catch {
  Write-Host ""
  Write-Host "Intent service failed to start." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "Press Enter to close..."
  Read-Host
}
