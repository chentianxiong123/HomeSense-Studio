# HomeSense 后端启动脚本
$ErrorActionPreference = "Stop"

Write-Host "正在启动 HomeSense 后端..." -ForegroundColor Cyan

$backendPath = Join-Path $PSScriptRoot "agent"

if (Test-Path $backendPath) {
    Set-Location $backendPath
    npm run dev
} else {
    Write-Host "错误: 找不到 agent 目录" -ForegroundColor Red
    exit 1
}
