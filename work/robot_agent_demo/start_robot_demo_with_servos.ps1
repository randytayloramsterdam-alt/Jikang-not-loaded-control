param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$serialPort = if ($env:ROBOT_SERIAL_PORT) { $env:ROBOT_SERIAL_PORT } else { "COM11" }
$agentPort = if ($env:ROBOT_AGENT_PORT) { $env:ROBOT_AGENT_PORT } else { "53123" }
$availablePorts = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object

Write-Host "Robot servo mode preflight"
Write-Host "  Serial port: $serialPort"
Write-Host "  Agent port:  $agentPort"
Write-Host "  Available serial ports: $($availablePorts -join ', ')"
Write-Host ""
Write-Host "Safety requirements before continuing:"
Write-Host "  1. PCA9685 servo power is separate from UNO R4 logic power."
Write-Host "  2. UNO R4 GND, PCA9685 GND, and servo power GND are common."
Write-Host "  3. The Arduino sketch has been uploaded and reports safe boot."
Write-Host "  4. Manual one-channel tests have moved safely."
Write-Host "  5. No linkage is binding at center, left/right, blink, or jaw positions."
Write-Host ""

if ($availablePorts -notcontains $serialPort) {
  Write-Host "Warning: $serialPort was not found in the current serial-port list." -ForegroundColor Yellow
}

if ($DryRun) {
  Write-Host "Dry run only. Servo mode was not started and serial was not enabled."
  exit 0
}

if (-not $Force) {
  $confirm = Read-Host "Type ENABLE_SERVOS to start real serial control"
  if ($confirm -ne "ENABLE_SERVOS") {
    Write-Host "Servo mode cancelled."
    exit 1
  }
}

$env:ROBOT_ENABLE_SERIAL = "1"
$env:ROBOT_SERIAL_PORT = $serialPort
$env:ROBOT_AGENT_PORT = $agentPort

.\run_demo.ps1
