param(
  [Parameter(Mandatory = $true)]
  [string]$BackendDir,
  [Parameter(Mandatory = $true)]
  [string]$FrontendDistDir,
  [Parameter(Mandatory = $true)]
  [string]$NodeExecutable,
  [Parameter(Mandatory = $true)]
  [string]$LogDirectory,
  [string]$BindHost = '0.0.0.0',
  [string]$NetSuiteAccountStorePath = '',
  [string]$NetSuiteEntityStorePath = '',
  [int]$Port = 3000,
  [int]$CheckIntervalSeconds = 10,
  [int]$StartupGraceSeconds = 6
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $LogDirectory)) {
  New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
}

$backendOutLog = Join-Path $LogDirectory 'backend.out.log'
$backendErrLog = Join-Path $LogDirectory 'backend.err.log'
$backendPidPath = Join-Path $LogDirectory 'backend.pid'
$watchdogLog = Join-Path $LogDirectory 'watchdog.log'
$healthUrl = "http://127.0.0.1:$Port/api/health"
$siteUrl = "http://127.0.0.1:$Port/"
$frontendIndexPath = Join-Path $FrontendDistDir 'index.html'

if (-not (Test-Path $NodeExecutable)) {
  throw "Node executable not found at $NodeExecutable."
}

if (-not (Test-Path $frontendIndexPath)) {
  throw "Frontend build not found at $frontendIndexPath."
}

function Write-WatchdogLog {
  param(
    [string]$Message
  )

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $watchdogLog -Value "[$timestamp] $Message"
}

function Test-PreviewUrl {
  param(
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  }
  catch {
    return $false
  }
}

function Stop-BackendProcess {
  param(
    [int]$ProcessId
  )

  if ($ProcessId -le 0) {
    return
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

function Start-BackendProcess {
  foreach ($path in @($backendOutLog, $backendErrLog)) {
    if (-not (Test-Path $path)) {
      New-Item -ItemType File -Path $path -Force | Out-Null
    }

    Clear-Content -LiteralPath $path
  }

  $env:PORT = "$Port"
  $env:HOST = $BindHost
  $env:FRONTEND_DIST_DIR = $FrontendDistDir
  if ($NetSuiteAccountStorePath) {
    $env:NETSUITE_ACCOUNT_STORE_PATH = $NetSuiteAccountStorePath
  }
  if ($NetSuiteEntityStorePath) {
    $env:NETSUITE_ENTITY_STORE_PATH = $NetSuiteEntityStorePath
  }

  $process = Start-Process `
    -FilePath $NodeExecutable `
    -ArgumentList @('dist/server.js') `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendOutLog `
    -RedirectStandardError $backendErrLog `
    -PassThru

  Set-Content -LiteralPath $backendPidPath -Value $process.Id
  Write-WatchdogLog "Backend started with PID $($process.Id) on $BindHost:$Port."
  Start-Sleep -Seconds $StartupGraceSeconds

  return $process.Id
}

Write-WatchdogLog "Watchdog started for $BackendDir with frontend $FrontendDistDir on $BindHost:$Port."

$backendPid = 0

while ($true) {
  try {
    $backendProcess = $null

    if ($backendPid -gt 0) {
      $backendProcess = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
    }

    if (-not $backendProcess -and (Test-Path $backendPidPath)) {
      $savedPid = Get-Content -LiteralPath $backendPidPath -TotalCount 1 -ErrorAction SilentlyContinue
      if ($savedPid -and $savedPid -match '^\d+$') {
        $backendPid = [int]$savedPid
        $backendProcess = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
      }
    }

    $healthOk = if ($backendProcess) { Test-PreviewUrl -Url $healthUrl } else { $false }
    $siteOk = if ($backendProcess) { Test-PreviewUrl -Url $siteUrl } else { $false }

    if ($backendProcess -and $healthOk -and $siteOk) {
      Start-Sleep -Seconds $CheckIntervalSeconds
      continue
    }

    if ($backendProcess) {
      Write-WatchdogLog "Backend unhealthy. Health=$healthOk Site=$siteOk. Restarting PID $backendPid."
      Stop-BackendProcess -ProcessId $backendPid
    } else {
      Write-WatchdogLog 'Backend is not running. Starting a new local process.'
    }

    $backendPid = Start-BackendProcess
    $healthOk = Test-PreviewUrl -Url $healthUrl
    $siteOk = Test-PreviewUrl -Url $siteUrl
    Write-WatchdogLog "Post-start status: Health=$healthOk Site=$siteOk."
  }
  catch {
    Write-WatchdogLog "Watchdog error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $CheckIntervalSeconds
}
