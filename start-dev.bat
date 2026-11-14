@echo off
rem Starts the development version of the piano on Windows: double-click this file.
rem This version shows a change to the app's code at once, without compiling.
rem start-release.bat starts the compiled version, which answers a key press faster.
rem The first start downloads what the app needs. After that it starts in a few seconds.
setlocal
cd /d "%~dp0"
title Piano (development)

rem Both versions use this address, so the browser keeps the same settings and songs for both.
set "PAGE=http://localhost:5173"

rem ---- Node.js runs the app ----
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo.
  echo Get it from https://nodejs.org and install it. Take the version marked LTS.
  echo Then start this file again.
  goto :stopped
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Your Node.js is too old for this app. It needs version 22 or newer.
  echo.
  echo Get the newest one from https://nodejs.org and install it. Take the version marked LTS.
  echo Then start this file again.
  goto :stopped
)

rem ---- Already running? Then only open the page ----
curl.exe -s -m 3 "%PAGE%/" 2>nul | findstr /c:"/src/main.tsx" >nul
if not errorlevel 1 (
  echo The piano is already running. Opening it in your browser...
  start "" "%PAGE%"
  rem A two-second wait, so that the line above can be read.
  "%SystemRoot%\System32\ping.exe" -n 3 127.0.0.1 >nul
  exit /b 0
)
curl.exe -s -m 3 "%PAGE%/" 2>nul | findstr /c:"/assets/index-" >nul
if not errorlevel 1 (
  echo The piano is already running in its release version.
  echo.
  echo Close its window, then start this file again.
  goto :stopped
)
curl.exe -s -m 3 -o nul "%PAGE%/" 2>nul
if not errorlevel 1 (
  echo Another program is using the address the piano needs: %PAGE%
  echo.
  echo Close that program, then start this file again.
  goto :stopped
)

rem ---- The first start downloads what the app needs ----
if not exist "node_modules\" (
  echo First start: downloading what the app needs. This takes a minute or two.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo The download did not work. Check your internet connection,
    echo then start this file again.
    goto :stopped
  )
)

echo.
echo Starting the piano. Your browser opens by itself in a moment.
echo.
echo   Keep this window open while you play.
echo   To stop the piano, close this window.
echo.
call npm run dev -- --open
echo.
echo The piano has stopped.

:stopped
echo.
pause
exit /b 1
