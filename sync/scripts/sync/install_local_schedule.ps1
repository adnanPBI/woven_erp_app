param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$envFile = Join-Path $repoRoot 'local_data/sync_package/local.env.sync'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$settingsText = Get-Content -LiteralPath $envFile -Raw
if ($settingsText -notmatch '(?m)^DB_NAME="?weavonpq_weaving_sep22_preview"?\r?$' -or
    $settingsText -notmatch '(?m)^SYNC_ENABLED=true\r?$') {
    throw 'The preview sync must be configured and explicitly enabled first.'
}
$status = Get-Content -LiteralPath (Join-Path $repoRoot 'local_data/sync_preview/status.json') -Raw | ConvertFrom-Json
if ($status.database -ne 'weavonpq_weaving_sep22_preview' -or $status.status -notin @('completed','unchanged')) {
    throw 'Complete a successful manual local sync before installing the schedule.'
}
$taskName = 'Weaving ERP - Local Google Sheets Sync'
$launcher = Join-Path $PSScriptRoot 'local_scheduled_sync.ps1'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}" -EnvFile "{2}"' -f $launcher,$nodePath,$envFile
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notcontains $arguments) {
    throw 'A differently configured task already uses this name; refusing to overwrite it.'
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local preview only: Google Sheets inserts and edits every ten minutes while this Windows user is signed in.' -Force | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime,LastTaskResult,NextRunTime
