param(
  [switch]$Restart,
  [switch]$NoPrompt,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Get-DemoPython {
  $bundledPython = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path -LiteralPath $bundledPython) {
    return $bundledPython
  }
  return (Get-Command python -ErrorAction Stop).Source
}

$port = if ($env:ROBOT_AGENT_PORT) { $env:ROBOT_AGENT_PORT } else { "53123" }
$url = "http://127.0.0.1:$port/"
$pidPath = Join-Path $root "server.pid"
$out = Join-Path $root "server.log"
$err = Join-Path $root "server.err.log"

if ($Restart -and (Test-Path -LiteralPath $pidPath)) {
  $oldPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
  if ($oldPid) {
    $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($oldProcess) {
      Stop-Process -Id $oldPid -Force
      Start-Sleep -Milliseconds 300
    }
  }
}

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
  $env:ROBOT_ENABLE_SERIAL = "0"
  $env:ROBOT_AGENT_PORT = $port

  if (-not $env:ELEVENLABS_API_KEY -and -not $NoPrompt) {
    $secureKey = Read-Host "Paste ElevenLabs API key for this run only, or press Enter for browser fallback" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
      $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if ($key.Trim()) {
      $env:ELEVENLABS_API_KEY = $key.Trim()
    }
  }

  Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
  $python = Get-DemoPython
  $process = Start-Process -FilePath $python -ArgumentList "-u", "robot_agent_demo.py" -WorkingDirectory $root -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  $process.Id | Set-Content -LiteralPath $pidPath
}

$status = $null
$statusUri = "$($url)api/status"
for ($i = 0; $i -lt 20; $i++) {
  try {
    $status = Invoke-RestMethod -Uri $statusUri -TimeoutSec 2
    break
  } catch {
    Start-Sleep -Milliseconds 300
  }
}

if (-not $status) {
  Write-Host "Demo server did not answer. Recent error log:" -ForegroundColor Yellow
  Get-Content -LiteralPath $err -ErrorAction SilentlyContinue | Select-Object -Last 20
  exit 1
}

[PSCustomObject]@{
  URL = $status.url
  TTS = $status.tts
  LLM = $status.llm
  SerialEnabled = $status.serial_enabled
  SerialRequested = $status.serial_requested
  VoiceFX = $status.robotic_audio_effect
} | Format-List

if (-not $NoOpen) {
  Start-Process $url
}
