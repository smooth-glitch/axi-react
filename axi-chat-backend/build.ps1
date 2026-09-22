# Compiles all modules via rebar3 (fetches eredis from Hex on first run).
# Run this after any src/ change.
$ErrorActionPreference = "Stop"

$erlBin = "C:\Program Files\Erlang OTP\bin"
if (Test-Path "$erlBin\erl.exe") { $env:PATH = "$erlBin;" + $env:PATH }

$root = $PSScriptRoot
Set-Location $root
& ".\tools\rebar3.cmd" compile
if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }
Write-Host "Build OK -> $root\_build\default\lib\axi_chat_backend\ebin"
