param(
    [string]$OutFile
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $PSScriptRoot "diagnostic-xpi"
$outDir = Join-Path $root "dist"
if (!$OutFile) {
    $manifest = Get-Content -LiteralPath (Join-Path $sourceDir "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $OutFile = Join-Path $outDir "paperbridge-diagnostic-$($manifest.version).xpi"
}
elseif (![System.IO.Path]::IsPathRooted($OutFile)) {
    $OutFile = Join-Path $root $OutFile
}
if (!(Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePrefix = (Resolve-Path -LiteralPath $sourceDir).Path.TrimEnd("\") + "\"
$stream = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Create)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $sourceDir -Recurse -File | ForEach-Object {
            $relativePath = $_.FullName.Substring($sourcePrefix.Length).Replace("\", "/")
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $_.FullName,
                $relativePath
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $stream.Dispose()
}

Write-Host "Built $OutFile"
