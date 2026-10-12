param([switch]$NoBrowser, [switch]$LocalOnly)
$ErrorActionPreference = 'Stop'
$denRoot = $PSScriptRoot
$denProbeUrl = 'http://127.0.0.1:4317'
$denBindHost = if ($LocalOnly) { '127.0.0.1' } else { '0.0.0.0' }
$denData = Join-Path $denRoot 'data'
$denScript = Join-Path $denRoot 'server.mjs'
$denNode = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $denRoot 'node_modules/pdfjs-dist/build/pdf.mjs'))) {
    throw 'PDF.js is missing. In this folder, run npm install, then start The Den again.'
}
$denCurrent = $null
try { $denCurrent = Invoke-RestMethod -Uri "$denProbeUrl/api/status" -TimeoutSec 3 } catch {}
if ($denCurrent) {
    if ($denCurrent.app -ne 'the-den' -or [IO.Path]::GetFullPath($denCurrent.project) -ne [IO.Path]::GetFullPath($denRoot)) {
        throw 'Port 4317 belongs to another application or another copy of The Den. No process was changed.'
    }
    if ($denCurrent.host -ne $denBindHost) {
        throw "This copy is already listening on $($denCurrent.host). Run Stop The Den.cmd, then start it again to listen on $denBindHost."
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
    $env:DEN_HOST = $denBindHost
    $denProcess = Start-Process -FilePath $denNode -ArgumentList @(('"' + $denScript + '"')) -WorkingDirectory $denRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $denData 'server.log') -RedirectStandardError (Join-Path $denData 'server-error.log')
    $denReady = $false
    for ($denAttempt = 0; $denAttempt -lt 35; $denAttempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $denCurrent = Invoke-RestMethod -Uri "$denProbeUrl/api/status" -TimeoutSec 2
            if ($denCurrent.app -eq 'the-den' -and [IO.Path]::GetFullPath($denCurrent.project) -eq [IO.Path]::GetFullPath($denRoot) -and $denCurrent.host -eq $denBindHost) { $denReady = $true; break }
        } catch {}
        if ($denProcess.HasExited) { break }
    }
    if (-not $denReady) { throw "The Den did not start. Read $denData/server-error.log for details." }
}
$denNetworkUrls = @($denCurrent.urls | Where-Object { $_ -ne $denProbeUrl })
$denBrowserUrl = if ($denNetworkUrls.Count -gt 0) { $denNetworkUrls[0] } else { $denProbeUrl }
if ($denNetworkUrls.Count -gt 1) {
    # Prefer the connected network's gateway over VM and container adapters.
    try {
        $denPreferredUrl = Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
            ForEach-Object { $_.IPv4Address | ForEach-Object { "http://$($_.IPAddress):4317" } } |
            Where-Object { $denNetworkUrls -contains $_ } |
            Select-Object -First 1
        if ($denPreferredUrl) { $denBrowserUrl = $denPreferredUrl }
    } catch {}
}
Write-Host "The Den is listening on ${denBindHost}:4317"
Write-Host "Open The Den: $denBrowserUrl"
foreach ($denAddress in $denNetworkUrls) {
    Write-Host "Network address: $denAddress"
}
if ($denBindHost -eq '0.0.0.0' -and $denNetworkUrls.Count -eq 0) {
    Write-Host 'No network address is available yet. This PC can still open The Den locally.'
}
if (-not $NoBrowser) { Start-Process -FilePath $denBrowserUrl -WindowStyle Hidden }
