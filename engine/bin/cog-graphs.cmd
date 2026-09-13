@echo off
rem cog-graphs launcher for cmd and PowerShell. Runs the engine on Bun (https://bun.sh).
bun "%~dp0..\main.ts" %*
