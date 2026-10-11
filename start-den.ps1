param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$denRoot = $PSScriptRoot
$denUrl = 'http://127.0.0.1:4317'
$denData = Join-Path $denRoot 'data'
$denScript = Join-Path $denRoot 'server.mjs'
$denNode = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $denRoot 'node_modules/pdfjs-dist/build/pdf.mjs'))) {
    throw 'PDF.js is missing. In this folder, run npm install, then start The Den again.'
}
$denCurrent = $null
try { $denCurrent = Invoke-RestMethod -Uri "$denUrl/api/status" -TimeoutSec 3 } catch {}
if ($denCurrent) {
    if ($denCurrent.app -ne 'the-den' -or [IO.Path]::GetFullPath($denCurrent.project) -ne [IO.Path]::GetFullPath($denRoot)) {
        throw 'Port 4317 belongs to another application or another copy of The Den. No process was changed.'
    }
} else {
    $denListener = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue
    if ($denListener) { throw 'Port 4317 is already in use. Check the process using it; no process was changed.' }
    New-Item -ItemType Directory -Force -Path $denData | Out-Null
    foreach ($denName in @('server.log', 'server-error.log')) {
        $denLog = Join-Path $denData $denName
        if (Test-Path -LiteralPath $denLog) { Copy-Item -LiteralPath $denLog -Destination "$denLog.previous" -Force }
    }
    $env:DEN_PORT = '4317'
    $denProcess = Start-Process -FilePath $denNode -ArgumentList @(('"' + $denScript + '"')) -WorkingDirectory $denRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $denData 'server.log') -RedirectStandardError (Join-Path $denData 'server-error.log')
    $denReady = $false
    for ($denAttempt = 0; $denAttempt -lt 35; $denAttempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $denCurrent = Invoke-RestMethod -Uri "$denUrl/api/status" -TimeoutSec 2
            if ($denCurrent.app -eq 'the-den' -and [IO.Path]::GetFullPath($denCurrent.project) -eq [IO.Path]::GetFullPath($denRoot)) { $denReady = $true; break }
        } catch {}
        if ($denProcess.HasExited) { break }
    }
    if (-not $denReady) { throw "The Den did not start. Read $denData/server-error.log for details." }
}
Write-Host "The Den is running at $denUrl"
foreach ($denAddress in $denCurrent.urls) {
    if ($denAddress -ne $denUrl) { Write-Host "Network address: $denAddress" }
}
if (-not $NoBrowser) { Start-Process -FilePath $denUrl -WindowStyle Hidden }
