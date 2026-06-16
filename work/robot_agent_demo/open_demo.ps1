$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = if ($env:ROBOT_AGENT_PORT) { $env:ROBOT_AGENT_PORT } else { "53123" }
$url = "http://127.0.0.1:$port/"
$pidPath = Join-Path $root "server.pid"
$running = $false

if (Test-Path -LiteralPath $pidPath) {
  $pidValue = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
  if ($pidValue) {
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process) {
      $running = $true
    }
  }
}

if (-not $running) {
  Write-Host "Demo server is not running. Starting speaker-only mode..."
  $env:ROBOT_ENABLE_SERIAL = "0"
  $env:ROBOT_AGENT_PORT = $port

  $bundledPython = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  $python = if (Test-Path -LiteralPath $bundledPython) {
    $bundledPython
  } else {
    (Get-Command python -ErrorAction Stop).Source
  }

  $out = Join-Path $root "server.log"
  $err = Join-Path $root "server.err.log"
  Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $python -ArgumentList "-u", "robot_agent_demo.py" -WorkingDirectory $root -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  $process.Id | Set-Content -LiteralPath $pidPath
  Start-Sleep -Seconds 2
}

Write-Host "Opening $url"
Start-Process $url
