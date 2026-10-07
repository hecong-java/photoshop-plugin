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
TargetName=C:\Users\Administrator\AppData\Local\Temp\lemongrid_iexpress_1.1.0\LemonGrid_Setup.exe
FriendlyName=LemonGrid Installer
AppLaunched=setup.cmd
PostInstallCmd=<None>
# quiet 妯″紡鐩存帴璧?setup.cmd锛堝唴閮ㄥ凡澶勭悊鎻愭潈涓?install.ps1 鐨勫紩鍙疯浆涔夛級
# 鍕垮湪姝ゅ啓宓屽寮曞彿鐨?powershell 鍛戒护鈥斺€擨Express SED 瑙ｆ瀽涓嶄簡浼氬脊浜や簰鍚戝锛?026-10-07 淇級
AdminQuietInstCmd=setup.cmd
UserQuietInstCmd=setup.cmd
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=C:\Users\Administrator\AppData\Local\Temp\lemongrid_iexpress_1.1.0\source
[SourceFiles0]
%FILE0%=setup.cmd
%FILE1%=install.ps1
%FILE2%=lemongrid_payload.zip
[Strings]
FILE0=setup.cmd
FILE1=install.ps1
FILE2=lemongrid_payload.zip
