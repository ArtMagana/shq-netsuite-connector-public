Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-Rfc3986EncodedString {
  param(
    [AllowNull()]
    [string]$Value
  )

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

function Get-QueryParameterPairs {
  param(
    [uri]$Uri
  )

  $pairs = New-Object System.Collections.Generic.List[object]
  $query = $Uri.Query.TrimStart("?")

  if ([string]::IsNullOrWhiteSpace($query)) {
    return $pairs
  }

  foreach ($segment in $query.Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $parts = $segment.Split("=", 2)
    $name = [System.Uri]::UnescapeDataString($parts[0])
    $value = if ($parts.Length -gt 1) { [System.Uri]::UnescapeDataString($parts[1]) } else { "" }
    $pairs.Add([pscustomobject]@{
        Name  = $name
        Value = $value
      })
  }

  return $pairs
}

function Get-NormalizedParameterString {
  param(
    [System.Collections.IEnumerable]$Pairs
  )

  $normalized = foreach ($pair in $Pairs) {
    [pscustomobject]@{
      Name  = ConvertTo-Rfc3986EncodedString -Value $pair.Name
      Value = ConvertTo-Rfc3986EncodedString -Value $pair.Value
    }
  }

  return (($normalized |
      Sort-Object Name, Value |
      ForEach-Object { "{0}={1}" -f $_.Name, $_.Value }) -join "&")
}

function Get-NetSuiteSignature {
  param(
    [ValidateSet("GET", "POST", "PATCH", "PUT", "DELETE")]
    [string]$Method,
    [string]$Url,
    [hashtable]$OAuthParameters,
    [string]$ConsumerSecretValue,
    [string]$TokenSecretValue
  )

  $uri = [uri]$Url
  $baseUri = "{0}://{1}{2}" -f $uri.Scheme, $uri.Authority, $uri.AbsolutePath
  $allPairs = New-Object System.Collections.Generic.List[object]

  foreach ($pair in (Get-QueryParameterPairs -Uri $uri)) {
    $allPairs.Add($pair)
  }

  foreach ($key in $OAuthParameters.Keys) {
    if ($key -eq "realm" -or $key -eq "oauth_signature") {
      continue
    }

    $allPairs.Add([pscustomobject]@{
        Name  = $key
        Value = [string]$OAuthParameters[$key]
      })
  }

  $normalizedParameters = Get-NormalizedParameterString -Pairs $allPairs
  $signatureBaseString = @(
    $Method.ToUpperInvariant(),
    (ConvertTo-Rfc3986EncodedString -Value $baseUri),
    (ConvertTo-Rfc3986EncodedString -Value $normalizedParameters)
  ) -join "&"

  $signingKey = "{0}&{1}" -f `
    (ConvertTo-Rfc3986EncodedString -Value $ConsumerSecretValue), `
    (ConvertTo-Rfc3986EncodedString -Value $TokenSecretValue)

  $hasher = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($signingKey))

  try {
    $signatureBytes = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signatureBaseString))
  }
  finally {
    $hasher.Dispose()
  }

  return [Convert]::ToBase64String($signatureBytes)
}

function New-NetSuiteAuthorizationHeader {
  param(
    [ValidateSet("GET", "POST", "PATCH", "PUT", "DELETE")]
    [string]$Method,
    [string]$Url,
    [string]$Realm,
    [string]$ConsumerKeyValue,
    [string]$ConsumerSecretValue,
    [string]$TokenIdValue,
    [string]$TokenSecretValue
  )

  $oauthParameters = [ordered]@{
    realm                  = $Realm
    oauth_token            = $TokenIdValue
    oauth_consumer_key     = $ConsumerKeyValue
    oauth_nonce            = New-OAuthNonce
    oauth_timestamp        = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
    oauth_signature_method = "HMAC-SHA256"
    oauth_version          = "1.0"
  }

  $oauthParameters.oauth_signature = Get-NetSuiteSignature `
    -Method $Method `
    -Url $Url `
    -OAuthParameters $oauthParameters `
    -ConsumerSecretValue $ConsumerSecretValue `
    -TokenSecretValue $TokenSecretValue

  $headerPairs = foreach ($key in @(
      "realm",
      "oauth_token",
      "oauth_consumer_key",
      "oauth_nonce",
      "oauth_timestamp",
      "oauth_signature_method",
      "oauth_version",
      "oauth_signature"
    )) {
    '{0}="{1}"' -f $key, (ConvertTo-Rfc3986EncodedString -Value ([string]$oauthParameters[$key]))
  }

  return "OAuth {0}" -f ($headerPairs -join ", ")
}

function Get-HttpErrorDetail {
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )

  $response = $ErrorRecord.Exception.Response

  if ($null -eq $response) {
    return [pscustomobject]@{
      StatusCode = $null
      Body       = $null
      Message    = $ErrorRecord.Exception.Message
    }
  }

  $statusCode = $null
  $body = $null

  try {
    $statusCode = [int]$response.StatusCode
  }
  catch {
    $statusCode = $null
  }

  try {
    $stream = $response.GetResponseStream()
    if ($null -ne $stream) {
      $reader = New-Object System.IO.StreamReader($stream)
      try {
        $body = $reader.ReadToEnd()
      }
      finally {
        $reader.Dispose()
        $stream.Dispose()
      }
    }
  }
  catch {
    $body = $null
  }

  return [pscustomobject]@{
    StatusCode = $statusCode
    Body       = $body
    Message    = $ErrorRecord.Exception.Message
  }
}

function Get-NetSuiteConfig {
  [CmdletBinding()]
  param(
    [string]$AccountId = $env:NETSUITE_ACCOUNT_ID,
    [string]$BaseUrl = $env:NETSUITE_BASE_URL,
    [string]$ConsumerKey = $env:NETSUITE_CONSUMER_KEY,
    [string]$ConsumerSecret = $env:NETSUITE_CONSUMER_SECRET,
    [string]$TokenId = $env:NETSUITE_TOKEN_ID,
    [string]$TokenSecret = $env:NETSUITE_TOKEN_SECRET
  )

  $missingParameters = @(@(
      [pscustomobject]@{ Name = "AccountId"; Value = $AccountId }
      [pscustomobject]@{ Name = "ConsumerKey"; Value = $ConsumerKey }
      [pscustomobject]@{ Name = "ConsumerSecret"; Value = $ConsumerSecret }
      [pscustomobject]@{ Name = "TokenId"; Value = $TokenId }
      [pscustomobject]@{ Name = "TokenSecret"; Value = $TokenSecret }
    ) | Where-Object { [string]::IsNullOrWhiteSpace($_.Value) } | Select-Object -ExpandProperty Name)

  if ($missingParameters.Count -gt 0) {
    throw "Missing required NetSuite values: $($missingParameters -join ', '). Set parameters directly or load the NETSUITE_* environment variables."
  }

  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $fallbackAccountSegment = $AccountId.ToLowerInvariant().Replace("_", "-")
    $BaseUrl = "https://$fallbackAccountSegment.suitetalk.api.netsuite.com"
    Write-Warning "NETSUITE_BASE_URL was not provided. Falling back to $BaseUrl. Oracle recommends using the exact SuiteTalk URL from NetSuite Company URLs."
  }

  return [pscustomobject]@{
    AccountId      = $AccountId
    BaseUrl        = $BaseUrl.TrimEnd("/")
    ConsumerKey    = $ConsumerKey
    ConsumerSecret = $ConsumerSecret
    TokenId        = $TokenId
    TokenSecret    = $TokenSecret
  }
}

function New-NetSuiteUrl {
  param(
    [string]$BaseUrl,
    [string]$Path,
    [hashtable]$Query
  )

  $trimmedBaseUrl = $BaseUrl.TrimEnd("/")
  $normalizedPath = if ($Path.StartsWith("/")) { $Path } else { "/$Path" }

  if ($null -eq $Query -or $Query.Count -eq 0) {
    return "$trimmedBaseUrl$normalizedPath"
  }

  $queryString = ($Query.GetEnumerator() |
      Sort-Object Name |
      ForEach-Object {
        "{0}={1}" -f `
          (ConvertTo-Rfc3986EncodedString -Value ([string]$_.Key)), `
          (ConvertTo-Rfc3986EncodedString -Value ([string]$_.Value))
      }) -join "&"

  return "$trimmedBaseUrl$normalizedPath`?$queryString"
}

function Invoke-NetSuiteRestRequest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("GET", "POST", "PATCH", "PUT", "DELETE")]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Config,
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [hashtable]$Query,
    [hashtable]$Headers,
    [AllowNull()]
    [object]$Body,
    [string]$ContentType = "application/json"
  )

  $requestUrl = New-NetSuiteUrl -BaseUrl $Config.BaseUrl -Path $Path -Query $Query
  $authorizationHeader = New-NetSuiteAuthorizationHeader `
    -Method $Method `
    -Url $requestUrl `
    -Realm $Config.AccountId `
    -ConsumerKeyValue $Config.ConsumerKey `
    -ConsumerSecretValue $Config.ConsumerSecret `
    -TokenIdValue $Config.TokenId `
    -TokenSecretValue $Config.TokenSecret

  $requestHeaders = @{
    Authorization = $authorizationHeader
    Accept        = "application/json"
  }

  if ($Headers) {
    foreach ($key in $Headers.Keys) {
      $requestHeaders[$key] = [string]$Headers[$key]
    }
  }

  $invokeParams = @{
    Uri                = $requestUrl
    Method             = $Method
    Headers            = $requestHeaders
    MaximumRedirection = 5
    UseBasicParsing    = $true
  }

  if ($PSBoundParameters.ContainsKey("Body")) {
    $bodyText = if ($Body -is [string]) {
      $Body
    }
    else {
      $Body | ConvertTo-Json -Depth 10
    }

    $invokeParams.Body = $bodyText
    $invokeParams.ContentType = $ContentType
  }

  try {
    $response = Invoke-WebRequest @invokeParams
  }
  catch {
    $errorDetail = Get-HttpErrorDetail -ErrorRecord $_
    $statusLabel = if ($null -eq $errorDetail.StatusCode) { "NETWORK" } else { [string]$errorDetail.StatusCode }
    $bodySuffix = if ([string]::IsNullOrWhiteSpace($errorDetail.Body)) {
      ""
    }
    else {
      "`nResponse body:`n$($errorDetail.Body)"
    }

    throw "NetSuite REST request failed. HTTP ${statusLabel}: $($errorDetail.Message)$bodySuffix"
  }

  $contentTypeHeader = if ($response.Headers["Content-Type"]) { [string]$response.Headers["Content-Type"] } else { "" }
  $json = $null

  if ($response.Content -and ($contentTypeHeader -match "json" -or $response.Content.TrimStart().StartsWith("{") -or $response.Content.TrimStart().StartsWith("["))) {
    try {
      $json = $response.Content | ConvertFrom-Json
    }
    catch {
      $json = $null
    }
  }

  return [pscustomobject]@{
    Url        = $requestUrl
    StatusCode = [int]$response.StatusCode
    Headers    = $response.Headers
    Content    = $response.Content
    Json       = $json
  }
}

Export-ModuleMember -Function Get-NetSuiteConfig, Invoke-NetSuiteRestRequest, New-NetSuiteUrl
