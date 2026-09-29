$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $projectRoot 'backend'
$frontendDirectory = Join-Path $projectRoot 'frontend'
$pythonExecutable = Join-Path $backendDirectory '.venv\Scripts\python.exe'
$viteEntry = Join-Path $frontendDirectory 'node_modules\vite\bin\vite.js'
$logDirectory = Join-Path $projectRoot 'logs'

if (!(Test-Path -LiteralPath $pythonExecutable) -or !(Test-Path -LiteralPath $viteEntry)) {
    throw 'Install the backend and frontend dependencies first. See README.md.'
}
foreach ($port in @(8000, 5173)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop the existing server before launching another copy."
    }
}
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$backendProcess = $null
$frontendProcess = $null
try {
    $backendProcess = Start-Process -FilePath $pythonExecutable -ArgumentList @('-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000') -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'backend.log') -RedirectStandardError (Join-Path $logDirectory 'backend-error.log')
    $frontendProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"' + $viteEntry + '"'), '--host', '127.0.0.1', '--port', '5173') -WorkingDirectory $frontendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'frontend.log') -RedirectStandardError (Join-Path $logDirectory 'frontend-error.log')
    Write-Host 'Wattwise: http://127.0.0.1:5173' -ForegroundColor Green
    Write-Host 'API docs: http://127.0.0.1:8000/docs'
    Write-Host 'Press Ctrl+C to stop both services. Logs are in logs/.'
    while (!$backendProcess.HasExited -and !$frontendProcess.HasExited) {
        Start-Sleep -Seconds 1
        $backendProcess.Refresh()
        $frontendProcess.Refresh()
    }
    throw 'A server exited. Check logs/backend-error.log and logs/frontend-error.log.'
}
finally {
    foreach ($process in @($backendProcess, $frontendProcess)) {
        if ($null -ne $process -and !$process.HasExited) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
}
