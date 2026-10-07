# Switch the PS plugin webview URL (dev/prod).
# Usage: powershell -File switch-url.ps1 -Mode dev|prod
# Only rewrites the webview's src (http/https) in PS-plugin/lemongrid/index.html;
# the script tag's src="./main.js" is never touched.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('dev', 'prod')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

$htmlPath = Join-Path $PSScriptRoot '..\PS-plugin\lemongrid\index.html'
$devUrl  = 'http://localhost:5173/ps/'
$prodUrl = 'https://lemongrid.cn/ps/'
$target = if ($Mode -eq 'dev') { $devUrl } else { $prodUrl }

$content = [System.IO.File]::ReadAllText($htmlPath)

# Only matches an indented src="http..." (the webview src)
$pattern = '(\s+src=")https?://[^"]*(")'
$hits = [regex]::Matches($content, $pattern)
if ($hits.Count -ne 1) {
    Write-Output "ABNORMAL: found $($hits.Count) http src entries (expect 1), aborting"
    exit 1
}

if ($hits[0].Value -like "*$target*") {
    Write-Output "ALREADY: $target"
    exit 0
}

$new = [regex]::Replace($content, $pattern, ('$1' + $target + '$2'))
[System.IO.File]::WriteAllText($htmlPath, $new, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "OK: -> $target"
exit 0
