# Starts the chat server. Usage: .\run.ps1 [tcpPort] [webPort]
# Defaults: TCP 5555, Web/WebSocket http://localhost:8080
# Needs a Redis instance reachable at REDIS_HOST:REDIS_PORT (defaults to
# 127.0.0.1:6379, no password) -- see chat_redis.erl.
$ErrorActionPreference = "Stop"

function Find-Erl {
    $cmd = Get-Command erl.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidate = "C:\Program Files\Erlang OTP\bin\erl.exe"
    if (Test-Path $candidate) { return $candidate }
    throw "erl.exe not found. Install Erlang/OTP from https://www.erlang.org/downloads (free) or add it to PATH."
}

$tcpPort = if ($args.Count -ge 1) { $args[0] } else { "5555" }
$webPort = if ($args.Count -ge 2) { $args[1] } else { "8080" }
$erl = Find-Erl
$root = $PSScriptRoot

$appEbin = "$root\_build\default\lib\axi_chat_backend\ebin"
$eredisEbin = "$root\_build\default\lib\eredis\ebin"
if (-not (Test-Path $appEbin)) {
    throw "Not built yet -- run .\build.ps1 first."
}

& $erl -noshell -pa $appEbin -pa $eredisEbin -s chat_app start $tcpPort $webPort
