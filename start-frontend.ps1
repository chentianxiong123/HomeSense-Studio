# HomeSense 前端启动脚本
$ErrorActionPreference = "Stop"

Write-Host "正在启动 HomeSense 前端..." -ForegroundColor Cyan

$frontendPath = Join-Path $PSScriptRoot "homesense-frontend"

if (Test-Path $frontendPath) {
    Set-Location $frontendPath
    npm run dev
} else {
    Write-Host "错误: 找不到 homesense-frontend 目录" -ForegroundColor Red
    exit 1
}
