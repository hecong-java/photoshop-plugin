$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$PluginRoot = (Resolve-Path (Join-Path $RepoRoot "PS-plugin\lemongrid")).Path
$ManifestPath = Join-Path $PluginRoot "manifest.json"
$SetupTemplatePath = Join-Path $ScriptDir "setup.cmd"
$InstallTemplatePath = Join-Path $ScriptDir "install.ps1"
$BuildRoot = Join-Path $ScriptDir "dist"
$TempRoot = Join-Path $ScriptDir "build-temp"
$PayloadName = "lemongrid_payload.zip"
$SetupName = "setup.cmd"
$InstallName = "install.ps1"
$ExeName = "LemonGrid_Setup.exe"
$IExpressPath = Join-Path $env:WINDIR "System32\iexpress.exe"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Missing plugin manifest: $ManifestPath"
}
if (-not (Test-Path -LiteralPath $SetupTemplatePath)) {
    throw "Missing setup template: $SetupTemplatePath"
}
if (-not (Test-Path -LiteralPath $InstallTemplatePath)) {
    throw "Missing install template: $InstallTemplatePath"
}
if (-not (Test-Path -LiteralPath $IExpressPath)) {
    throw "IExpress not found: $IExpressPath"
}

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
$PluginId = [string]$Manifest.id
$VersionString = [string]$Manifest.version

if ([string]::IsNullOrWhiteSpace($PluginId)) {
    throw "manifest.json is missing plugin id"
}
if ([string]::IsNullOrWhiteSpace($VersionString)) {
    throw "manifest.json is missing version"
}

$VersionDir = Join-Path $BuildRoot $VersionString
$StageDir = Join-Path $TempRoot $PluginId
$PayloadPath = Join-Path $VersionDir $PayloadName
$SetupOutputPath = Join-Path $VersionDir $SetupName
$InstallOutputPath = Join-Path $VersionDir $InstallName
$SedPath = Join-Path $VersionDir 'iexpress.sed'
$ExePath = Join-Path $VersionDir $ExeName
$IExpressRoot = Join-Path $env:TEMP ("lemongrid_iexpress_" + ($VersionString -replace '[^0-9A-Za-z._-]', '_'))
$IExpressSourceDir = Join-Path $IExpressRoot "source"
$IExpressSedPath = Join-Path $IExpressRoot "iexpress.sed"
$IExpressExePath = Join-Path $IExpressRoot $ExeName

Write-Step "Clean previous build output"
Remove-Item -LiteralPath $VersionDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $IExpressRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $VersionDir -Force | Out-Null
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
New-Item -ItemType Directory -Path $IExpressSourceDir -Force | Out-Null

Write-Step "Copy plugin files"
Copy-Item -Path (Join-Path $PluginRoot "*") -Destination $StageDir -Recurse -Force

Write-Step "Create payload archive"
Compress-Archive -Path $StageDir -DestinationPath $PayloadPath -Force

Write-Step "Copy installer scripts"
Copy-Item -LiteralPath $SetupTemplatePath -Destination $SetupOutputPath -Force
Copy-Item -LiteralPath $InstallTemplatePath -Destination $InstallOutputPath -Force
Copy-Item -LiteralPath $SetupOutputPath -Destination (Join-Path $IExpressSourceDir $SetupName) -Force
Copy-Item -LiteralPath $InstallOutputPath -Destination (Join-Path $IExpressSourceDir $InstallName) -Force
Copy-Item -LiteralPath $PayloadPath -Destination (Join-Path $IExpressSourceDir $PayloadName) -Force

Write-Step "Generate IExpress SED"
$SedContent = @"
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
TargetName=$IExpressExePath
FriendlyName=LemonGrid Installer
AppLaunched=$SetupName
PostInstallCmd=<None>
AdminQuietInstCmd="$InstallName" "powershell -NoProfile -ExecutionPolicy Bypass -File \""%~dp0$InstallName\"""
UserQuietInstCmd="$InstallName" "powershell -NoProfile -ExecutionPolicy Bypass -File \""%~dp0$InstallName\"""
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$IExpressSourceDir
[SourceFiles0]
%FILE0%=$SetupName
%FILE1%=$InstallName
%FILE2%=$PayloadName
[Strings]
FILE0=$SetupName
FILE1=$InstallName
FILE2=$PayloadName
"@
Set-Content -LiteralPath $SedPath -Value $SedContent -Encoding UTF8
Set-Content -LiteralPath $IExpressSedPath -Value $SedContent -Encoding ASCII

Write-Step "Build EXE with IExpress"
$proc = Start-Process -FilePath $IExpressPath -ArgumentList "/N", $IExpressSedPath -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
    throw "IExpress failed with exit code: $($proc.ExitCode)"
}
if (-not (Test-Path -LiteralPath $IExpressExePath)) {
    throw "IExpress did not create the installer: $IExpressExePath"
}
$FinalExePath = $ExePath
try {
    Copy-Item -LiteralPath $IExpressExePath -Destination $ExePath -Force
} catch {
    $FallbackExeName = ("LemonGrid_Setup_{0}.exe" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    $FinalExePath = Join-Path $VersionDir $FallbackExeName
    Copy-Item -LiteralPath $IExpressExePath -Destination $FinalExePath -Force
    Write-Warning "Primary installer path is locked; wrote fallback installer instead."
}

Write-Step "Remove temp files"
Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $IExpressRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Step "Build complete"
Write-Host "Plugin ID: $PluginId"
Write-Host "Version: $VersionString"
Write-Host "Output folder: $VersionDir"
Write-Host "Installer: $FinalExePath"
