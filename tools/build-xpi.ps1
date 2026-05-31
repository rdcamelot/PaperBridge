param(
    [string]$OutFile
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist"
$usingDefaultOutFile = !$PSBoundParameters.ContainsKey("OutFile") -or !$OutFile
if (!$OutFile) {
    $manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = if ($manifest.version) { $manifest.version } else { "dev" }
    $OutFile = Join-Path $outDir "paperbridge-$version.xpi"
}
elseif (![System.IO.Path]::IsPathRooted($OutFile)) {
    $OutFile = Join-Path $root $OutFile
}
if (!(Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

$items = @(
    "manifest.json",
    "bootstrap.js",
    "prefs.js",
    "preferences.xhtml",
    "preferences.js",
    "style.css",
    "chrome",
    "icons",
    "locale"
)

Push-Location $root
try {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $rootPrefix = (Resolve-Path -LiteralPath $root).Path.TrimEnd("\") + "\"
    $stream = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create)
    try {
        $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($item in $items) {
                if (Test-Path -LiteralPath $item -PathType Leaf) {
                    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                        $archive,
                        (Resolve-Path -LiteralPath $item).Path,
                        $item.Replace("\", "/")
                    ) | Out-Null
                    continue
                }

                Get-ChildItem -LiteralPath $item -Recurse -File | ForEach-Object {
                    $relativePath = $_.FullName.Substring($rootPrefix.Length).Replace("\", "/")
                    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                        $archive,
                        $_.FullName,
                        $relativePath
                    ) | Out-Null
                }
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
finally {
    Pop-Location
}

Write-Host "Built $OutFile"
if ($usingDefaultOutFile) {
    $latestFile = Join-Path $outDir "paperbridge-latest.xpi"
    Copy-Item -LiteralPath $OutFile -Destination $latestFile -Force
    Write-Host "Built $latestFile"
}
