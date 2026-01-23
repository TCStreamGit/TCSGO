@echo off
setlocal enabledelayedexpansion

REM Must Run As Administrator
REM Creates A Startup Task That Runs The Refresher In --daemon Mode (Schedule Is Read From Config)

set TASK_NAME=TCSGO Price Refresher
set REPO_BASE=A:\Development\Version Control\Github\TCSGO
set PY_EXE=python

set SCRIPT=%REPO_BASE%\services\price-refresher.py
set CFG=services\price-refresher-config.json

if not exist "%SCRIPT%" (
  echo Script Not Found: "%SCRIPT%"
  exit /b 2
)

schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if %errorlevel%==0 (
  echo Existing Task Found; Deleting: "%TASK_NAME%"
  schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
)

echo Creating Scheduled Task: "%TASK_NAME%"
schtasks /Create ^
  /TN "%TASK_NAME%" ^
  /SC ONSTART ^
  /DELAY 0000:30 ^
  /RL HIGHEST ^
  /RU SYSTEM ^
  /TR "\"%PY_EXE%\" \"%SCRIPT%\" --config \"%CFG%\" --daemon" ^
  /F

if %errorlevel%==0 (
  echo Task Created Successfully.
  exit /b 0
) else (
  echo Failed To Create Task.
  exit /b 1
)
