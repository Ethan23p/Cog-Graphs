@echo off
REM Windows counterpart of ./cog-graphs — see that file for why the shim exists.
if defined COG_CLI_ENTRY (
  bun "%COG_CLI_ENTRY%" %*
) else (
  bun "%~dp0..\engine\main.ts" %*
)
