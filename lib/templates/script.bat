@echo off

set NAME=<PACMAN.NAME>
set VERSION=<PACMAN.VERSION>
set SHARE=<PACMAN.SHARE>
set HOOK=<PACMAN.HOOK>
set ACTION=<PACMAN.ACTION>
set SYSROOT=<PACMAN.SYSROOT>
set CONFIG=<PACMAN.CONFIG>
set WPKGACT="%1"
if [%1]==[cmake] (
  set CMAKE_BINARY_DIR="%2"
) else (
  set CMAKE_BINARY_DIR=
)

if not exist "%CONFIG%" exit 0

for /f "delims=" %%i in ('node -e "process.stdout.write (require ('path').resolve (__dirname, '%SYSROOT%', require (require ('path').resolve (__dirname, '%CONFIG%')).bin));"') do set PEON=%%i

if [%NAME%]==[] set NAME="%2"
if [%VERSION%]==[] set VERSION="%3"

node "%PEON%" "%CD%" "%SHARE%" "%HOOK%" %ACTION% "%WPKGACT%" "%CMAKE_BINARY_DIR%" "%NAME%" "%VERSION%"
