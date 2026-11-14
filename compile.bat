@echo off
rem Compiles the piano on Windows: double-click this file.
rem It makes the release version, the one start-release.bat starts.
rem Run it again after the app's code has changed, to bring the release version up to date.
setlocal
cd /d "%~dp0"
title Piano - compiling

rem ---- Node.js compiles the app ----
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

rem ---- The first time, download what the app needs ----
if not exist "node_modules\" (
  echo First time: downloading what the app needs. This takes a minute or two.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo The download did not work. Check your internet connection,
    echo then start this file again.
    goto :stopped
  )
)

echo Compiling the piano. This takes a few seconds.
echo.
rem Like the development version, this does not stop for a type error in the code.
call npx vite build
if errorlevel 1 (
  echo.
  echo The compiling did not work: the lines above say why.
  echo The release version is as it was before.
  goto :stopped
)

echo.
echo Done. start-release.bat starts this version.
echo If the release version is running now, reload its page in the browser.
echo.
pause
exit /b 0

:stopped
echo.
pause
exit /b 1
