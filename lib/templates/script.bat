@echo off

set NAME=<PACMAN.NAME>
set VERSION=<PACMAN.VERSION>
set SHARE=<PACMAN.SHARE>
set HOOK=<PACMAN.HOOK>
set ACTION=<PACMAN.ACTION>
set SYSROOT=<PACMAN.SYSROOT>
set DISTRIBUTION=<PACMAN.DISTRIBUTION>
set WPKGACT="%1"

where xcraft-peon.bat >nul 2>nul
if not errorlevel 0 (
  if [%HOOK%]==[global] exit 0
  @echo xcraft-peon is mandatory but not available in PATH
  exit 1
)

if [%1]==[cmake] (
  set CMAKE_BINARY_DIR="%2"
) else (
  set CMAKE_BINARY_DIR=
)
if [%NAME%]==[] set NAME="%2"
if [%VERSION%]==[] set VERSION="%3"

set _DISTRIBUTION=%DISTRIBUTION:~1,-1%
if [%_DISTRIBUTION%]==[PACMAN.DISTRIBUTION] set DISTRIBUTION="%PEON_DISTRIBUTION%"

xcraft-peon.bat "%CD%" "%SHARE%" "%HOOK%" %ACTION% "%WPKGACT%" "%CMAKE_BINARY_DIR%" "%NAME%" "%VERSION%" "%SYSROOT%" "%DISTRIBUTION%"
