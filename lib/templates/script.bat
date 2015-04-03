@echo off

set SHARE=<PACMAN.SHARE>
set ACTION=<PACMAN.ACTION>
set SYSROOT=<PACMAN.SYSROOT>
set CONFIG=<PACMAN.CONFIG>
set CMAKE_BINARY_DIR=%1

for /f "delims=" %%i in ('node -e "process.stdout.write (require ('path').resolve (__dirname, '%SYSROOT%', require (require ('path').resolve (__dirname, '%SYSROOT%', '%CONFIG%')).bin));"') do set PEON=%%i

node "%PEON%" "%CD%" "%SHARE%" %ACTION% %CMAKE_BINARY_DIR%
