param(
  [string]$LocalRoot = (Join-Path $env:LOCALAPPDATA 'Temp\netsuite-recon-preview'),
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Resolve-NodeExecutable {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  $wingetNode = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.15.0-win-x64\node.exe'
  if (Test-Path $wingetNode) {
    return $wingetNode
  }

  throw 'Node.js LTS no esta disponible. Instala Node o ejecuta winget install OpenJS.NodeJS.LTS.'
}

function Resolve-PowerShellExecutable {
  foreach ($candidate in @('powershell.exe', 'powershell', 'pwsh.exe', 'pwsh')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw 'PowerShell no esta disponible para arrancar el watchdog local.'
}

function Invoke-NpmInstall {
  param(
    [string]$WorkingDirectory,
    [string]$NodeExecutable
  )

  $npmCli = Join-Path (Split-Path $NodeExecutable) 'node_modules\npm\bin\npm-cli.js'
  Push-Location $WorkingDirectory
  try {
    & $NodeExecutable $npmCli install
  }
  finally {
    Pop-Location
  }
}

function Invoke-NodeScript {
  param(
    [string]$WorkingDirectory,
    [string]$NodeExecutable,
    [string[]]$Arguments
  )

  Push-Location $WorkingDirectory
  try {
    & $NodeExecutable @Arguments
  }
  finally {
    Pop-Location
  }
}

function Start-DetachedPowerShellProcess {
  param(
    [string]$PowerShellExecutable,
    [string]$ScriptPath,
    [string[]]$Arguments,
    [string]$StdOutPath,
    [string]$StdErrPath
  )

  foreach ($path in @($StdOutPath, $StdErrPath)) {
    if (Test-Path $path) {
      Remove-Item -LiteralPath $path -Force
    }
  }

  $argumentList = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $Arguments
  $quotedArgumentList = $argumentList | ForEach-Object {
    if ($_ -match '\s') {
      '"{0}"' -f $_
    } else {
      $_
    }
  }

  return Start-Process `
    -FilePath $PowerShellExecutable `
    -ArgumentList ($quotedArgumentList -join ' ') `
    -WorkingDirectory (Split-Path $ScriptPath -Parent) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdOutPath `
    -RedirectStandardError $StdErrPath `
    -PassThru
}

function Stop-ProcessesByCommandLineFragment {
  param(
    [string]$CommandLineFragment
  )

  if (-not $CommandLineFragment) {
    return
  }

  $normalizedFragment = $CommandLineFragment.Replace('\', '/')
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and $_.CommandLine.Replace('\', '/') -like "*$normalizedFragment*"
    })

  foreach ($processInfo in $processes) {
    Stop-Process -Id $processInfo.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-PreviewListener {
  param(
    [int]$Port,
    [string[]]$ExpectedCommandLineFragments
  )

  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $commandLine = $processInfo.CommandLine
    $normalizedCommandLine = if ($commandLine) { $commandLine.Replace('\', '/') } else { '' }
    $matchesExpectedFragment = $false

    foreach ($fragment in $ExpectedCommandLineFragments) {
      if (-not $fragment) {
        continue
      }

      $normalizedFragment = $fragment.Replace('\', '/')
      if ($normalizedCommandLine -like "*$normalizedFragment*") {
        $matchesExpectedFragment = $true
        break
      }
    }

    if ($processInfo -and $commandLine -and $matchesExpectedFragment) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      continue
    }

    $processName = if ($processInfo) { $processInfo.Name } else { 'desconocido' }
    throw "El puerto $Port ya esta en uso por $processName. Libera ese puerto y vuelve a ejecutar el preview."
  }
}

$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = Resolve-NodeExecutable
$powerShellExe = Resolve-PowerShellExecutable
$watchdogScriptPath = Join-Path $workspaceRoot 'Watch-LocalPreview.ps1'

if (-not (Test-Path $watchdogScriptPath)) {
  throw "No existe el watchdog local en $watchdogScriptPath."
}

$logDir = Join-Path $LocalRoot 'logs'
$backendDir = Join-Path $LocalRoot 'backend'
$frontendDir = Join-Path $LocalRoot 'frontend'
$frontendDistDir = Join-Path $frontendDir 'dist'
$watchdogOutLog = Join-Path $logDir 'watchdog.out.log'
$watchdogErrLog = Join-Path $logDir 'watchdog.err.log'
$backendPidPath = Join-Path $logDir 'backend.pid'
$reuseInstall = $SkipInstall -and (Test-Path (Join-Path $backendDir 'node_modules')) -and (Test-Path (Join-Path $frontendDir 'node_modules'))

Stop-ProcessesByCommandLineFragment -CommandLineFragment $watchdogScriptPath
Stop-PreviewListener -Port 3001 -ExpectedCommandLineFragments @('dist/server.js')
Stop-PreviewListener -Port 3000 -ExpectedCommandLineFragments @('dist/server.js', 'node_modules/vite/bin/vite.js')

if (Test-Path $LocalRoot) {
  if (-not $reuseInstall) {
    try {
      Remove-Item -LiteralPath $LocalRoot -Recurse -Force
    }
    catch {
      $fallbackRoot = '{0}-{1}' -f $LocalRoot, (Get-Date -Format 'yyyyMMdd-HHmmss')
      Write-Host "No se pudo reciclar $LocalRoot; se usara $fallbackRoot para este arranque."
      $LocalRoot = $fallbackRoot
    }
  }
}

if (-not $reuseInstall) {
  $logDir = Join-Path $LocalRoot 'logs'
  $backendDir = Join-Path $LocalRoot 'backend'
  $frontendDir = Join-Path $LocalRoot 'frontend'
  $frontendDistDir = Join-Path $frontendDir 'dist'
  $watchdogOutLog = Join-Path $logDir 'watchdog.out.log'
  $watchdogErrLog = Join-Path $logDir 'watchdog.err.log'
  $backendPidPath = Join-Path $logDir 'backend.pid'
}

if (-not (Test-Path $LocalRoot)) {
  New-Item -ItemType Directory -Path $LocalRoot | Out-Null
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if ($SkipInstall -and -not $reuseInstall) {
  Write-Host 'SkipInstall solicitado, pero no existe una copia local reutilizable. Se instalaran dependencias una vez.'
}

robocopy $workspaceRoot $LocalRoot /E /XD node_modules dist .git .venv __pycache__ /XF *.pyc | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "Robocopy fallo con codigo $LASTEXITCODE."
}

if (-not $reuseInstall) {
  Invoke-NpmInstall -WorkingDirectory $backendDir -NodeExecutable $nodeExe
  Invoke-NpmInstall -WorkingDirectory $frontendDir -NodeExecutable $nodeExe
}

Invoke-NodeScript -WorkingDirectory $backendDir -NodeExecutable $nodeExe -Arguments @('node_modules/typescript/bin/tsc', '-p', 'tsconfig.json')
Invoke-NodeScript -WorkingDirectory $frontendDir -NodeExecutable $nodeExe -Arguments @('node_modules/typescript/bin/tsc', '-b')
Invoke-NodeScript -WorkingDirectory $frontendDir -NodeExecutable $nodeExe -Arguments @('node_modules/vite/bin/vite.js', 'build')

if (-not (Test-Path (Join-Path $frontendDistDir 'index.html'))) {
  throw "El build del frontend no genero index.html en $frontendDistDir."
}

$watchdogPid = (Start-DetachedPowerShellProcess `
  -PowerShellExecutable $powerShellExe `
  -ScriptPath $watchdogScriptPath `
  -Arguments @(
    '-BackendDir', $backendDir,
    '-FrontendDistDir', $frontendDistDir,
    '-NodeExecutable', $nodeExe,
    '-LogDirectory', $logDir,
    '-BindHost', '0.0.0.0',
    '-NetSuiteAccountStorePath', (Join-Path $workspaceRoot 'backend\storage\netsuite-accounts.json'),
    '-NetSuiteEntityStorePath', (Join-Path $workspaceRoot 'backend\storage\netsuite-entities.json'),
    '-Port', '3000'
  ) `
  -StdOutPath $watchdogOutLog `
  -StdErrPath $watchdogErrLog).Id

Start-Sleep -Seconds 8

$backendPid = $null
if (Test-Path $backendPidPath) {
  $backendPidText = Get-Content -LiteralPath $backendPidPath -TotalCount 1 -ErrorAction SilentlyContinue
  if ($backendPidText -and $backendPidText -match '^\d+$') {
    $backendPid = [int]$backendPidText
  }
}

$backendStatus = try {
  (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 10).StatusCode
}
catch {
  $_.Exception.Message
}

$frontendStatus = try {
  (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000' -TimeoutSec 10).StatusCode
}
catch {
  $_.Exception.Message
}

[pscustomobject]@{
  LocalRoot      = $LocalRoot
  WatchdogPid    = $watchdogPid
  BackendPid     = $backendPid
  BackendStatus  = $backendStatus
  FrontendStatus = $frontendStatus
  FrontendUrl    = 'http://127.0.0.1:3000'
  BackendHealth  = 'http://127.0.0.1:3000/api/health'
  LogDirectory   = $logDir
} | Format-List
