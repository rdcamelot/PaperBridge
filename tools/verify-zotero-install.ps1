param(
  [string]$ProfilePath = "",
  [string]$PluginID = "paperbridge@example.com",
  [string]$ExpectedVersion = "",
  [switch]$AllowDisabled,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultZoteroProfile {
  $profilesIni = Join-Path $env:APPDATA "Zotero\Zotero\profiles.ini"
  if (!(Test-Path $profilesIni)) {
    throw "Cannot find Zotero profiles.ini at $profilesIni"
  }

  $profilesRoot = Split-Path $profilesIni -Parent
  $sections = @()
  $current = $null
  foreach ($line in Get-Content $profilesIni -Encoding UTF8) {
    if ($line -match '^\[(.+)\]$') {
      if ($current) {
        $sections += $current
      }
      $current = @{}
      $current["section"] = $matches[1]
      continue
    }
    if ($current -and $line -match '^([^=]+)=(.*)$') {
      $current[$matches[1]] = $matches[2]
    }
  }
  if ($current) {
    $sections += $current
  }

  $profile = @($sections | Where-Object { $_["section"] -like "Profile*" -and $_["Default"] -eq "1" })[0]
  if (!$profile) {
    $profile = @($sections | Where-Object { $_["section"] -like "Profile*" })[0]
  }
  if (!$profile -or !$profile["Path"]) {
    throw "Cannot resolve the default Zotero profile from $profilesIni"
  }

  if ($profile["IsRelative"] -eq "1") {
    return Join-Path $profilesRoot $profile["Path"]
  }
  return $profile["Path"]
}

function Read-ExpectedVersion {
  $manifestPath = Join-Path (Split-Path $PSScriptRoot -Parent) "manifest.json"
  if (!(Test-Path $manifestPath)) {
    return ""
  }
  return (Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

function Test-ZoteroPluginInstall {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetProfilePath,

    [Parameter(Mandatory = $true)]
    [string]$TargetPluginID,

    [string]$TargetVersion = "",

    [switch]$AllowDisabledAddon
  )

  $extensionsPath = Join-Path $TargetProfilePath "extensions.json"
  $issues = @()
  if (!(Test-Path $extensionsPath)) {
    return [pscustomobject]@{
      Ok = $false
      Addon = $null
      Issues = @("cannot find extensions.json at $extensionsPath")
    }
  }

  try {
    $registry = Get-Content $extensionsPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }
  catch {
    return [pscustomobject]@{
      Ok = $false
      Addon = $null
      Issues = @("cannot parse extensions.json: $($_.Exception.Message)")
    }
  }

  $addon = @($registry.addons | Where-Object { $_.id -eq $TargetPluginID })[0]
  if (!$addon) {
    return [pscustomobject]@{
      Ok = $false
      Addon = $null
      Issues = @("$TargetPluginID is not registered; install the XPI from Zotero Tools -> Plugins first")
    }
  }

  if ($TargetVersion -and $addon.version -ne $TargetVersion) {
    $issues += "version is $($addon.version), expected $TargetVersion"
  }
  if (!$AllowDisabledAddon) {
    if ($addon.active -ne $true) {
      $issues += "addon is not active"
    }
    if ($addon.userDisabled -eq $true) {
      $issues += "addon is user-disabled"
    }
  }
  if ($addon.appDisabled -eq $true) {
    $issues += "addon is app-disabled or incompatible"
  }
  if (!$addon.path -or !(Test-Path $addon.path)) {
    $issues += "registered XPI path does not exist: $($addon.path)"
  }

  return [pscustomobject]@{
    Ok = $issues.Count -eq 0
    Addon = $addon
    Issues = $issues
  }
}

function Write-InstallResult {
  param(
    [Parameter(Mandatory = $true)]
    $Result,

    [Parameter(Mandatory = $true)]
    [string]$TargetProfilePath,

    [Parameter(Mandatory = $true)]
    [string]$TargetPluginID
  )

  Write-Host "Checking Zotero profile: $TargetProfilePath"
  if (!$Result.Ok) {
    [Console]::Error.WriteLine("$TargetPluginID is not ready: $($Result.Issues -join '; ')")
    return
  }

  Write-Host "PaperBridge is installed and enabled in Zotero."
  Write-Host "Version: $($Result.Addon.version)"
  Write-Host "XPI: $($Result.Addon.path)"
}

function New-TestProfile {
  param(
    [string]$PluginID,
    [string]$Version,
    [bool]$Active,
    [bool]$UserDisabled,
    [bool]$AppDisabled
  )

  $profile = Join-Path ([System.IO.Path]::GetTempPath()) ("paperbridge-install-verifier-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $profile | Out-Null
  $xpi = Join-Path $profile "paperbridge.xpi"
  Set-Content -LiteralPath $xpi -Value "xpi" -Encoding UTF8
  $registry = @{
    schemaVersion = 37
    addons = @(
      @{
        id = $PluginID
        version = $Version
        active = $Active
        userDisabled = $UserDisabled
        appDisabled = $AppDisabled
        path = $xpi
      }
    )
  }
  $registry | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $profile "extensions.json") -Encoding UTF8
  return $profile
}

function Invoke-SelfTest {
  $version = Read-ExpectedVersion
  $goodProfile = New-TestProfile -PluginID "paperbridge@example.com" -Version $version -Active $true -UserDisabled $false -AppDisabled $false
  $good = Test-ZoteroPluginInstall -TargetProfilePath $goodProfile -TargetPluginID "paperbridge@example.com" -TargetVersion $version
  if (!$good.Ok) {
    throw "Expected active addon to verify: $($good.Issues -join '; ')"
  }

  $disabledProfile = New-TestProfile -PluginID "paperbridge@example.com" -Version $version -Active $false -UserDisabled $true -AppDisabled $false
  $disabled = Test-ZoteroPluginInstall -TargetProfilePath $disabledProfile -TargetPluginID "paperbridge@example.com" -TargetVersion $version
  if ($disabled.Ok -or ($disabled.Issues -join ";") -notmatch "not active") {
    throw "Expected disabled addon to fail strict verification"
  }
  $allowed = Test-ZoteroPluginInstall -TargetProfilePath $disabledProfile -TargetPluginID "paperbridge@example.com" -TargetVersion $version -AllowDisabledAddon
  if (!$allowed.Ok) {
    throw "Expected AllowDisabledAddon to accept a registered disabled addon"
  }

  $missingProfile = Join-Path ([System.IO.Path]::GetTempPath()) ("paperbridge-install-verifier-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $missingProfile | Out-Null
  @{ schemaVersion = 37; addons = @() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $missingProfile "extensions.json") -Encoding UTF8
  $missing = Test-ZoteroPluginInstall -TargetProfilePath $missingProfile -TargetPluginID "paperbridge@example.com" -TargetVersion $version
  if ($missing.Ok -or ($missing.Issues -join ";") -notmatch "not registered") {
    throw "Expected missing addon to fail registration verification"
  }

  Write-Host "PaperBridge Zotero install verifier self-test passed"
}

if ($SelfTest) {
  Invoke-SelfTest
  exit 0
}

if (!$ProfilePath) {
  $ProfilePath = Resolve-DefaultZoteroProfile
}
if (!$ExpectedVersion) {
  $ExpectedVersion = Read-ExpectedVersion
}

$result = Test-ZoteroPluginInstall `
  -TargetProfilePath $ProfilePath `
  -TargetPluginID $PluginID `
  -TargetVersion $ExpectedVersion `
  -AllowDisabledAddon:$AllowDisabled
Write-InstallResult -Result $result -TargetProfilePath $ProfilePath -TargetPluginID $PluginID
if (!$result.Ok) {
  exit 1
}
