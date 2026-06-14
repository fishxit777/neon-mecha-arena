$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$localUrl = "http://127.0.0.1:$port"
$toolsDir = Join-Path $projectRoot ".local-tools"
$tmpDir = Join-Path $projectRoot "tmp"
$logsDir = Join-Path $projectRoot "logs"
$cloudflared = Join-Path $toolsDir "cloudflared.exe"
$tunnelOut = Join-Path $logsDir "cloudflared-public.out.log"
$tunnelErr = Join-Path $logsDir "cloudflared-public.err.log"
$serverOut = Join-Path $logsDir "public-server.out.log"
$serverErr = Join-Path $logsDir "public-server.err.log"
$urlFile = Join-Path $tmpDir "public-https-url.txt"

New-Item -ItemType Directory -Force -Path $toolsDir, $tmpDir, $logsDir | Out-Null

function Test-Health {
  try {
    $health = Invoke-RestMethod -Uri "$localUrl/healthz" -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

function Wait-Health {
  param([int]$Seconds = 12)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Health) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Stop-ProjectTunnel {
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*--url*$localUrl*" -or $_.ExecutablePath -eq $cloudflared }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Health)) {
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList @("--env-file-if-exists=.env", "src/server.js") -WorkingDirectory $projectRoot -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
  if (-not (Wait-Health -Seconds 15)) {
    throw "Local server did not become healthy at $localUrl. Check $serverErr"
  }
}

if (-not (Test-Path $cloudflared)) {
  $downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflared
}

Stop-ProjectTunnel
Remove-Item -LiteralPath $tunnelOut, $tunnelErr, $urlFile -Force -ErrorAction SilentlyContinue

Start-Process -WindowStyle Hidden -FilePath $cloudflared -ArgumentList @("tunnel", "--url", $localUrl, "--no-autoupdate") -WorkingDirectory $projectRoot -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr

$publicUrl = $null
$deadline = (Get-Date).AddSeconds(35)
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Milliseconds 500
  $combined = ""
  if (Test-Path $tunnelOut) { $combined += Get-Content -Raw $tunnelOut -ErrorAction SilentlyContinue }
  if (Test-Path $tunnelErr) { $combined += "`n" + (Get-Content -Raw $tunnelErr -ErrorAction SilentlyContinue) }
  $match = [regex]::Match($combined, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
  if ($match.Success) { $publicUrl = $match.Value.TrimEnd("/") }
}

if (-not $publicUrl) {
  throw "Cloudflare Tunnel did not provide a public URL yet. Check $tunnelErr"
}

Set-Content -Path $urlFile -Value $publicUrl -Encoding UTF8

Write-Host ""
Write-Host "PUBLIC HTTPS READY"
Write-Host "Admin:      $publicUrl/admin"
Write-Host "Health:     $publicUrl/healthz"
Write-Host ""
Write-Host "Open the Admin URL above, create a session, then copy the TikTok Studio source from the admin page."
Write-Host "This trycloudflare URL changes whenever the tunnel is restarted."
