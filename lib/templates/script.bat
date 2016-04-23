@echo off

set NAME=<PACMAN.NAME>
set VERSION=<PACMAN.VERSION>
set SHARE=<PACMAN.SHARE>
set ACTION=<PACMAN.ACTION>
set SYSROOT=<PACMAN.SYSROOT>
set CONFIG=<PACMAN.CONFIG>
if [%1]==[cmake] (
  set CMAKE_BINARY_DIR="%2"
) else (
  set CMAKE_BINARY_DIR=
)

for /f "delims=" %%i in ('node -e "process.stdout.write (require ('path').resolve (__dirname, '%SYSROOT%', require (require ('path').resolve (__dirname, '%SYSROOT%', '%CONFIG%')).bin));"') do set PEON=%%i

if [%NAME%]==[] set NAME="%2"
if [%VERSION%]==[] set VERSION="%3"

node "%PEON%" "%CD%" "%SHARE%" %ACTION% "%CMAKE_BINARY_DIR%" "%NAME%" "%VERSION%"
