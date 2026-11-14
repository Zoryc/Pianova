@echo off
rem Starts the release version of the piano on Windows: double-click this file.
rem The release version is the compiled app. It answers a key press faster than the
rem development version, but it shows a change to the app's code only after
rem compile.bat has run again. start-dev.bat starts the development version.
setlocal
cd /d "%~dp0"
title Piano

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
curl.exe -s -m 3 "%PAGE%/" 2>nul | findstr /c:"/assets/index-" >nul
if not errorlevel 1 (
  echo The piano is already running. Opening it in your browser...
  start "" "%PAGE%"
  rem A two-second wait, so that the line above can be read.
  "%SystemRoot%\System32\ping.exe" -n 3 127.0.0.1 >nul
  exit /b 0
)
curl.exe -s -m 3 "%PAGE%/" 2>nul | findstr /c:"/src/main.tsx" >nul
if not errorlevel 1 (
  echo The piano is already running in its development version.
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

rem ---- Not compiled yet? Then compile first ----
if exist "dist\index.html" goto :compiled
echo The piano is not compiled yet: compiling it first. This takes a few seconds.
echo.
call npx vite build
if errorlevel 1 (
  echo.
  echo The compiling did not work: the lines above say why.
  echo start-dev.bat starts the piano without compiling.
  goto :stopped
)
goto :start

rem ---- Compiled before the code last changed? Then say so, and start it as it is ----
:compiled
node -e "const fs=require('fs');const built=fs.statSync('dist/index.html').mtimeMs;const files=['index.html','package.json','vite.config.ts'].concat(fs.readdirSync('src',{recursive:true}).map((f)=>'src/'+f));process.exit(files.some((f)=>!f.includes('.test.')&&fs.existsSync(f)&&fs.statSync(f).mtimeMs>built)?1:0)"
if errorlevel 1 (
  echo The app's code has changed since the piano was last compiled.
  echo This starts the version compiled before.
  echo To bring it up to date, run compile.bat and reload the page.
)

:start
echo.
echo Starting the piano. Your browser opens by itself in a moment.
echo.
echo   Keep this window open while you play.
echo   To stop the piano, close this window.
echo.
call npx vite preview --port 5173 --strictPort --open
echo.
echo The piano has stopped.

:stopped
echo.
pause
exit /b 1
