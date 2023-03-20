@echo off

set "NAME=<PACMAN.NAME>"
set "SUBNAME=<PACMAN.SUBNAME>"
set "VERSION=<PACMAN.VERSION>"
set "SHARE=<PACMAN.SHARE>"
set "HOOK=<PACMAN.HOOK>"
set "ACTION=<PACMAN.ACTION>"
set "SYSROOT=<PACMAN.SYSROOT>"
set "DISTRIBUTION=<PACMAN.DISTRIBUTION>"
set WPKGACT="%1"

set found=0
for %%x in (xcraft-peon.bat) do if not [%%~$PATH:x]==[] set found=1
if [%found%]==[0] (
  if [%HOOK%]==[global] exit 0
  @echo xcraft-peon is mandatory but not available in PATH
  exit 1
)

if [%1]==[cmake] (
  set CMAKE_BINARY_DIR="%2"
) else (
  set CMAKE_BINARY_DIR=
)


if not "[%SUBNAME%]"=="[]" (
  set "_SUBNAME=%SUBNAME:<=%"
  set "_SUBNAME=%_SUBNAME:>=%"
)
if not [%_SUBNAME%]==[] if not [%_SUBNAME%]==[PACMAN.SUBNAME] (
  set NAME="%NAME%-%SUBNAME%"
  set SHARE="%SHARE%-%SUBNAME%"
)

if [%NAME%]==[] set NAME="%2"
if [%VERSION%]==[] set VERSION="%3"

if not "[%DISTRIBUTION%]"=="[]" set _DISTRIBUTION=%DISTRIBUTION:~1,-1%
if [%_DISTRIBUTION%]==[PACMAN.DISTRIBUTION] set DISTRIBUTION=%PEON_DISTRIBUTION%

xcraft-peon.bat "%CD%" "%SHARE%" "%HOOK%" %ACTION% "%WPKGACT%" "%CMAKE_BINARY_DIR%" "%NAME%" "%VERSION%" "%SYSROOT%" "%DISTRIBUTION%"
