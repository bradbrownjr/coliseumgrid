@echo off
rem Starts ColiseumGrid with the Node runtime in this folder (docs/PLAN.md, section 8).
rem %~dp0 is this file's drive and folder, ending in a backslash
rem (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/call).
rem After an error the window waits for a key, so the message can be read before it closes.
title ColiseumGrid
"%~dp0node\node.exe" "%~dp0app\packages\server\src\launcher.ts" %*
if errorlevel 1 pause
