$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$env:ROBOT_ENABLE_SERIAL = "0"
$env:ROBOT_AGENT_PORT = if ($env:ROBOT_AGENT_PORT) { $env:ROBOT_AGENT_PORT } else { "53123" }

.\run_demo.ps1
