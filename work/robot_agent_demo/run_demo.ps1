$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$bundledPython = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$python = if (Test-Path -LiteralPath $bundledPython) {
  $bundledPython
} else {
  (Get-Command python -ErrorAction Stop).Source
}

if (-not $env:ELEVENLABS_API_KEY) {
  Write-Host "ELEVENLABS_API_KEY is not set. ElevenLabs TTS will fall back to browser speech." -ForegroundColor Yellow
}

if (-not $env:ROBOT_SERIAL_PORT) {
  $env:ROBOT_SERIAL_PORT = "COM11"
}

if (-not $env:ROBOT_AGENT_PORT) {
  $env:ROBOT_AGENT_PORT = "53123"
}

& $python -u .\robot_agent_demo.py
