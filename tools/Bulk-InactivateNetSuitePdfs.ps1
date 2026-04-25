[CmdletBinding()]
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$EnvPath = (Join-Path $RepoRoot "backend/.env.local"),
  [string]$OutputDir = "C:\Users\artur\AppData\Local\Temp\codex-netsuite",
  [int[]]$ExcludedFolderIds = @(838, 226),
  [int]$BatchSize = 100,
  [int]$SuiteQlPageSize = 1000,
  [switch]$ExportOnly,
  [string]$ExistingTargetCsv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") {
      return
    }

    $parts = $line.Split("=", 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function ConvertTo-XmlText {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) {
    return ""
  }

  return [Security.SecurityElement]::Escape($Value)
}

function ConvertTo-Rfc3986EncodedString {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) {
    return ""
  }

  return [System.Uri]::EscapeDataString($Value).
    Replace("+", "%20").
    Replace("*", "%2A").
    Replace("%7E", "~")
}

function New-OAuthNonce {
  $charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray()
  return -join (1..24 | ForEach-Object { $charset[(Get-Random -Minimum 0 -Maximum $charset.Length)] })
}

function New-TokenPassportXml {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$Config
  )

  $nonce = New-OAuthNonce
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $baseString = @(
    $Config.AccountId,
    $Config.ConsumerKey,
    $Config.TokenId,
    $nonce,
    $timestamp
  ) -join "&"
  $key = "{0}&{1}" -f $Config.ConsumerSecret, $Config.TokenSecret
  $hasher = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($key))

  try {
    $signatureBytes = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($baseString))
    $signature = [Convert]::ToBase64String($signatureBytes)
  }
  finally {
    $hasher.Dispose()
  }

  return @"
<platformMsgs:tokenPassport>
  <platformCore:account>$(ConvertTo-XmlText $Config.AccountId)</platformCore:account>
  <platformCore:consumerKey>$(ConvertTo-XmlText $Config.ConsumerKey)</platformCore:consumerKey>
  <platformCore:token>$(ConvertTo-XmlText $Config.TokenId)</platformCore:token>
  <platformCore:nonce>$(ConvertTo-XmlText $nonce)</platformCore:nonce>
  <platformCore:timestamp>$(ConvertTo-XmlText $timestamp)</platformCore:timestamp>
  <platformCore:signature algorithm="HMAC-SHA256">$(ConvertTo-XmlText $signature)</platformCore:signature>
</platformMsgs:tokenPassport>
"@
}

function Get-NetSuiteSoapConfig {
  $missing = @()
  foreach ($name in @(
      "NETSUITE_ACCOUNT_ID",
      "NETSUITE_CONSUMER_KEY",
      "NETSUITE_CONSUMER_SECRET",
      "NETSUITE_TOKEN_ID",
      "NETSUITE_TOKEN_SECRET"
    )) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
      $missing += $name
    }
  }

  if ($missing.Count -gt 0) {
    throw "Missing required NetSuite environment variables: $($missing -join ', ')"
  }

  $accountId = [Environment]::GetEnvironmentVariable("NETSUITE_ACCOUNT_ID", "Process")
  $baseUrl = [Environment]::GetEnvironmentVariable("NETSUITE_BASE_URL", "Process")
  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    $baseUrl = "https://$($accountId.ToLowerInvariant().Replace('_', '-')).suitetalk.api.netsuite.com"
  }

  return [pscustomobject]@{
    AccountId      = $accountId
    BaseUrl        = $baseUrl.TrimEnd("/")
    SoapUrl        = "$($baseUrl.TrimEnd('/'))/services/NetSuitePort_2025_1"
    ConsumerKey    = [Environment]::GetEnvironmentVariable("NETSUITE_CONSUMER_KEY", "Process")
    ConsumerSecret = [Environment]::GetEnvironmentVariable("NETSUITE_CONSUMER_SECRET", "Process")
    TokenId        = [Environment]::GetEnvironmentVariable("NETSUITE_TOKEN_ID", "Process")
    TokenSecret    = [Environment]::GetEnvironmentVariable("NETSUITE_TOKEN_SECRET", "Process")
  }
}

function Invoke-SuiteQL {
  param(
    [Parameter(Mandatory = $true)][string]$Query,
    [int]$Limit = 1000,
    [int]$Offset = 0
  )

  $restModule = Join-Path $RepoRoot "NetSuiteRest.psm1"
  Import-Module $restModule -Force
  $config = Get-NetSuiteConfig
  $response = Invoke-NetSuiteRestRequest `
    -Method "POST" `
    -Config $config `
    -Path "/services/rest/query/v1/suiteql" `
    -Query @{ limit = $Limit; offset = $Offset } `
    -Headers @{ Prefer = "transient" } `
    -Body @{ q = $Query }

  $content = if ($response.Content -is [byte[]]) {
    [System.Text.Encoding]::UTF8.GetString($response.Content)
  }
  else {
    [string]$response.Content
  }

  return $content | ConvertFrom-Json
}

function Invoke-NetSuiteUpdateList {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$Config,
    [Parameter(Mandatory = $true)][object[]]$Rows
  )

  $records = foreach ($row in $Rows) {
    $id = ConvertTo-XmlText ([string]$row.id)
    @"
      <platformMsgs:record xsi:type="filecabinet:File" internalId="$id">
        <filecabinet:isInactive>true</filecabinet:isInactive>
      </platformMsgs:record>
"@
  }

  $body = @"
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:platformMsgs="urn:messages_2025_1.platform.webservices.netsuite.com"
  xmlns:platformCore="urn:core_2025_1.platform.webservices.netsuite.com"
  xmlns:filecabinet="urn:filecabinet_2025_1.documents.webservices.netsuite.com">
  <soapenv:Header>
    $(New-TokenPassportXml -Config $Config)
  </soapenv:Header>
  <soapenv:Body>
    <platformMsgs:updateList>
$($records -join "`n")
    </platformMsgs:updateList>
  </soapenv:Body>
</soapenv:Envelope>
"@

  $headers = @{
    SOAPAction = "updateList"
    Accept     = "text/xml"
  }

  $response = Invoke-WebRequest `
    -Uri $Config.SoapUrl `
    -Method "POST" `
    -Headers $headers `
    -ContentType "text/xml; charset=utf-8" `
    -Body $body `
    -UseBasicParsing `
    -MaximumRedirection 5

  $content = if ($response.Content -is [byte[]]) {
    [System.Text.Encoding]::UTF8.GetString($response.Content)
  }
  else {
    [string]$response.Content
  }

  [xml]$xml = $content
  $fault = $xml.SelectSingleNode("//*[local-name()='Fault']")
  if ($null -ne $fault) {
    throw $fault.InnerText
  }

  $writeResponses = @($xml.SelectNodes("//*[local-name()='writeResponse']"))
  if ($writeResponses.Count -eq 0) {
    throw "SOAP updateList returned no writeResponse nodes. HTTP status: $([int]$response.StatusCode)"
  }

  $successCount = 0
  $failures = New-Object System.Collections.Generic.List[object]
  for ($i = 0; $i -lt $writeResponses.Count; $i++) {
    $status = $writeResponses[$i].SelectSingleNode("./*[local-name()='status']")
    if ($null -eq $status) {
      throw "SOAP writeResponse at index $i did not include a status node."
    }

    $isSuccess = [string]$status.GetAttribute("isSuccess")
    if ($isSuccess.ToLowerInvariant() -eq "true") {
      $successCount++
      continue
    }

    $messages = @()
    foreach ($detail in @($status.SelectNodes(".//*[local-name()='statusDetail']"))) {
      $codeNode = $detail.SelectSingleNode("./*[local-name()='code']")
      $messageNode = $detail.SelectSingleNode("./*[local-name()='message']")
      $messages += "{0}: {1}" -f $codeNode.InnerText, $messageNode.InnerText
    }

    $sourceRow = if ($i -lt $Rows.Count) { $Rows[$i] } else { $null }
    $failures.Add([pscustomobject]@{
        id       = if ($null -ne $sourceRow) { $sourceRow.id } else { $null }
        name     = if ($null -ne $sourceRow) { $sourceRow.name } else { $null }
        folder   = if ($null -ne $sourceRow) { $sourceRow.folder } else { $null }
        messages = ($messages -join " | ")
      })
  }

  $failureRows = @()
  foreach ($failure in $failures) {
    $failureRows += $failure
  }

  return [pscustomobject]@{
    SuccessCount = [int]$successCount
    FailureRows  = $failureRows
    RawStatus    = [int]$response.StatusCode
  }
}

function Export-TargetRows {
  param(
    [Parameter(Mandatory = $true)][string]$TargetCsv,
    [Parameter(Mandatory = $true)][string]$ProgressPath,
    [int[]]$ExcludedIds
  )

  $excludedSql = ($ExcludedIds | ForEach-Object { [string][int]$_ }) -join ", "
  $scopeWhere = "filetype = 'PDF' AND isinactive = 'F' AND folder NOT IN ($excludedSql)"
  $countJson = Invoke-SuiteQL -Query "SELECT COUNT(*) AS cnt FROM file WHERE $scopeWhere" -Limit 1
  $expected = [int]$countJson.items[0].cnt
  "expectedTargetCount=$expected" | Set-Content -Path $ProgressPath -Encoding UTF8

  if (Test-Path $TargetCsv) {
    Remove-Item -LiteralPath $TargetCsv -Force
  }

  $lastId = 0
  $written = 0
  $firstWrite = $true
  while ($true) {
    $query = "SELECT id, name, folder, filetype, isinactive FROM file WHERE $scopeWhere AND id > $lastId ORDER BY id"
    $json = Invoke-SuiteQL -Query $query -Limit $SuiteQlPageSize -Offset 0
    $items = @($json.items)
    if ($items.Count -eq 0) {
      break
    }

    $rows = foreach ($item in $items) {
      [pscustomobject]@{
        id         = [int]$item.id
        name       = [string]$item.name
        folder     = [string]$item.folder
        filetype   = [string]$item.filetype
        isinactive = [string]$item.isinactive
      }
    }

    if ($firstWrite) {
      $rows | Export-Csv -Path $TargetCsv -NoTypeInformation -Encoding UTF8
      $firstWrite = $false
    }
    else {
      $rows | Export-Csv -Path $TargetCsv -NoTypeInformation -Encoding UTF8 -Append
    }

    $written += $rows.Count
    $lastId = [int]($rows[-1].id)
    Add-Content -Path $ProgressPath -Value ("exported={0};lastId={1};utc={2}" -f $written, $lastId, (Get-Date).ToUniversalTime().ToString("o"))
  }

  if ($written -ne $expected) {
    throw "Exported $written rows but expected $expected rows. Stopping before updates."
  }

  return $written
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Import-DotEnv -Path $EnvPath
$soapConfig = Get-NetSuiteSoapConfig
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "{0}-{1}" -f $timestamp, $PID
$targetCsv = if ([string]::IsNullOrWhiteSpace($ExistingTargetCsv)) {
  Join-Path $OutputDir "netsuite-active-pdfs-except-838-226-backup-$runId.csv"
}
else {
  $ExistingTargetCsv
}
$progressPath = Join-Path $OutputDir "netsuite-active-pdfs-except-838-226-progress-$runId.log"
$failureCsv = Join-Path $OutputDir "netsuite-active-pdfs-except-838-226-failures-$runId.csv"

if ([string]::IsNullOrWhiteSpace($ExistingTargetCsv)) {
  $exported = Export-TargetRows -TargetCsv $targetCsv -ProgressPath $progressPath -ExcludedIds $ExcludedFolderIds
}
else {
  $exported = @((Import-Csv -Path $targetCsv)).Count
  "usingExistingTargetCsv=$targetCsv" | Set-Content -Path $progressPath -Encoding UTF8
  Add-Content -Path $progressPath -Value "expectedTargetCount=$exported"
}

if ($ExportOnly) {
  [pscustomobject]@{
    targetCsv    = $targetCsv
    progressPath = $progressPath
    exported     = $exported
  } | ConvertTo-Json -Depth 4
  return
}

$allRows = @(Import-Csv -Path $targetCsv | Sort-Object @{ Expression = { [int]$_.id }; Ascending = $true })
$processed = 0
$success = 0
$failures = New-Object System.Collections.Generic.List[object]

for ($start = 0; $start -lt $allRows.Count; $start += $BatchSize) {
  $batch = @($allRows[$start..([Math]::Min($start + $BatchSize - 1, $allRows.Count - 1))])
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $result = Invoke-NetSuiteUpdateList -Config $soapConfig -Rows $batch
      $success += $result.SuccessCount
      foreach ($failure in $result.FailureRows) {
        $failures.Add($failure)
      }
      break
    }
    catch {
      if ($attempt -ge 4) {
        foreach ($row in $batch) {
          $failures.Add([pscustomobject]@{
              id       = $row.id
              name     = $row.name
              folder   = $row.folder
              messages = "Batch request failed after retries: $($_.Exception.Message) | $($_.ScriptStackTrace)"
            })
        }
        break
      }

      Start-Sleep -Seconds ([Math]::Min(30, [Math]::Pow(2, $attempt)))
    }
  }

  $processed += $batch.Count
  Add-Content -Path $progressPath -Value ("updatedProcessed={0};success={1};failures={2};lastId={3};utc={4}" -f $processed, $success, $failures.Count, $batch[-1].id, (Get-Date).ToUniversalTime().ToString("o"))
}

if ($failures.Count -gt 0) {
  $failures | Export-Csv -Path $failureCsv -NoTypeInformation -Encoding UTF8
}

[pscustomobject]@{
  targetCsv    = $targetCsv
  progressPath = $progressPath
  failureCsv   = if ($failures.Count -gt 0) { $failureCsv } else { $null }
  exported     = $exported
  processed    = $processed
  success      = $success
  failures     = $failures.Count
} | ConvertTo-Json -Depth 4
