$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$bundledPython = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$python = if (Test-Path -LiteralPath $bundledPython) {
  $bundledPython
} else {
  (Get-Command python -ErrorAction Stop).Source
}

function Run-PythonCheck {
  param([string[]]$Arguments)
  & $python @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Run-PythonCheck @("-m", "py_compile", ".\robot_agent_demo.py", ".\test_persona.py", ".\acceptance_check.py", ".\persona_training_eval.py", ".\verify_deepseek_runtime.py")
Run-PythonCheck @(".\persona_training_eval.py")
Run-PythonCheck @(".\verify_deepseek_runtime.py")
Run-PythonCheck @(".\test_persona.py")
Run-PythonCheck @(".\acceptance_check.py")

& powershell -NoProfile -ExecutionPolicy Bypass -File .\start_robot_demo_with_servos.ps1 -DryRun
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Speaker-only demo verification passed."
