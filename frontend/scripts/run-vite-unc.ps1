param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [Parameter(Mandatory = $true)]
  [string]$NodeExecutable,
  [Parameter(Mandatory = $true)]
  [string]$ViteArgsBase64
)

$ErrorActionPreference = 'Stop'

$decodedArgsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ViteArgsBase64))
$viteArgs = if ([string]::IsNullOrWhiteSpace($decodedArgsJson)) {
  @()
} else {
  ConvertFrom-Json -InputObject $decodedArgsJson
}

if ($null -eq $viteArgs) {
  $viteArgs = @()
} elseif ($viteArgs -isnot [Array]) {
  $viteArgs = @($viteArgs)
}

$quotedArgs = @($viteArgs | ForEach-Object {
    $value = [string]$_
    if ($value -match '[\s"]') {
      '"' + $value.Replace('"', '""') + '"'
    } else {
      $value
    }
  })

$command = 'pushd "' + $ProjectRoot + '" && "' + $NodeExecutable + '" "node_modules\vite\bin\vite.js"'
if ($quotedArgs.Count -gt 0) {
  $command += ' ' + ($quotedArgs -join ' ')
}
$command += ' && popd'

cmd /d /s /c $command
exit $LASTEXITCODE
