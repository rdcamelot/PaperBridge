$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE"
    }
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    Write-Host "Checking manifest.json"
    $manifest = Get-Content -LiteralPath "manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.applications.zotero.id -ne "paperbridge@example.com") {
        throw "Unexpected Zotero addon id: $($manifest.applications.zotero.id)"
    }
    $xpiPath = "dist/paperbridge-$($manifest.version).xpi"

    Write-Host "Checking preferences.xhtml"
    [void]([xml](Get-Content -LiteralPath "preferences.xhtml" -Raw -Encoding UTF8))

    Write-Host "Checking JavaScript syntax"
    $jsFiles = @(
        "bootstrap.js",
        "prefs.js",
        "preferences.js",
        "chrome/content/paperbridge.js"
    ) + (Get-ChildItem -LiteralPath "chrome/content/modules" -Filter "*.js" | ForEach-Object { $_.FullName })

    foreach ($file in $jsFiles) {
        Invoke-Checked "node" @("--check", $file)
    }

    Write-Host "Running offline module tests"
    Invoke-Checked "node" @("tools/offline-tests.js")

    Write-Host "Checking bootstrap script references"
    $bootstrap = Get-Content -LiteralPath "bootstrap.js" -Raw -Encoding UTF8
    $scriptRefs = [regex]::Matches($bootstrap, '"([^"]+\.js)"') | ForEach-Object { $_.Groups[1].Value }
    foreach ($scriptRef in $scriptRefs) {
        if (!(Test-Path -LiteralPath $scriptRef -PathType Leaf)) {
            throw "bootstrap.js references missing script: $scriptRef"
        }
    }

    Write-Host "Checking tray helper"
    Invoke-Checked "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "chrome/content/tray-helper.ps1", "-SelfTest")

    Write-Host "Checking Zotero install verifier"
    Invoke-Checked "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/verify-zotero-install.ps1", "-SelfTest")

    Write-Host "Checking XPI install diagnostic"
    Invoke-Checked "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/diagnose-xpi.ps1", "-SelfTest")

    Write-Host "Checking development profile installer"
    [void][scriptblock]::Create((Get-Content -LiteralPath "tools/dev-install-to-zotero-profile.ps1" -Raw -Encoding UTF8))

    Write-Host "Building XPI"
    Invoke-Checked "powershell" @("-ExecutionPolicy", "Bypass", "-File", "tools/build-xpi.ps1")
    $latestXPIPath = "dist/paperbridge-latest.xpi"
    if (!(Test-Path -LiteralPath $latestXPIPath -PathType Leaf)) {
        throw "Missing latest XPI alias: $latestXPIPath"
    }

    Write-Host "Checking XPI contents"
    $expected = @(
        "manifest.json",
        "bootstrap.js",
        "prefs.js",
        "preferences.xhtml",
        "preferences.js",
        "style.css",
        "icons/paperbridge-16.svg",
        "icons/paperbridge-20.svg",
        "locale/en-US/paperbridge.ftl",
        "locale/zh-CN/paperbridge.ftl",
        "chrome/content/paperbridge.js",
        "chrome/content/tray-helper.ps1",
        "chrome/content/modules/tray.js",
        "chrome/content/modules/notes.js",
        "chrome/content/modules/bulk.js",
        "chrome/content/modules/ranks.js",
        "chrome/content/modules/columns.js",
        "chrome/content/modules/menus.js",
        "chrome/content/modules/notifications.js",
        "chrome/content/modules/deleteQueue.js"
    )
    $expected += Get-ChildItem -LiteralPath "chrome" -Recurse -File | ForEach-Object {
        $_.FullName.Substring($root.Length + 1).Replace("\", "/")
    }
    foreach ($assetDir in @("icons", "locale")) {
        $expected += Get-ChildItem -LiteralPath $assetDir -Recurse -File | ForEach-Object {
            $_.FullName.Substring($root.Length + 1).Replace("\", "/")
        }
    }
    $expected = $expected | Sort-Object -Unique
    $entries = & tar -tf $xpiPath
    if ($LASTEXITCODE -ne 0) {
        throw "tar exited with code $LASTEXITCODE"
    }
    foreach ($entry in $expected) {
        if ($entries -notcontains $entry) {
            throw "Missing XPI entry: $entry"
        }
    }

    Write-Host "Running XPI install diagnostic"
    Invoke-Checked "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/diagnose-xpi.ps1", "-XPIPath", $xpiPath)
    Invoke-Checked "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/diagnose-xpi.ps1", "-XPIPath", $latestXPIPath)

    Write-Host "Validation passed"
}
finally {
    Pop-Location
}
