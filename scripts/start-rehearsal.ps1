param(
  [int]$Port = 3000,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
}

$ipCandidates = Get-NetIPConfiguration |
  Where-Object {
    $_.IPv4Address -and
    $_.NetAdapter.Status -eq "Up" -and
    $_.IPv4Address.IPAddress -notlike "127.*" -and
    $_.IPv4Address.IPAddress -notlike "169.254.*"
  } |
  Sort-Object { $_.NetAdapter.InterfaceMetric }

$lanIp = $null
foreach ($candidate in $ipCandidates) {
  $lanIp = $candidate.IPv4Address.IPAddress
  if ($lanIp) { break }
}

if (-not $lanIp) {
  $lanIp = "127.0.0.1"
}

$lanOrigin = "http://$lanIp`:$Port"
$localOrigin = "http://localhost:$Port"
$loopbackOrigin = "http://127.0.0.1:$Port"

$env:PORT = "$Port"
$env:PUBLIC_ORIGIN = "$lanOrigin,$localOrigin,$loopbackOrigin"

if (-not $env:ADMIN_TOKEN) {
  $env:ADMIN_TOKEN = "dev-admin-token-change-me"
}

Write-Host ""
Write-Host "TikTok LIVE PVP rehearsal server" -ForegroundColor Cyan
Write-Host "Admin (PC / phone same Wi-Fi): $lanOrigin/admin" -ForegroundColor Green
Write-Host "Local admin: $localOrigin/admin" -ForegroundColor Green
Write-Host "Health: $lanOrigin/healthz" -ForegroundColor Green
Write-Host ""
Write-Host "Important:" -ForegroundColor Yellow
Write-Host "- Open Admin with the LAN URL when generating QR codes for phones."
Write-Host "- Phone and PC must be on the same Wi-Fi/LAN."
Write-Host "- If the phone cannot open the URL, allow Node.js through Windows Firewall on Private networks."
Write-Host ""

if ($DryRun) {
  [pscustomobject]@{
    Port = $Port
    LanIp = $lanIp
    AdminUrl = "$lanOrigin/admin"
    LocalAdminUrl = "$localOrigin/admin"
    PublicOrigin = $env:PUBLIC_ORIGIN
  }
  return
}

npm run dev
