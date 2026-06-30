[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=C:\Users\ADMINI~1\AppData\Local\Temp\lemongrid_iexpress_1.0.0\LemonGrid_Setup.exe
FriendlyName=LemonGrid Installer
AppLaunched=setup.cmd
PostInstallCmd=<None>
AdminQuietInstCmd="install.ps1" "powershell -NoProfile -ExecutionPolicy Bypass -File \""%~dp0install.ps1\"""
UserQuietInstCmd="install.ps1" "powershell -NoProfile -ExecutionPolicy Bypass -File \""%~dp0install.ps1\"""
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=C:\Users\ADMINI~1\AppData\Local\Temp\lemongrid_iexpress_1.0.0\source
[SourceFiles0]
%FILE0%=setup.cmd
%FILE1%=install.ps1
%FILE2%=lemongrid_payload.zip
[Strings]
FILE0=setup.cmd
FILE1=install.ps1
FILE2=lemongrid_payload.zip
