# HomeSense 全部启动脚本（前后端同时运行）
$ErrorActionPreference = "Stop"

Write-Host "正在启动 HomeSense 前端和后端..." -ForegroundColor Cyan

$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot "agent"
$frontendPath = Join-Path $projectRoot "homesense-frontend"

# 启动后端
$backendJob = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    npm run dev
} -ArgumentList $backendPath

# 启动前端
$frontendJob = Start-Job -ScriptBlock {
    param($path)
    Set-Location $path
    npm run dev
} -ArgumentList $frontendPath

Write-Host "后端启动中: http://localhost:3000" -ForegroundColor Green
Write-Host "前端启动中: http://localhost:9527" -ForegroundColor Green

# 等待jobs完成（保持运行）
Wait-Job $backendJob, $frontendJob | Out-Null
