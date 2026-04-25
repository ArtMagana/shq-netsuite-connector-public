<#
.SYNOPSIS
Tests a real NetSuite REST Web Services connection using Token-Based Authentication.

.DESCRIPTION
Builds an OAuth 1.0a Authorization header with HMAC-SHA256 and calls a live
NetSuite REST Web Services endpoint. By default, it requests REST metadata for
the `contact` record type, which is a lightweight way to verify connectivity,
authentication, and REST Web Services availability.

Oracle recommends OAuth 2.0 for new REST integrations. This script uses TBA
because it is the fastest non-interactive way to validate server-to-server
connectivity from this machine when TBA credentials already exist.

.PARAMETER AccountId
NetSuite account ID used as the OAuth realm and, if BaseUrl is omitted, to
derive a default SuiteTalk base URL.

.PARAMETER BaseUrl
Exact NetSuite SuiteTalk base URL, for example:
https://123456.suitetalk.api.netsuite.com

.PARAMETER ConsumerKey
Integration record consumer key.

.PARAMETER ConsumerSecret
Integration record consumer secret.

.PARAMETER TokenId
Token ID for the NetSuite user/role pair.

.PARAMETER TokenSecret
Token secret for the NetSuite user/role pair.

.PARAMETER RecordType
Record type used for the metadata connectivity check.

.EXAMPLE
$env:NETSUITE_ACCOUNT_ID = "123456_SB1"
$env:NETSUITE_BASE_URL = "https://123456-sb1.suitetalk.api.netsuite.com"
$env:NETSUITE_CONSUMER_KEY = "<consumer-key>"
$env:NETSUITE_CONSUMER_SECRET = "<consumer-secret>"
$env:NETSUITE_TOKEN_ID = "<token-id>"
$env:NETSUITE_TOKEN_SECRET = "<token-secret>"
.\Test-NetSuiteConnection.ps1

.EXAMPLE
.\Test-NetSuiteConnection.ps1 `
  -AccountId "123456_SB1" `
  -BaseUrl "https://123456-sb1.suitetalk.api.netsuite.com" `
  -ConsumerKey "<consumer-key>" `
  -ConsumerSecret "<consumer-secret>" `
  -TokenId "<token-id>" `
  -TokenSecret "<token-secret>" `
  -RecordType "contact"
#>
[CmdletBinding()]
param(
  [string]$AccountId = $env:NETSUITE_ACCOUNT_ID,
  [string]$BaseUrl = $env:NETSUITE_BASE_URL,
  [string]$ConsumerKey = $env:NETSUITE_CONSUMER_KEY,
  [string]$ConsumerSecret = $env:NETSUITE_CONSUMER_SECRET,
  [string]$TokenId = $env:NETSUITE_TOKEN_ID,
  [string]$TokenSecret = $env:NETSUITE_TOKEN_SECRET,
  [string]$RecordType = $(if ($env:NETSUITE_RECORD_TYPE) { $env:NETSUITE_RECORD_TYPE } else { "contact" })
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
  -Method "GET" `
  -Config $config `
  -Path "/services/rest/record/v1/metadata-catalog" `
  -Query @{ select = $RecordType }

$availablePaths = @()

if ($null -ne $response.Json) {
  if ($response.Json.PSObject.Properties.Name -contains "paths") {
    $availablePaths = $response.Json.paths.PSObject.Properties.Name | Sort-Object
  }
  elseif ($response.Json.PSObject.Properties.Name -contains "items") {
    $availablePaths = @($response.Json.items)
  }
}

[pscustomobject]@{
  Success         = $true
  TimestampUtc    = (Get-Date).ToUniversalTime().ToString("o")
  AccountId       = $config.AccountId
  BaseUrl         = $config.BaseUrl
  Endpoint        = $response.Url
  StatusCode      = $response.StatusCode
  RecordType      = $RecordType
  Authorization   = "OAuth 1.0a TBA"
  PreviewCount    = @($availablePaths).Count
  PreviewSample   = @($availablePaths | Select-Object -First 5)
  RawContentBytes = if ([string]::IsNullOrEmpty($response.Content)) { 0 } else { [System.Text.Encoding]::UTF8.GetByteCount($response.Content) }
}
