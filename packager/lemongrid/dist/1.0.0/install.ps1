$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$BaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadName = "lemongrid_payload.zip"
$PayloadPath = Join-Path $BaseDir $PayloadName
$PluginId = "lemongrid"
$PluginDisplayName = "LemonGrid"
$InstallRoot = Join-Path ${env:ProgramFiles} "Common Files\Adobe\UXP"
$TargetParent = Join-Path $InstallRoot "Plugins\External"
$TargetDir = Join-Path $TargetParent $PluginId
$PluginsInfoDir = Join-Path $InstallRoot "PluginsInfo\v1"
$PluginsInfoPath = Join-Path $PluginsInfoDir "PS.json"
$DriveLetters = @("C", "D", "E", "F", "G", "H")
$TempRoot = Join-Path $env:TEMP ("lemongrid_install_" + [guid]::NewGuid().ToString("N"))

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Add-UniqueExistingPath {
    param(
        [hashtable]$Map,
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return
    }

    if (-not (Test-Path -LiteralPath $PathValue)) {
        return
    }

    $resolved = $PathValue
    try {
        $resolved = (Resolve-Path -LiteralPath $PathValue).Path
    } catch {
        $resolved = $PathValue
    }

    $key = $resolved.ToLowerInvariant()
    if (-not $Map.ContainsKey($key)) {
        $Map[$key] = $resolved
    }
}

function Get-ExistingDriveRoots {
    $roots = @()
    foreach ($drive in $DriveLetters) {
        $driveRoot = "{0}:\" -f $drive
        if (Test-Path -LiteralPath $driveRoot) {
            $roots += $driveRoot
        }
    }
    return $roots
}

function Get-PhotoshopInstallDirectories {
    $pathMap = @{}
    Write-Host "Checking Photoshop install locations from registry..."
    $registryPatterns = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($pattern in $registryPatterns) {
        foreach ($item in @(Get-ItemProperty -Path $pattern -ErrorAction SilentlyContinue)) {
            if (-not $item) {
                continue
            }
            $displayName = [string]$item.DisplayName
            if ($displayName -notmatch "Photoshop") {
                continue
            }

            Add-UniqueExistingPath -Map $pathMap -PathValue ([string]$item.InstallLocation)

            $displayIcon = [string]$item.DisplayIcon
            if (-not [string]::IsNullOrWhiteSpace($displayIcon)) {
                $iconPath = $displayIcon.Trim('"')
                if ($iconPath -match "^(.*?\.exe)") {
                    $iconPath = $matches[1]
                }
                if (Test-Path -LiteralPath $iconPath) {
                    Add-UniqueExistingPath -Map $pathMap -PathValue (Split-Path -Parent $iconPath)
                }
            }
        }
    }

    $appPathKeys = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe"
    )

    foreach ($key in $appPathKeys) {
        try {
            $item = Get-ItemProperty -Path $key -ErrorAction Stop
            if ($item.'(default)') {
                $exePath = [string]$item.'(default)'
                if (Test-Path -LiteralPath $exePath) {
                    Add-UniqueExistingPath -Map $pathMap -PathValue (Split-Path -Parent $exePath)
                }
            }
        } catch {
        }
    }

    return @($pathMap.Values | Sort-Object)
}

function Get-PhotoshopKeywordDirectories {
    $pathMap = @{}

    foreach ($driveRoot in @(Get-ExistingDriveRoots)) {
        Write-Host ("Searching Photoshop keyword paths on drive: {0}" -f $driveRoot)
        try {
            Get-ChildItem -Path $driveRoot -Directory -Recurse -Force -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.Name -match 'photoshop'
                } |
                ForEach-Object {
                    Add-UniqueExistingPath -Map $pathMap -PathValue $_.FullName
                }
        } catch {
            Write-Warning ("Keyword scan failed: {0}, {1}" -f $driveRoot, $_.Exception.Message)
        }
    }

    return @($pathMap.Values | Sort-Object)
}

function Add-LegacyMatchesFromRoot {
    param(
        [hashtable]$Map,
        [string]$Root
    )

    if ([string]::IsNullOrWhiteSpace($Root) -or -not (Test-Path -LiteralPath $Root)) {
        return
    }

    foreach ($candidate in @(
        (Join-Path $Root ("Plug-ins\" + $PluginId)),
        (Join-Path $Root ("Plug-ins\" + $PluginDisplayName)),
        (Join-Path $Root ("Required\Plug-ins\" + $PluginId)),
        (Join-Path $Root ("Required\Plug-ins\" + $PluginDisplayName)),
        (Join-Path $Root ("Plug-ins\Generator\" + $PluginId)),
        (Join-Path $Root ("Plug-ins\Generator\" + $PluginDisplayName)),
        (Join-Path $Root ("Required\Plug-ins\Generator\" + $PluginId)),
        (Join-Path $Root ("Required\Plug-ins\Generator\" + $PluginDisplayName))
    )) {
        Add-UniqueExistingPath -Map $Map -PathValue $candidate
    }

    try {
        Get-ChildItem -Path $Root -Directory -Filter $PluginId -Recurse -Force -ErrorAction SilentlyContinue |
            Where-Object {
                $_.FullName -match '\\(Plug-ins|External)\\'
            } |
            ForEach-Object {
                Add-UniqueExistingPath -Map $Map -PathValue $_.FullName
            }
    } catch {
        Write-Warning ("Scan failed: {0}, {1}" -f $Root, $_.Exception.Message)
    }
}

function Test-IsOurPluginDirectory {
    param([string]$DirectoryPath)

    if ([string]::IsNullOrWhiteSpace($DirectoryPath) -or -not (Test-Path -LiteralPath $DirectoryPath)) {
        return $false
    }

    $manifestPath = Join-Path $DirectoryPath "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        return $false
    }

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $false
    }

    if (-not $manifest) {
        return $false
    }

    $manifestId = [string]$manifest.id
    $manifestName = [string]$manifest.name
    $hostApp = [string]$manifest.host.app
    $mainEntry = [string]$manifest.main

    if ($manifestId -ne $PluginId) {
        return $false
    }

    if (-not [string]::IsNullOrWhiteSpace($manifestName) -and $manifestName -ne $PluginDisplayName) {
        return $false
    }

    if (-not [string]::IsNullOrWhiteSpace($hostApp) -and $hostApp -ne "PS") {
        return $false
    }

    if (-not [string]::IsNullOrWhiteSpace($mainEntry) -and $mainEntry -ne "index.html") {
        return $false
    }

    return $true
}

function Get-LegacyPluginDirectories {
    $pathMap = @{}
    $driveRoots = Get-ExistingDriveRoots
    Add-UniqueExistingPath -Map $pathMap -PathValue $TargetDir

    foreach ($driveRoot in $driveRoots) {
        Write-Host ("Checking common plugin paths on drive: {0}" -f $driveRoot)
        $directCandidates = @(
            "{0}Program Files\Common Files\Adobe\UXP\Plugins\External\{1}" -f $driveRoot, $PluginId,
            "{0}Program Files\Common Files\Adobe\UXP\Plugins\External\{1}" -f $driveRoot, $PluginDisplayName,
            "{0}Program Files (x86)\Common Files\Adobe\UXP\Plugins\External\{1}" -f $driveRoot, $PluginId,
            "{0}Program Files (x86)\Common Files\Adobe\UXP\Plugins\External\{1}" -f $driveRoot, $PluginDisplayName
        )

        foreach ($candidate in $directCandidates) {
            Add-UniqueExistingPath -Map $pathMap -PathValue $candidate
        }

        $wildcardCandidates = @(
            "{0}Program Files\Common Files\Adobe\UXP\PluginsStorage\PHSP\*\External\{1}" -f $driveRoot, $PluginId,
            "{0}Program Files\Common Files\Adobe\UXP\PluginsStorage\PHSP\*\External\{1}" -f $driveRoot, $PluginDisplayName,
            "{0}Program Files (x86)\Common Files\Adobe\UXP\PluginsStorage\PHSP\*\External\{1}" -f $driveRoot, $PluginId,
            "{0}Program Files (x86)\Common Files\Adobe\UXP\PluginsStorage\PHSP\*\External\{1}" -f $driveRoot, $PluginDisplayName,
            "{0}Program Files\Adobe\Adobe Photoshop*\Plug-ins\{1}" -f $driveRoot, $PluginId,
            "{0}Program Files\Adobe\Adobe Photoshop*\Plug-ins\{1}" -f $driveRoot, $PluginDisplayName,
            "{0}Program Files (x86)\Adobe\Adobe Photoshop*\Plug-ins\{1}" -f $driveRoot, $PluginId,
            "{0}Program Files (x86)\Adobe\Adobe Photoshop*\Plug-ins\{1}" -f $driveRoot, $PluginDisplayName,
            "{0}Adobe\Adobe Photoshop*\Plug-ins\{1}" -f $driveRoot, $PluginId,
            "{0}Adobe\Adobe Photoshop*\Plug-ins\{1}" -f $driveRoot, $PluginDisplayName
        )

        foreach ($pattern in $wildcardCandidates) {
            foreach ($item in @(Get-Item -Path $pattern -Force -ErrorAction SilentlyContinue)) {
                if ($item) {
                    Add-UniqueExistingPath -Map $pathMap -PathValue $item.FullName
                }
            }
        }

        $searchRoots = @(
            "{0}Program Files\Common Files\Adobe" -f $driveRoot,
            "{0}Program Files\Adobe" -f $driveRoot,
            "{0}Program Files (x86)\Adobe" -f $driveRoot,
            "{0}Adobe" -f $driveRoot
        )

        foreach ($root in $searchRoots) {
            if (-not (Test-Path -LiteralPath $root)) {
                continue
            }

            Add-LegacyMatchesFromRoot -Map $pathMap -Root $root
        }
    }

    Write-Host "Checking detected Photoshop install roots..."
    foreach ($psRoot in @(Get-PhotoshopInstallDirectories)) {
        Write-Host ("Scanning detected install root: {0}" -f $psRoot)
        Add-LegacyMatchesFromRoot -Map $pathMap -Root $psRoot
    }

    Write-Host "Checking Photoshop keyword matches..."
    foreach ($psKeywordRoot in @(Get-PhotoshopKeywordDirectories)) {
        Write-Host ("Scanning keyword root: {0}" -f $psKeywordRoot)
        Add-LegacyMatchesFromRoot -Map $pathMap -Root $psKeywordRoot
    }

    return @($pathMap.Values | Sort-Object { $_.Length } -Descending)
}

function Get-PluginsInfoJsonPaths {
    $pathMap = @{}
    Add-UniqueExistingPath -Map $pathMap -PathValue $PluginsInfoPath

    foreach ($drive in $DriveLetters) {
        $pattern = "{0}:\Program Files\Common Files\Adobe\UXP\PluginsStorage\PHSP\*\PluginData\Metadata\PluginsInfo\v1\PS.json" -f $drive
        foreach ($item in @(Get-Item -Path $pattern -Force -ErrorAction SilentlyContinue)) {
            if ($item) {
                Add-UniqueExistingPath -Map $pathMap -PathValue $item.FullName
            }
        }
    }

    return @($pathMap.Values | Sort-Object)
}

function Read-PluginsInfoObject {
    param([string]$PathValue)

    if (-not (Test-Path -LiteralPath $PathValue)) {
        return [ordered]@{ plugins = @() }
    }

    $raw = Get-Content -LiteralPath $PathValue -Raw -Encoding UTF8
    if (-not $raw -or $raw.Trim().Length -eq 0) {
        return [ordered]@{ plugins = @() }
    }

    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    $plugins = @()
    if ($parsed -and $parsed.plugins) {
        foreach ($item in $parsed.plugins) {
            if ($item) {
                $plugins += [pscustomobject]$item
            }
        }
    }

    return [ordered]@{ plugins = @($plugins) }
}

function Write-PluginsInfoObject {
    param(
        [string]$PathValue,
        [object[]]$Plugins
    )

    $parent = Split-Path -Parent $PathValue
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $obj = [ordered]@{ plugins = @($Plugins) }
    $json = $obj | ConvertTo-Json -Depth 20
    Set-Content -LiteralPath $PathValue -Value $json -Encoding UTF8
}

function Remove-LegacyPluginMetadata {
    Write-Step "Clean legacy plugin metadata"
    $jsonPaths = Get-PluginsInfoJsonPaths
    if (-not $jsonPaths -or $jsonPaths.Count -eq 0) {
        Write-Host "No PluginsInfo metadata found"
        return
    }

    foreach ($jsonPath in $jsonPaths) {
        try {
            $data = Read-PluginsInfoObject -PathValue $jsonPath
            $beforeCount = @($data.plugins).Count
            $filtered = @(
                $data.plugins | Where-Object {
                    $_ -and
                    $_.pluginId -ne $PluginId -and
                    $_.name -ne $PluginDisplayName -and
                    $_.name -ne $PluginId -and
                    -not (($_.path | Out-String).Trim().ToLowerInvariant().EndsWith("\$PluginId"))
                }
            )
            if (@($filtered).Count -ne $beforeCount) {
                Write-PluginsInfoObject -PathValue $jsonPath -Plugins $filtered
                Write-Host "Removed legacy entries: $jsonPath"
            } else {
                Write-Host "No cleanup needed: $jsonPath"
            }
        } catch {
            $backupPath = "{0}.bak_{1}" -f $jsonPath, (Get-Date -Format "yyyyMMddHHmmss")
            Copy-Item -LiteralPath $jsonPath -Destination $backupPath -Force -ErrorAction SilentlyContinue
            Write-Warning ("Failed to process metadata, backup attempted: {0}" -f $jsonPath)
        }
    }
}

function Register-CurrentPlugin {
    param(
        [string]$VersionString
    )

    Write-Step "Register current plugin"
    $entryPath = "`$systemPlugins\External\$PluginId"
    $entry = [ordered]@{
        hostMinVersion = "24.1.0"
        name = $PluginId
        path = $entryPath
        pluginId = $PluginId
        status = "enabled"
        type = "uxp"
        versionString = $VersionString
    }

    $data = Read-PluginsInfoObject -PathValue $PluginsInfoPath
    $plugins = @(
        $data.plugins | Where-Object {
            $_ -and $_.pluginId -ne $PluginId
        }
    )
    $plugins += [pscustomobject]$entry
    Write-PluginsInfoObject -PathValue $PluginsInfoPath -Plugins $plugins
    Write-Host "Metadata updated: $PluginsInfoPath"
}

function Remove-LegacyPluginDirectories {
    Write-Step "Scan and remove legacy plugin folders"
    $legacyDirs = Get-LegacyPluginDirectories
    if (-not $legacyDirs -or $legacyDirs.Count -eq 0) {
        Write-Host "No legacy plugin folders found"
        return
    }

    Write-Host "Legacy plugin folders found:"
    foreach ($dir in $legacyDirs) {
        Write-Host (" - {0}" -f $dir)
    }

    foreach ($dir in $legacyDirs) {
        if (-not (Test-IsOurPluginDirectory -DirectoryPath $dir)) {
            Write-Host ("Skipped non-matching folder: {0}" -f $dir)
            continue
        }
        try {
            Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
            Write-Host "Removed: $dir"
        } catch {
            throw "Failed to remove legacy folder: $dir, $($_.Exception.Message)"
        }
    }
}

if (-not (Test-Path -LiteralPath $PayloadPath)) {
    throw "Missing installer payload: $PayloadPath"
}

Write-Step "Prepare LemonGrid installation"
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

try {
    Write-Step "Extract payload"
    Expand-Archive -LiteralPath $PayloadPath -DestinationPath $TempRoot -Force

    $SourceDir = Join-Path $TempRoot $PluginId
    if (-not (Test-Path -LiteralPath $SourceDir)) {
        $dirs = @(Get-ChildItem -LiteralPath $TempRoot -Directory)
        if ($dirs.Count -lt 1) {
            throw "Plugin folder not found after extraction"
        }
        $SourceDir = $dirs[0].FullName
    }

    $ManifestPath = Join-Path $SourceDir "manifest.json"
    if (-not (Test-Path -LiteralPath $ManifestPath)) {
        throw "manifest.json not found in payload: $ManifestPath"
    }

    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    if (-not $Manifest.id -or $Manifest.id -ne $PluginId) {
        throw "Unexpected plugin id in payload: $($Manifest.id)"
    }

    $VersionString = [string]$Manifest.version
    if ([string]::IsNullOrWhiteSpace($VersionString)) {
        $VersionString = "unknown"
    }

    Remove-LegacyPluginDirectories
    Remove-LegacyPluginMetadata

    Write-Step "Install new version"
    New-Item -ItemType Directory -Path $TargetParent -Force | Out-Null
    if (Test-Path -LiteralPath $TargetDir) {
        Remove-Item -LiteralPath $TargetDir -Recurse -Force
    }
    Move-Item -LiteralPath $SourceDir -Destination $TargetDir
    Write-Host "Installed to: $TargetDir"

    Register-CurrentPlugin -VersionString $VersionString

    Write-Step "Done"
    Write-Host ("LemonGrid {0} installed successfully" -f $VersionString)
} finally {
    if (Test-Path -LiteralPath $TempRoot) {
        Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
