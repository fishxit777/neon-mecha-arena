$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$localUrl = "http://127.0.0.1:$port"
$cloudflared = Join-Path $projectRoot ".local-tools\cloudflared.exe"
$urlFile = Join-Path $projectRoot "tmp\public-https-url.txt"

$processes = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*--url*$localUrl*" -or $_.ExecutablePath -eq $cloudflared }

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $urlFile -Force -ErrorAction SilentlyContinue

Write-Host "Public HTTPS tunnel stopped."
