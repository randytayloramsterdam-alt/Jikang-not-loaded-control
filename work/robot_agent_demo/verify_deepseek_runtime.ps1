$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$bundledPython = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$python = if (Test-Path -LiteralPath $bundledPython) {
  $bundledPython
} else {
  (Get-Command python -ErrorAction Stop).Source
}

& $python .\verify_deepseek_runtime.py
