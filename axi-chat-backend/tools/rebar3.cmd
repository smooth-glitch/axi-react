@echo off
setlocal
set ERL_BIN=C:\Program Files\Erlang OTP\bin
if exist "%ERL_BIN%\escript.exe" set PATH=%ERL_BIN%;%PATH%
escript.exe "%~dp0rebar3" %*
