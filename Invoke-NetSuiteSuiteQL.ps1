<#
.SYNOPSIS
Runs a read-only SuiteQL query through NetSuite REST Web Services.

.DESCRIPTION
Uses the shared NetSuite REST module to authenticate with Token-Based
Authentication and submit a POST request to the SuiteQL REST endpoint.
This is a practical next-step after connectivity validation because it
confirms the account, role, and token can read business data.

.PARAMETER AccountId
NetSuite account ID used as the OAuth realm.

.PARAMETER BaseUrl
Exact NetSuite SuiteTalk base URL.

.PARAMETER ConsumerKey
Integration record consumer key.

.PARAMETER ConsumerSecret
Integration record consumer secret.

.PARAMETER TokenId
Token ID for the NetSuite user/role pair.

.PARAMETER TokenSecret
Token secret for the NetSuite user/role pair.

.PARAMETER Query
SuiteQL statement to execute.

.PARAMETER Limit
Maximum number of rows returned by the REST endpoint.

.PARAMETER Offset
Pagination offset for the REST endpoint.

.PARAMETER PreviewRows
Maximum number of rows included in the output preview.

.EXAMPLE
.\Invoke-NetSuiteSuiteQL.ps1

.EXAMPLE
.\Invoke-NetSuiteSuiteQL.ps1 `
  -Query "SELECT id, tranid, trandate FROM transaction ORDER BY trandate DESC" `
  -Limit 10
#>
[CmdletBinding()]
param(
  [string]$AccountId = $env:NETSUITE_ACCOUNT_ID,
  [string]$BaseUrl = $env:NETSUITE_BASE_URL,
  [string]$ConsumerKey = $env:NETSUITE_CONSUMER_KEY,
  [string]$ConsumerSecret = $env:NETSUITE_CONSUMER_SECRET,
  [string]$TokenId = $env:NETSUITE_TOKEN_ID,
  [string]$TokenSecret = $env:NETSUITE_TOKEN_SECRET,
  [string]$Query = "SELECT id, entityid, companyname FROM customer ORDER BY id",
  [ValidateRange(1, 1000)]
  [int]$Limit = 5,
  [ValidateRange(0, 1000000)]
  [int]$Offset = 0,
  [ValidateRange(1, 50)]
  [int]$PreviewRows = 5
)

Import-Module (Join-Path $PSScriptRoot "NetSuiteRest.psm1") -Force

$config = Get-NetSuiteConfig `
  -AccountId $AccountId `
  -BaseUrl $BaseUrl `
  -ConsumerKey $ConsumerKey `
  -ConsumerSecret $ConsumerSecret `
  -TokenId $TokenId `
  -TokenSecret $TokenSecret

$response = Invoke-NetSuiteRestRequest `
  -Method "POST" `
  -Config $config `
  -Path "/services/rest/query/v1/suiteql" `
  -Query @{
    limit  = $Limit
    offset = $Offset
  } `
  -Headers @{
    Prefer = "transient"
  } `
  -Body @{
    q = $Query
  }

$items = @()
$count = 0
$hasMore = $false
$totalResults = $null

if ($null -ne $response.Json) {
  if ($response.Json.PSObject.Properties.Name -contains "items") {
    $items = @($response.Json.items)
  }

  if ($response.Json.PSObject.Properties.Name -contains "count") {
    $count = [int]$response.Json.count
  }
  else {
    $count = @($items).Count
  }

  if ($response.Json.PSObject.Properties.Name -contains "hasMore") {
    $hasMore = [bool]$response.Json.hasMore
  }

  if ($response.Json.PSObject.Properties.Name -contains "totalResults") {
    $totalResults = [int]$response.Json.totalResults
  }
}

[pscustomobject]@{
  Success       = $true
  TimestampUtc  = (Get-Date).ToUniversalTime().ToString("o")
  AccountId     = $config.AccountId
  Endpoint      = $response.Url
  StatusCode    = $response.StatusCode
  Query         = $Query
  Limit         = $Limit
  Offset        = $Offset
  Count         = $count
  TotalResults  = $totalResults
  HasMore       = $hasMore
  PreviewRows   = @($items | Select-Object -First $PreviewRows)
}
