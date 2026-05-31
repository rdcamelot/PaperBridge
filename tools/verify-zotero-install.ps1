param(
  [string]$ProfilePath = "",
  [string]$PluginID = "paperbridge@example.com",
  [string]$ExpectedVersion = "",
  [string]$ExpectedXPIPath = "",
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

function Resolve-ExpectedXPIPath {
  param([string]$Version)

  $root = Split-Path $PSScriptRoot -Parent
  $latest = Join-Path $root "dist\paperbridge-latest.xpi"
  if (Test-Path -LiteralPath $latest) {
    return $latest
  }

  if ($Version) {
    $versioned = Join-Path $root "dist\paperbridge-$Version.xpi"
    if (Test-Path -LiteralPath $versioned) {
      return $versioned
    }
  }
  return ""
}

function Read-XPIManifestInfo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entry = $zip.GetEntry("manifest.json")
    if (!$entry) {
      throw "manifest.json is missing from the XPI root"
    }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try {
      $manifest = $reader.ReadToEnd() | ConvertFrom-Json
    }
    finally {
      $reader.Dispose()
    }

    return [pscustomobject]@{
      ID = $manifest.applications.zotero.id
      Version = $manifest.version
      Name = $manifest.name
    }
  }
  finally {
    $zip.Dispose()
  }
}

function Get-XPIPackageInfo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $file = Get-Item -LiteralPath $resolvedPath
  $manifest = Read-XPIManifestInfo -Path $resolvedPath
  return [pscustomobject]@{
    Path = $resolvedPath
    Length = $file.Length
    SHA256 = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash
    ID = $manifest.ID
    Version = $manifest.Version
    Name = $manifest.Name
  }
}

function Test-ZoteroPluginInstall {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetProfilePath,

    [Parameter(Mandatory = $true)]
    [string]$TargetPluginID,

    [string]$TargetVersion = "",

    [string]$TargetPackagePath = "",

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
  if (!$addon.path -or !(Test-Path -LiteralPath $addon.path)) {
    $issues += "registered XPI path does not exist: $($addon.path)"
  }

  $installedPackage = $null
  if ($addon.path -and (Test-Path -LiteralPath $addon.path)) {
    try {
      $installedPackage = Get-XPIPackageInfo -Path $addon.path
      if ($installedPackage.ID -ne $TargetPluginID) {
        $issues += "installed XPI manifest id is $($installedPackage.ID), expected $TargetPluginID"
      }
      if ($TargetVersion -and $installedPackage.Version -ne $TargetVersion) {
        $issues += "installed XPI manifest version is $($installedPackage.Version), expected $TargetVersion"
      }
    }
    catch {
      $issues += "registered XPI cannot be inspected: $($_.Exception.Message)"
    }
  }

  $expectedPackage = $null
  if ($TargetPackagePath) {
    if (!(Test-Path -LiteralPath $TargetPackagePath)) {
      $issues += "expected XPI package does not exist: $TargetPackagePath"
    }
    else {
      try {
        $expectedPackage = Get-XPIPackageInfo -Path $TargetPackagePath
        if ($expectedPackage.ID -ne $TargetPluginID) {
          $issues += "expected package manifest id is $($expectedPackage.ID), expected $TargetPluginID"
        }
        if ($TargetVersion -and $expectedPackage.Version -ne $TargetVersion) {
          $issues += "expected package manifest version is $($expectedPackage.Version), expected $TargetVersion"
        }
        if ($installedPackage -and $installedPackage.SHA256 -ne $expectedPackage.SHA256) {
          $issues += "installed XPI differs from expected package $($expectedPackage.Path)"
        }
      }
      catch {
        $issues += "expected XPI package cannot be inspected: $($_.Exception.Message)"
      }
    }
  }

  return [pscustomobject]@{
    Ok = $issues.Count -eq 0
    Addon = $addon
    InstalledPackage = $installedPackage
    ExpectedPackage = $expectedPackage
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
  if ($Result.Addon) {
    Write-Host "Registered version: $($Result.Addon.version)"
    Write-Host "Registered active: active=$($Result.Addon.active), appDisabled=$($Result.Addon.appDisabled), userDisabled=$($Result.Addon.userDisabled)"
    Write-Host "Registered XPI: $($Result.Addon.path)"
    if ($Result.Addon.sourceURI) {
      Write-Host "Registered source: $($Result.Addon.sourceURI)"
    }
  }
  if ($Result.InstalledPackage) {
    Write-Host "Installed XPI manifest: version=$($Result.InstalledPackage.Version), id=$($Result.InstalledPackage.ID)"
    Write-Host "Installed XPI SHA256: $($Result.InstalledPackage.SHA256)"
  }
  if ($Result.ExpectedPackage) {
    Write-Host "Expected package: $($Result.ExpectedPackage.Path)"
    Write-Host "Expected package manifest: version=$($Result.ExpectedPackage.Version), id=$($Result.ExpectedPackage.ID)"
    Write-Host "Expected package SHA256: $($Result.ExpectedPackage.SHA256)"
  }
  if (!$Result.Ok) {
    [Console]::Error.WriteLine("$TargetPluginID is not ready: $($Result.Issues -join '; ')")
    if ($Result.ExpectedPackage) {
      Write-Host "Install this XPI in Zotero, then restart Zotero: $($Result.ExpectedPackage.Path)"
    }
    return
  }

  Write-Host "PaperBridge is installed and enabled in Zotero."
  Write-Host "Version: $($Result.Addon.version)"
  Write-Host "XPI: $($Result.Addon.path)"
}

function New-TestXPI {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$PluginID,
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$Marker = "test"
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Force
  }
  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
  try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      $entry = $archive.CreateEntry("manifest.json")
      $writer = New-Object System.IO.StreamWriter($entry.Open(), [System.Text.UTF8Encoding]::new($false))
      try {
        @{
          manifest_version = 2
          name = "PaperBridge"
          version = $Version
          marker = $Marker
          applications = @{
            zotero = @{
              id = $PluginID
              update_url = "https://example.com/paperbridge/updates.json"
              strict_min_version = "6.999"
              strict_max_version = "11.*"
            }
          }
        } | ConvertTo-Json -Depth 8 | ForEach-Object { $writer.Write($_) }
      }
      finally {
        $writer.Dispose()
      }
    }
    finally {
      $archive.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

function New-TestProfile {
  param(
    [string]$PluginID,
    [string]$Version,
    [bool]$Active,
    [bool]$UserDisabled,
    [bool]$AppDisabled,
    [string]$SourceXPIPath = "",
    [string]$PackageMarker = "profile"
  )

  $profile = Join-Path ([System.IO.Path]::GetTempPath()) ("paperbridge-install-verifier-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $profile | Out-Null
  $xpi = Join-Path $profile "paperbridge.xpi"
  if ($SourceXPIPath) {
    Copy-Item -LiteralPath $SourceXPIPath -Destination $xpi -Force
  }
  else {
    New-TestXPI -Path $xpi -PluginID $PluginID -Version $Version -Marker $PackageMarker
  }
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
  $expectedPackage = Join-Path ([System.IO.Path]::GetTempPath()) ("paperbridge-expected-" + [guid]::NewGuid().ToString("N") + ".xpi")
  New-TestXPI -Path $expectedPackage -PluginID "paperbridge@example.com" -Version $version -Marker "expected"

  $goodProfile = New-TestProfile -PluginID "paperbridge@example.com" -Version $version -Active $true -UserDisabled $false -AppDisabled $false -SourceXPIPath $expectedPackage
  $good = Test-ZoteroPluginInstall -TargetProfilePath $goodProfile -TargetPluginID "paperbridge@example.com" -TargetVersion $version -TargetPackagePath $expectedPackage
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

  $staleProfile = New-TestProfile -PluginID "paperbridge@example.com" -Version $version -Active $true -UserDisabled $false -AppDisabled $false -PackageMarker "stale"
  $stale = Test-ZoteroPluginInstall -TargetProfilePath $staleProfile -TargetPluginID "paperbridge@example.com" -TargetVersion $version -TargetPackagePath $expectedPackage
  if ($stale.Ok -or ($stale.Issues -join ";") -notmatch "differs from expected package") {
    throw "Expected stale profile XPI to fail package hash verification"
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
if (!$ExpectedXPIPath) {
  $ExpectedXPIPath = Resolve-ExpectedXPIPath -Version $ExpectedVersion
}

$result = Test-ZoteroPluginInstall `
  -TargetProfilePath $ProfilePath `
  -TargetPluginID $PluginID `
  -TargetVersion $ExpectedVersion `
  -TargetPackagePath $ExpectedXPIPath `
  -AllowDisabledAddon:$AllowDisabled
Write-InstallResult -Result $result -TargetProfilePath $ProfilePath -TargetPluginID $PluginID
if (!$result.Ok) {
  exit 1
}
