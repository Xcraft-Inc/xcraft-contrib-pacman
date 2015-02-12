@echo off

set SHARE=__SHARE__
set ACTION=__ACTION__
set SYSROOT=__SYSROOT__
set CONFIG=__CONFIG__
set CMAKE_BINARY_DIR=%1

for /f "delims=" %%i in ('node -e "process.stdout.write (require ('path').resolve (__dirname, '%SYSROOT%', require (require ('path').resolve (__dirname, '%SYSROOT%', '%CONFIG%')).bin));"') do set PEON=%%i

node "%PEON%" "%CD%" "%SHARE%" %ACTION% %CMAKE_BINARY_DIR%
