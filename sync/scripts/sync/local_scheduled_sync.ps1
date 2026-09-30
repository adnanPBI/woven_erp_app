param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$EnvFile
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$logDirectory = Join-Path $repoRoot 'local_data/sync_preview/scheduler_logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logFile = Join-Path $logDirectory ((Get-Date -Format 'yyyy-MM-dd') + '.log')
try {
    Set-Location -LiteralPath $repoRoot
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Configured Node runtime is missing' }
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "[$(Get-Date -Format o)] Scheduled local sync started"
    try {
        # Native stderr can contain warnings. Determine success from the exit
        # code, and use the same encoding for native output and our own lines.
        $ErrorActionPreference = 'Continue'
        & $NodePath (Join-Path $PSScriptRoot 'run.js') "--env=$EnvFile" --local 2>&1 | Out-File -LiteralPath $logFile -Append -Encoding UTF8 -ErrorAction Stop
        $result = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "[$(Get-Date -Format o)] Scheduled local sync exited $result"
    exit $result
} catch {
    Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "[$(Get-Date -Format o)] Scheduler error: $($_.Exception.Message)"
    exit 1
}
