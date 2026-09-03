param(
  [string]$Source = "D:\files\References\workflow\n8n",
  [string]$Target = "D:\files\References\workflow\n8n-homesense-runtime",
  [switch]$ForceRecreate
)

$ErrorActionPreference = "Stop"

function Assert-InsideWorkflowReferences {
  param([string]$PathToCheck)
  $resolved = [System.IO.Path]::GetFullPath($PathToCheck)
  $expectedParent = [System.IO.Path]::GetFullPath("D:\files\References\workflow")
  if (-not $resolved.StartsWith($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside $expectedParent. Target was $resolved"
  }
  if ((Split-Path -Leaf $resolved) -ne "n8n-homesense-runtime") {
    throw "Refusing to recreate a target not named n8n-homesense-runtime. Target was $resolved"
  }
}

function Copy-Directory {
  param([string]$From, [string]$To)
  if (-not (Test-Path -LiteralPath $From)) { throw "Missing source path: $From" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $To) | Out-Null
  Copy-Item -LiteralPath $From -Destination $To -Recurse -Force
}

Assert-InsideWorkflowReferences -PathToCheck $Target

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Source n8n checkout does not exist: $Source"
}

if (Test-Path -LiteralPath $Target) {
  if (-not $ForceRecreate) { throw "Target already exists: $Target. Re-run with -ForceRecreate to replace it." }
  Remove-Item -LiteralPath $Target -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "packages") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "packages\@n8n") | Out-Null

$rootFiles = @("package.json","pnpm-lock.yaml","pnpm-workspace.yaml","tsconfig.json","turbo.json","LICENSE.md","LICENSE_EE.md","README.md")
foreach ($file in $rootFiles) {
  $from = Join-Path $Source $file
  if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination (Join-Path $Target $file) -Force }
}

$rootDirs = @("scripts","patches")
foreach ($dir in $rootDirs) {
  $from = Join-Path $Source $dir
  if (Test-Path -LiteralPath $from) { Copy-Directory -From $from -To (Join-Path $Target $dir) }
}

$topLevelPackages = @("workflow","core","cli","nodes-base")
foreach ($pkg in $topLevelPackages) {
  Copy-Directory -From (Join-Path $Source "packages\$pkg") -To (Join-Path $Target "packages\$pkg")
}

# Kept @n8n packages. LLM-related packages (nodes-langchain, ai-workflow-builder.ee, ai-utilities, agents, instance-ai, task-runner-python) are kept to avoid impacting LLM node usage.
$scopedPackages = @(
  "agents","ai-node-sdk","ai-utilities","ai-workflow-builder.ee",
  "api-types","backend-common","backend-network","client-oauth2",
  "config","constants","db","decorators","di","engine","errors",
  "expression-runtime","instance-ai","nodes-langchain","permissions",
  "syslog-client","task-runner","task-runner-python","tournament","utils"
)
foreach ($pkg in $scopedPackages) {
  $from = Join-Path $Source "packages\@n8n\$pkg"
  if (Test-Path -LiteralPath $from) { Copy-Directory -From $from -To (Join-Path $Target "packages\@n8n\$pkg") }
}

# Cut 2: drop @n8n packages that are SaaS, MCP, dev-only, or enterprise-only.
$dropScopedPackages = @(
  "backend-test-utils","benchmark","chat-hub","codemirror-lang",
  "codemirror-lang-html","codemirror-lang-sql","computer-use","create-node",
  "crdt","eslint-config","eslint-plugin-community-nodes","extension-sdk","imap",
  "json-schema-to-zod","local-gateway","mcp-apps","mcp-browser",
  "mcp-browser-extension","node-cli","scan-community-package","stylelint-config",
  "testing","typescript-config","vitest-config","workflow-sdk"
)
$scopedDir = Join-Path $Target "packages\@n8n"
foreach ($pkg in $dropScopedPackages) {
  $path = Join-Path $scopedDir $pkg
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

# Cut 2: drop CLI subdirectories tied to accounts, permissions, collaboration, AI, telemetry, enterprise, webhooks, queue, scaling.
$removeCliDirs = @(
  "audit","auth","chat","collaboration","concurrency","databases",
  "environments.ee","evaluation.ee","eventbus","mfa","metrics","oauth",
  "permissions.ee","posthog","public-api","push","scaling","security-audit",
  "sso.ee","telemetry","tool-generation","user-management","webhooks"
)
foreach ($dir in $removeCliDirs) {
  $path = Join-Path $Target "packages\cli\src\$dir"
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

# Keep only execute.ts and base-command.ts.
$commandsDir = Join-Path $Target "packages\cli\src\commands"
Get-ChildItem -LiteralPath $commandsDir -File | Where-Object {
  @("execute.ts","base-command.ts") -notcontains $_.Name
} | Remove-Item -Force

# Cut 4: drop the SaaS-flavored CLI command subdirectories (db, export, import, ldap, license, list, mfa, publish, ttwf, unpublish, update, user-management).
$removeCommandsDirs = @(
  "db","export","import","ldap","license","list","mfa","publish","ttwf","unpublish","update","user-management"
)
foreach ($dir in $removeCommandsDirs) {
  $path = Join-Path $commandsDir $dir
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

# Cut 4: drop the n8n HTTP controllers except orchestration (the only one HomeSense needs to drive the daemon).
$keepControllers = @("orchestration.controller.ts")
$controllersDir = Join-Path $Target "packages\cli\src\controllers"
Get-ChildItem -LiteralPath $controllersDir -File | Where-Object {
  $keepControllers -notcontains $_.Name
} | Remove-Item -Force

# Cut 4: drop the n8n HTTP middlewares (HomeSense has its own NestJS layer).
$middlewaresDir = Join-Path $Target "packages\cli\src\middlewares"
if (Test-Path -LiteralPath $middlewaresDir) {
  Remove-Item -LiteralPath $middlewaresDir -Recurse -Force
}

# Cut 4: drop the n8n credentials management module (HomeSense auth center owns this).
$cliCredsDir = Join-Path $Target "packages\cli\src\credentials"
if (Test-Path -LiteralPath $cliCredsDir) {
  Remove-Item -LiteralPath $cliCredsDir -Recurse -Force
}

# Cut 4: drop single-purpose dev/observability/instance modules.
$removeSmallDirs = @(
  "expression-observability",
  "deprecation",
  "license",
  "instance-settings-loader",
  "binary-data"
)
foreach ($dir in $removeSmallDirs) {
  $path = Join-Path $Target "packages\cli\src\$dir"
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

# Keep only the two generic OAuth schema files; drop all SaaS credentials.
$keptCredentials = @("OAuth1Api.credentials.ts","OAuth2Api.credentials.ts")
$credentialsDir = Join-Path $Target "packages\nodes-base\credentials"
Get-ChildItem -LiteralPath $credentialsDir -File | Where-Object {
  $keptCredentials -notcontains $_.Name
} | Remove-Item -Force

# Cut 4: drop credentials subdirectories (common helpers, icons, test).
$removeCredDirs = @("common","icons","test")
foreach ($dir in $removeCredDirs) {
  $path = Join-Path $credentialsDir $dir
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

# Cut 3: top-level test directories, test infrastructure, templates, dev-only configs/docs.
$removeTopLevel = @(
  "packages\nodes-base\test",
  "packages\cli\test",
  "packages\workflow\test",
  "packages\core\test",
  "packages\core\nodes-testing",
  "packages\cli\templates"
)
foreach ($rel in $removeTopLevel) {
  $path = Join-Path $Target $rel
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

$devOnlyFiles = @(
  "packages\nodes-base\AGENTS.md",
  "packages\nodes-base\CLAUDE.md",
  "packages\nodes-base\TESTING.MD",
  "packages\nodes-base\TESTING_PROMPT.md",
  "packages\nodes-base\TESTING_PROMPT_WORKFLOW.md",
  "packages\nodes-base\eslint.config.mjs",
  "packages\nodes-base\jest.config.js",
  "packages\nodes-base\vitest.integration.config.ts",
  "packages\nodes-base\biome.jsonc"
)
foreach ($rel in $devOnlyFiles) {
  $path = Join-Path $Target $rel
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

# Cut 3: per-node test subdirectories. Nodes themselves stay.
$nodesBaseNodes = Join-Path $Target "packages\nodes-base\nodes"
if (Test-Path -LiteralPath $nodesBaseNodes) {
  Get-ChildItem -LiteralPath $nodesBaseNodes -Directory | ForEach-Object {
    $testDir = Join-Path $_.FullName "test"
    if (Test-Path -LiteralPath $testDir) { Remove-Item -LiteralPath $testDir -Recurse -Force }
    $testFileDir = Join-Path $_.FullName "__tests__"
    if (Test-Path -LiteralPath $testFileDir) { Remove-Item -LiteralPath $testFileDir -Recurse -Force }
  }
}

# Cut 3: any leftover __tests__ subdirectory anywhere.
Get-ChildItem -LiteralPath $Target -Directory -Recurse -Filter "__tests__" -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force
}

# Cut 5: drop SaaS node directories. Keep control flow, local protocols, LLM, utility.
$keepNodes = @(
  # Triggers
  "ManualTrigger","Schedule","Cron","Webhook","ErrorTrigger","SseTrigger",
  "WorkflowTrigger","Interval","LocalFileTrigger","FormTrigger",
  # Control flow
  "If","Switch","Set","Code","Wait","Merge","SplitInBatches",
  "ExecuteCommand","ExecuteWorkflow","StopAndError","NoOp",
  # Utility
  "DebugHelper","Filter","RenameKeys","Sort","Transform","ItemLists",
  "DataTable","CompareDatasets","Simulate","Totp","DateTime","Evaluation",
  "Function","FunctionItem","StickyNote","DynamicCredentialCheck",
  "RespondToWebhook","HttpRequest","GraphQL","Form",
  # Files / local protocols
  "Ftp","Ssh","S3","ReadBinaryFile","ReadBinaryFiles","WriteBinaryFile",
  "MoveBinaryData","SpreadsheetFile","ReadPdf","EditImage","ExtractFromFile",
  "Compression","RssFeedRead","Files",
  # Data utility
  "Crypto","Jwt","Html","HtmlExtract","Markdown","Xml","ICalendar","Ldap",
  # Email local
  "EmailReadImap","EmailSend",
  # LLM (cloud LLM API)
  "OpenAi","MistralAI","Perplexity"
)

if (Test-Path -LiteralPath $nodesBaseNodes) {
  Get-ChildItem -LiteralPath $nodesBaseNodes -Directory | Where-Object {
    $keepNodes -notcontains $_.Name
  } | Remove-Item -Recurse -Force
}

$trim=(Get-ChildItem -LiteralPath $Target -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum)
$credCount=(Get-ChildItem -LiteralPath $credentialsDir -File -ErrorAction SilentlyContinue | Measure-Object).Count
$nodeCount=(Get-ChildItem -LiteralPath $nodesBaseNodes -Directory -ErrorAction SilentlyContinue | Measure-Object).Count

$manifest = @"
# HomeSense n8n Runtime Trim

Generated from:

```text
$Source
```

This tree is a runtime candidate for HomeSense L2 workflow execution.

## Kept top-level packages

- packages/workflow
- packages/core
- packages/cli
- packages/nodes-base

## Kept @n8n packages

$($scopedPackages | ForEach-Object { "- packages/@n8n/$_" } | Out-String)

## Kept nodes-base credentials

$($keptCredentials | ForEach-Object { "- $_" } | Out-String)

## Kept nodes-base nodes (control flow, local protocols, LLM, utility)

$($keepNodes | ForEach-Object { "- $_" } | Out-String)

## Removed by intent

- editor and front-end packages
- SaaS, MCP, collaboration, user-management, accounts, telemetry, security-audit, push, scaling, queue, webhooks
- enterprise-only (.ee) directories and packages
- test, playwright, benchmark, dev-only configs
- all non-OAuth credentials (kept only the two generic OAuth schema files)
- top-level test directories and per-node test subdirectories
- n8n templates and dev-only docs/configs
- all SaaS node directories (kept only control flow, local protocols, LLM, utility)

## Status

Source boundary cut only. Not yet guaranteed to build.
The next cut should make package metadata and imports match the retained runtime.

## Stats

- Files remaining: $([int]$trim.Count)
- Size remaining: $([math]::Round($trim.Sum/1MB,2)) MB
- Nodes-base credentials remaining: $credCount
- Nodes-base nodes remaining: $nodeCount
"@

Set-Content -LiteralPath (Join-Path $Target "HOMESENSE_TRIM_MANIFEST.md") -Value $manifest -Encoding UTF8

Write-Host "Created HomeSense n8n runtime trim at $Target"
Write-Host "Kept scoped @n8n packages: $($scopedPackages.Count)"
Write-Host "Removed scoped @n8n packages: $($dropScopedPackages.Count)"
Write-Host "Kept credentials: $($keptCredentials -join ', ')"
Write-Host "Kept nodes: $($keepNodes.Count)"
Write-Host "Files: $($trim.Count) | Size: $([math]::Round($trim.Sum/1MB,2)) MB"
