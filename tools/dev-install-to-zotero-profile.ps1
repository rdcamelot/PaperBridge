param(
  [string]$PackagePath = "",
  [string]$ProfilePath = "",
  [string]$PluginID = "paperbridge@example.com",
  [switch]$CloseZotero
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultZoteroProfile {
  $profilesIni = Join-Path $env:APPDATA "Zotero\Zotero\profiles.ini"
  if (!(Test-Path -LiteralPath $profilesIni)) {
    throw "Cannot find Zotero profiles.ini at $profilesIni"
  }

  $profilesRoot = Split-Path $profilesIni -Parent
  $sections = @()
  $current = $null
  foreach ($line in Get-Content -LiteralPath $profilesIni -Encoding UTF8) {
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

function Resolve-PackagePath {
  if ($PackagePath) {
    return (Resolve-Path -LiteralPath $PackagePath).Path
  }
  $root = Split-Path $PSScriptRoot -Parent
  $latest = Join-Path $root "dist\paperbridge-latest.xpi"
  if (!(Test-Path -LiteralPath $latest)) {
    throw "Cannot find $latest. Run tools\validate.ps1 first."
  }
  return (Resolve-Path -LiteralPath $latest).Path
}

function Read-XPIManifest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entry = $zip.GetEntry("manifest.json")
    if (!$entry) {
      throw "manifest.json is missing from $Path"
    }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try {
      return $reader.ReadToEnd() | ConvertFrom-Json
    }
    finally {
      $reader.Dispose()
    }
  }
  finally {
    $zip.Dispose()
  }
}

function Read-PaperBridgePrefString {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Profile,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $prefPath = Join-Path $Profile "prefs.js"
  if (!(Test-Path -LiteralPath $prefPath)) {
    return ""
  }
  $escapedName = [regex]::Escape("extensions.paperbridge.$Name")
  foreach ($line in Get-Content -LiteralPath $prefPath -Encoding UTF8) {
    if ($line -match "^user_pref\(`"$escapedName`",\s*(.+)\);$") {
      try {
        return [string]($Matches[1] | ConvertFrom-Json)
      }
      catch {
        return ""
      }
    }
  }
  return ""
}

function Write-PaperBridgeQuitRequests {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Profile,
    [Parameter(Mandatory = $true)]
    [object[]]$Processes
  )

  $token = Read-PaperBridgePrefString -Profile $Profile -Name "trayToken"
  if (!$token) {
    Write-Warning "PaperBridge tray token is not available; Zotero may hide to tray instead of exiting."
    return
  }

  $tempDir = [System.IO.Path]::GetTempPath()
  foreach ($process in $Processes) {
    try {
      Set-Content -LiteralPath (Join-Path $tempDir "paperbridge-quit-$($process.Id).txt") -Value $token -Encoding UTF8 -NoNewline
    }
    catch {
      Write-Warning "Could not write PaperBridge quit request for PID $($process.Id): $($_.Exception.Message)"
    }
  }
}

function Stop-ZoteroGracefully {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Profile
  )

  $processes = @(Get-Process zotero -ErrorAction SilentlyContinue)
  if (!$processes.Count) {
    return
  }
  if (!$CloseZotero) {
    throw "Zotero is running. Close Zotero first, or rerun with -CloseZotero."
  }

  Write-PaperBridgeQuitRequests -Profile $Profile -Processes $processes
  foreach ($process in $processes) {
    try {
      if ($process.MainWindowHandle -ne 0) {
        [void]$process.CloseMainWindow()
      }
    }
    catch {
      Write-Warning "Could not ask Zotero process $($process.Id) to close: $($_.Exception.Message)"
    }
  }

  $deadline = (Get-Date).AddSeconds(25)
  do {
    Start-Sleep -Milliseconds 500
    $remaining = @(Get-Process zotero -ErrorAction SilentlyContinue)
  } while ($remaining.Count -and (Get-Date) -lt $deadline)

  if ($remaining.Count) {
    $ids = ($remaining | ForEach-Object { $_.Id }) -join ", "
    throw "Zotero did not close cleanly within 25 seconds (PID: $ids). Close it manually and rerun this script."
  }
}

function Backup-ProfileFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Profile,
    [Parameter(Mandatory = $true)]
    [string]$ProfileXPI
  )

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $Profile "paperbridge-dev-install-backup-$stamp"
  New-Item -ItemType Directory -Path $backupDir | Out-Null

  foreach ($file in @(
    $ProfileXPI,
    (Join-Path $Profile "extensions.json"),
    (Join-Path $Profile "addonStartup.json.lz4"),
    (Join-Path $Profile "compatibility.ini")
  )) {
    if (Test-Path -LiteralPath $file) {
      Copy-Item -LiteralPath $file -Destination (Join-Path $backupDir (Split-Path $file -Leaf)) -Force
    }
  }

  return $backupDir
}

function Update-ExtensionRegistry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionsJson,
    [Parameter(Mandatory = $true)]
    [string]$ManifestJson,
    [Parameter(Mandatory = $true)]
    [string]$Package,
    [Parameter(Mandatory = $true)]
    [string]$ProfileXPI
  )

  $env:PB_EXTENSIONS_JSON = $ExtensionsJson
  $env:PB_MANIFEST_JSON = $ManifestJson
  $env:PB_PACKAGE_PATH = $Package
  $env:PB_PROFILE_XPI = $ProfileXPI
  $env:PB_PLUGIN_ID = $PluginID
  $env:PB_NOW_MS = [string][DateTimeOffset]::Now.ToUnixTimeMilliseconds()

  $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("paperbridge-update-extension-registry-" + [guid]::NewGuid().ToString("N") + ".js")
  $script = @'
const fs = require("fs");
const { pathToFileURL } = require("url");

const registryPath = process.env.PB_EXTENSIONS_JSON;
const manifest = JSON.parse(process.env.PB_MANIFEST_JSON);
const pluginID = process.env.PB_PLUGIN_ID;
const packagePath = process.env.PB_PACKAGE_PATH;
const profileXPI = process.env.PB_PROFILE_XPI;
const now = Number(process.env.PB_NOW_MS) || Date.now();
const target = (manifest.applications && manifest.applications.zotero) || {};
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const addon = (registry.addons || []).find(entry => entry.id === pluginID);

if (!addon) {
  throw new Error(`${pluginID} is not already registered in extensions.json. Install it once through Zotero first.`);
}

addon.version = manifest.version;
addon.updateURL = target.update_url || addon.updateURL || null;
addon.manifestVersion = manifest.manifest_version || 2;
addon.defaultLocale = Object.assign({}, addon.defaultLocale || {}, {
  name: manifest.name || pluginID,
  description: manifest.description || "",
  creator: manifest.author || "",
  homepageURL: manifest.homepage_url || null
});
addon.active = true;
addon.userDisabled = false;
addon.appDisabled = false;
addon.embedderDisabled = false;
addon.softDisabled = false;
addon.visible = true;
addon.foreignInstall = false;
addon.strictCompatibility = true;
addon.seen = true;
addon.updateDate = now;
addon.path = profileXPI;
addon.sourceURI = pathToFileURL(packagePath).href;
addon.rootURI = `jar:${pathToFileURL(profileXPI).href}!/`;
addon.location = "app-profile";
addon.icons = manifest.icons || addon.icons || {};
addon.targetApplications = [{
  id: "zotero@zotero.org",
  minVersion: target.strict_min_version || "0",
  maxVersion: target.strict_max_version || "*"
}];

fs.writeFileSync(registryPath, JSON.stringify(registry), "utf8");
'@

  try {
    Set-Content -LiteralPath $tempScript -Value $script -Encoding UTF8
    & node $tempScript
    if ($LASTEXITCODE -ne 0) {
      throw "node exited with code $LASTEXITCODE while updating extensions.json"
    }
  }
  finally {
    if (Test-Path -LiteralPath $tempScript) {
      Remove-Item -LiteralPath $tempScript -Force
    }
  }
}

$resolvedPackage = Resolve-PackagePath
$resolvedProfile = if ($ProfilePath) { (Resolve-Path -LiteralPath $ProfilePath).Path } else { Resolve-DefaultZoteroProfile }
$manifest = Read-XPIManifest -Path $resolvedPackage
$zoteroApplication = $manifest.applications.zotero
if (!$zoteroApplication -or $zoteroApplication.id -ne $PluginID) {
  throw "Package $resolvedPackage has Zotero id '$($zoteroApplication.id)', expected '$PluginID'"
}

$extensionsDir = Join-Path $resolvedProfile "extensions"
$profileXPI = Join-Path $extensionsDir "$PluginID.xpi"
$extensionsJson = Join-Path $resolvedProfile "extensions.json"
if (!(Test-Path -LiteralPath $extensionsJson)) {
  throw "Cannot find $extensionsJson"
}

Stop-ZoteroGracefully -Profile $resolvedProfile
New-Item -ItemType Directory -Path $extensionsDir -Force | Out-Null
$backupDir = Backup-ProfileFiles -Profile $resolvedProfile -ProfileXPI $profileXPI
Copy-Item -LiteralPath $resolvedPackage -Destination $profileXPI -Force
Update-ExtensionRegistry `
  -ExtensionsJson $extensionsJson `
  -ManifestJson ($manifest | ConvertTo-Json -Depth 20 -Compress) `
  -Package $resolvedPackage `
  -ProfileXPI $profileXPI

foreach ($cacheFile in @(
  (Join-Path $resolvedProfile "addonStartup.json.lz4"),
  (Join-Path $resolvedProfile "compatibility.ini")
)) {
  if (Test-Path -LiteralPath $cacheFile) {
    Remove-Item -LiteralPath $cacheFile -Force
  }
}

Write-Host "Installed PaperBridge $($manifest.version) into Zotero profile:"
Write-Host "  Profile: $resolvedProfile"
Write-Host "  XPI: $profileXPI"
Write-Host "  Backup: $backupDir"
Write-Host "Restart Zotero, then run tools\verify-zotero-install.ps1 -AllowDisabled."
