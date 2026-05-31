param(
    [string]$XPIPath,
    [string]$ZoteroPath = "D:\Zotero",
    [string]$ProfilePath,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

function Add-Result {
    param(
        [System.Collections.Generic.List[object]]$Results,
        [Parameter(Mandatory = $true)]
        [ValidateSet("PASS", "WARN", "FAIL", "INFO")]
        [string]$Status,
        [Parameter(Mandatory = $true)]
        [string]$Check,
        [Parameter(Mandatory = $true)]
        [string]$Detail
    )
    $Results.Add([pscustomobject]@{
        Status = $Status
        Check = $Check
        Detail = $Detail
    }) | Out-Null
}

function Split-VersionPart {
    param([string]$Part)
    if ($Part -eq "*") {
        return 999999
    }
    if ($Part -match "^(\d+)") {
        return [int]$Matches[1]
    }
    return 0
}

function Compare-VersionLike {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,
        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    $leftParts = $Left -split "[\.\-_+]" | ForEach-Object { Split-VersionPart $_ }
    $rightParts = $Right -split "[\.\-_+]" | ForEach-Object { Split-VersionPart $_ }
    $count = [Math]::Max($leftParts.Count, $rightParts.Count)
    for ($i = 0; $i -lt $count; $i++) {
        $leftValue = if ($i -lt $leftParts.Count) { $leftParts[$i] } else { 0 }
        $rightValue = if ($i -lt $rightParts.Count) { $rightParts[$i] } else { 0 }
        if ($leftValue -lt $rightValue) {
            return -1
        }
        if ($leftValue -gt $rightValue) {
            return 1
        }
    }
    return 0
}

function Read-IniSection {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Section
    )

    $values = @{}
    $active = $false
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (!$trimmed -or $trimmed.StartsWith(";")) {
            continue
        }
        if ($trimmed -match "^\[(.+)\]$") {
            $active = $Matches[1] -eq $Section
            continue
        }
        if ($active -and $trimmed -match "^([^=]+)=(.*)$") {
            $values[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $values
}

function Resolve-ZoteroProfilePath {
    $profilesIni = Join-Path $env:APPDATA "Zotero\Zotero\profiles.ini"
    if (!(Test-Path -LiteralPath $profilesIni)) {
        return $null
    }

    $current = @{}
    $profiles = @()
    foreach ($line in Get-Content -LiteralPath $profilesIni -Encoding UTF8) {
        $trimmed = $line.Trim()
        if ($trimmed -match "^\[Profile\d+\]$") {
            if ($current.Count) {
                $profiles += ,$current
            }
            $current = @{}
            continue
        }
        if ($trimmed -match "^([^=]+)=(.*)$") {
            $current[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    if ($current.Count) {
        $profiles += ,$current
    }

    $profile = $profiles | Where-Object { $_.Default -eq "1" } | Select-Object -First 1
    if (!$profile) {
        $profile = $profiles | Select-Object -First 1
    }
    if (!$profile -or !$profile.Path) {
        return $null
    }

    if ($profile.IsRelative -eq "1") {
        return Join-Path (Split-Path -Parent $profilesIni) $profile.Path
    }
    return $profile.Path
}

function Read-XPIManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entryNames = @($zip.Entries | ForEach-Object { $_.FullName })
        $entry = $zip.GetEntry("manifest.json")
        if (!$entry) {
            return @{
                EntryNames = $entryNames
                Manifest = $null
                ManifestText = $null
            }
        }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        try {
            $text = $reader.ReadToEnd()
        }
        finally {
            $reader.Close()
        }
        return @{
            EntryNames = $entryNames
            Manifest = $text | ConvertFrom-Json
            ManifestText = $text
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Invoke-Diagnosis {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetXPIPath,
        [Parameter(Mandatory = $true)]
        [string]$TargetZoteroPath,
        [string]$TargetProfilePath
    )

    $results = [System.Collections.Generic.List[object]]::new()
    $resolvedXPI = $null
    try {
        $resolvedXPI = (Resolve-Path -LiteralPath $TargetXPIPath).Path
        Add-Result $results "PASS" "XPI exists" $resolvedXPI
    }
    catch {
        Add-Result $results "FAIL" "XPI exists" "$TargetXPIPath was not found"
        return $results
    }

    $package = $null
    try {
        $package = Read-XPIManifest -Path $resolvedXPI
        Add-Result $results "PASS" "XPI opens" "Zip archive can be read"
    }
    catch {
        Add-Result $results "FAIL" "XPI opens" $_.Exception.Message
        return $results
    }

    if (!$package.Manifest) {
        Add-Result $results "FAIL" "manifest.json" "manifest.json must be at the XPI root"
        $nested = $package.EntryNames | Where-Object { $_ -match "/manifest\.json$" } | Select-Object -First 1
        if ($nested) {
            Add-Result $results "WARN" "nested manifest" "Found $nested; Zotero expects manifest.json at the archive root"
        }
        return $results
    }

    $manifest = $package.Manifest
    Add-Result $results "PASS" "manifest.json" "Root manifest parsed"
    if ($manifest.manifest_version -eq 2) {
        Add-Result $results "PASS" "manifest_version" "2"
    }
    else {
        Add-Result $results "FAIL" "manifest_version" "Expected 2, found $($manifest.manifest_version)"
    }

    $zotero = $manifest.applications.zotero
    if ($zotero) {
        Add-Result $results "PASS" "applications.zotero" "Present"
    }
    else {
        Add-Result $results "FAIL" "applications.zotero" "Required by Zotero plugin manifests"
        return $results
    }

    if ($zotero.id -and "$($zotero.id)".Contains("@")) {
        Add-Result $results "PASS" "add-on id" $zotero.id
    }
    else {
        Add-Result $results "FAIL" "add-on id" "Zotero add-on ID should be an email-like ID, found '$($zotero.id)'"
    }

    if ($zotero.update_url -and "$($zotero.update_url)" -match "^https://") {
        Add-Result $results "PASS" "update_url" $zotero.update_url
    }
    elseif ($zotero.update_url) {
        Add-Result $results "FAIL" "update_url" "Zotero 9 requires applications.zotero.update_url and it should be HTTPS; found '$($zotero.update_url)'"
    }
    else {
        Add-Result $results "FAIL" "update_url" "Zotero 9.0.4 marks Zotero extension manifests invalid when applications.zotero.update_url is missing"
    }

    if ($manifest.version) {
        Add-Result $results "PASS" "add-on version" $manifest.version
    }
    else {
        Add-Result $results "FAIL" "add-on version" "manifest.version is required"
    }

    if ("$($zotero.strict_min_version)" -match "\*") {
        Add-Result $results "FAIL" "strict_min_version" "Wildcards are rejected by Zotero's XPIInstall"
    }
    elseif ($zotero.strict_min_version) {
        Add-Result $results "PASS" "strict_min_version" $zotero.strict_min_version
    }
    else {
        Add-Result $results "WARN" "strict_min_version" "Missing; Zotero will default loosely, but explicit compatibility is safer"
    }

    if ($zotero.strict_max_version) {
        Add-Result $results "PASS" "strict_max_version" $zotero.strict_max_version
    }
    else {
        Add-Result $results "WARN" "strict_max_version" "Missing; explicit tested upper bound is recommended"
    }

    foreach ($requiredEntry in @("bootstrap.js")) {
        if ($package.EntryNames -contains $requiredEntry) {
            Add-Result $results "PASS" $requiredEntry "Found at XPI root"
        }
        else {
            Add-Result $results "FAIL" $requiredEntry "Missing from XPI root"
        }
    }

    foreach ($property in @("48", "96")) {
        $iconPath = $manifest.icons.$property
        if (!$iconPath) {
            Add-Result $results "WARN" "icon $property" "Missing"
            continue
        }
        if ($package.EntryNames -contains $iconPath) {
            Add-Result $results "PASS" "icon $property" $iconPath
        }
        else {
            Add-Result $results "FAIL" "icon $property" "Manifest points to missing $iconPath"
        }
    }

    $applicationIni = Join-Path $TargetZoteroPath "app\application.ini"
    if (Test-Path -LiteralPath $applicationIni) {
        $app = Read-IniSection -Path $applicationIni -Section "App"
        Add-Result $results "PASS" "Zotero app" "$($app.Name) $($app.Version) ($($app.ID))"
        if ($app.ID -ne "zotero@zotero.org") {
            Add-Result $results "WARN" "Zotero app id" "Expected zotero@zotero.org, found $($app.ID)"
        }
        if ($zotero.strict_min_version -and (Compare-VersionLike $app.Version $zotero.strict_min_version) -lt 0) {
            Add-Result $results "FAIL" "version >= min" "$($app.Version) is below $($zotero.strict_min_version)"
        }
        else {
            Add-Result $results "PASS" "version >= min" "$($app.Version) >= $($zotero.strict_min_version)"
        }
        if ($zotero.strict_max_version -and (Compare-VersionLike $app.Version $zotero.strict_max_version) -gt 0) {
            Add-Result $results "FAIL" "version <= max" "$($app.Version) is above $($zotero.strict_max_version)"
        }
        else {
            Add-Result $results "PASS" "version <= max" "$($app.Version) <= $($zotero.strict_max_version)"
        }
    }
    else {
        Add-Result $results "WARN" "Zotero app" "Could not find $applicationIni"
    }

    $root = Split-Path -Parent $PSScriptRoot
    $rootManifestPath = Join-Path $root "manifest.json"
    if (Test-Path -LiteralPath $rootManifestPath) {
        $rootManifest = Get-Content -LiteralPath $rootManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $expectedXPI = Join-Path $root "dist\paperbridge-$($rootManifest.version).xpi"
        $latestXPI = Join-Path $root "dist\paperbridge-latest.xpi"
        $expectedResolved = (Resolve-Path -LiteralPath $expectedXPI -ErrorAction SilentlyContinue).Path
        $latestResolved = (Resolve-Path -LiteralPath $latestXPI -ErrorAction SilentlyContinue).Path
        if ($rootManifest.applications.zotero.id -eq $zotero.id -and $resolvedXPI -ne $expectedResolved -and $resolvedXPI -ne $latestResolved) {
            Add-Result $results "WARN" "latest package" "This add-on ID's current package is $expectedXPI"
        }
        elseif ($rootManifest.applications.zotero.id -eq $zotero.id) {
            Add-Result $results "PASS" "latest package" "Selected package matches manifest version $($rootManifest.version)"
        }
    }

    if (!$TargetProfilePath) {
        $TargetProfilePath = Resolve-ZoteroProfilePath
    }
    if ($TargetProfilePath -and (Test-Path -LiteralPath $TargetProfilePath)) {
        Add-Result $results "PASS" "Zotero profile" $TargetProfilePath
        $extensionsJson = Join-Path $TargetProfilePath "extensions.json"
        if (Test-Path -LiteralPath $extensionsJson) {
            try {
                $extensions = Get-Content -LiteralPath $extensionsJson -Raw -Encoding UTF8 | ConvertFrom-Json
                $registered = $extensions.addons | Where-Object { $_.id -eq $zotero.id } | Select-Object -First 1
                if ($registered) {
                    Add-Result $results "INFO" "profile registration" "$($zotero.id) version $($registered.version), active=$($registered.active), appDisabled=$($registered.appDisabled), userDisabled=$($registered.userDisabled)"
                }
                else {
                    Add-Result $results "INFO" "profile registration" "$($zotero.id) is not currently registered"
                }
            }
            catch {
                Add-Result $results "WARN" "extensions.json" "Could not parse profile extensions.json: $($_.Exception.Message)"
            }
        }
        $profileXPI = Join-Path $TargetProfilePath "extensions\$($zotero.id).xpi"
        if (Test-Path -LiteralPath $profileXPI) {
            Add-Result $results "INFO" "profile XPI file" "A profile XPI exists at $profileXPI"
        }
    }
    else {
        Add-Result $results "WARN" "Zotero profile" "Default Zotero profile could not be located"
    }

    return $results
}

function Invoke-SelfTest {
    $results = [System.Collections.Generic.List[object]]::new()
    if ((Compare-VersionLike "9.0.4" "6.999") -lt 0) {
        throw "Version comparison failed for minimum"
    }
    if ((Compare-VersionLike "9.0.4" "11.*") -gt 0) {
        throw "Version comparison failed for wildcard maximum"
    }
    if ((Compare-VersionLike "12.0" "11.*") -le 0) {
        throw "Version comparison failed for version above wildcard maximum"
    }
    Add-Result $results "PASS" "self-test" "Version comparison checks passed"
    return $results
}

if ($SelfTest) {
    $results = Invoke-SelfTest
}
else {
    if (!$XPIPath) {
        $root = Split-Path -Parent $PSScriptRoot
        $manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        $XPIPath = Join-Path $root "dist\paperbridge-$($manifest.version).xpi"
    }
    $results = Invoke-Diagnosis -TargetXPIPath $XPIPath -TargetZoteroPath $ZoteroPath -TargetProfilePath $ProfilePath
}

$results | Format-Table -AutoSize
if ($results | Where-Object { $_.Status -eq "FAIL" }) {
    exit 1
}
