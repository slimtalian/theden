$ErrorActionPreference = 'Stop'
$denRoot = $PSScriptRoot
$denRecordPath = Join-Path $denRoot 'data/server.json'
if (-not (Test-Path -LiteralPath $denRecordPath)) { Write-Host 'The Den has no recorded running process.'; exit 0 }
$denRecord = Get-Content -LiteralPath $denRecordPath -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($denRecord.project) -ne [IO.Path]::GetFullPath($denRoot)) { throw 'The process record belongs to another project. Nothing was stopped.' }
$denPid = [int]$denRecord.pid
$denProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $denPid"
if (-not $denProcess) { Write-Host 'The Den is already stopped.'; exit 0 }
$denExpected = Join-Path $denRoot 'server.mjs'
if ($denProcess.Name -ne 'node.exe' -or -not $denProcess.CommandLine.Contains($denExpected)) { throw 'The recorded process does not match The Den. Nothing was stopped.' }
Stop-Process -Id $denPid
Write-Host 'The Den has stopped. Your books and reading positions remain in the data folder.'
