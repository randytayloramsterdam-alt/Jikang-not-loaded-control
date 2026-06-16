$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidPath = Join-Path $root "server.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host "No server.pid found."
  exit 0
}

$pidValue = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
if (-not $pidValue) {
  Write-Host "server.pid is empty."
  exit 0
}

$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $pidValue -Force
  Write-Host "Stopped demo server PID $pidValue"
} else {
  Write-Host "No running process for PID $pidValue"
}
