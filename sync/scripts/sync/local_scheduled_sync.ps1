param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$EnvFile
)
$ErrorActionPreference = 'Stop'
try {
    Set-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Configured Node runtime is missing' }
    # Node owns bounded logs under SYNC_DATA_DIR/logs. Do not append a second,
    # unbounded copy of stdout in this scheduler wrapper.
    $ErrorActionPreference = 'Continue'
    & $NodePath (Join-Path $PSScriptRoot 'run.js') "--env=$EnvFile" --local
    exit $LASTEXITCODE
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
