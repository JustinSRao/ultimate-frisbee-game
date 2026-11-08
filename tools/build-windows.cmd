@echo off
rem Builds the Windows installers inside the VS Build Tools environment.
rem (Some machines have a second Visual Studio install without x64 libraries; vcvars64 pins the right one.)
setlocal
set "VSW=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSW%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath`) do set "VSPATH=%%i"
if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VSPATH=%ProgramFiles(x86)%\Microsoft Visual Studio\18\BuildTools"
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
call npx tauri build --bundles nsis,msi %*
