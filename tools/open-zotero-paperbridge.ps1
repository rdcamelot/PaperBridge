param(
  [string]$ZoteroExe = "",
  [string]$ProfilePath = ""
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PaperBridgeOpenZoteroWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    public static IntPtr[] FindWindowsForProcess(int processId) {
        var windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint windowProcessId;
            GetWindowThreadProcessId(hWnd, out windowProcessId);
            if (windowProcessId == processId && IsWindow(hWnd)) {
                windows.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
"@

function Resolve-DefaultProfile {
  $profilesIni = Join-Path $env:APPDATA "Zotero\Zotero\profiles.ini"
  if (!(Test-Path -LiteralPath $profilesIni)) {
    return ""
  }

  $root = Split-Path $profilesIni -Parent
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
    return ""
  }
  if ($profile["IsRelative"] -eq "1") {
    return Join-Path $root $profile["Path"]
  }
  return $profile["Path"]
}

function Read-PrefString {
  param(
    [string]$Path,
    [string]$Name
  )
  if (!$Path -or !(Test-Path -LiteralPath $Path)) {
    return ""
  }
  $escapedName = [regex]::Escape($Name)
  $line = Select-String -LiteralPath $Path -Pattern "user_pref\(`"$escapedName`",\s*`"([^`"]*)`"\);" | Select-Object -Last 1
  if (!$line) {
    return ""
  }
  return [regex]::Match($line.Line, "user_pref\(`"$escapedName`",\s*`"([^`"]*)`"\);").Groups[1].Value
}

function Try-HelperShow {
  if (!$ProfilePath) {
    return $false
  }
  $prefsPath = Join-Path $ProfilePath "prefs.js"
  $token = Read-PrefString -Path $prefsPath -Name "extensions.paperbridge.trayToken"
  if (!$token) {
    return $false
  }
  $portText = Read-PrefString -Path $prefsPath -Name "extensions.paperbridge.trayPort"
  $port = 23128
  if ($portText -match '^\d+$') {
    $port = [int]$portText
  }
  try {
    $encodedToken = [System.Uri]::EscapeDataString($token)
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/show?token=$encodedToken" -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq "PaperBridge:OK"
  }
  catch {
    return $false
  }
}

function Normalize-PathForCompare {
  param([string]$Path)
  if (!$Path) {
    return ""
  }
  try {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd("\").ToLowerInvariant()
  }
  catch {
    return ""
  }
}

function Resolve-ZoteroExe {
  if ($ZoteroExe -and (Test-Path -LiteralPath $ZoteroExe)) {
    return (Resolve-Path -LiteralPath $ZoteroExe).Path
  }
  foreach ($candidate in @(
    "D:\Zotero\zotero.exe",
    "$env:ProgramFiles\Zotero\zotero.exe",
    "${env:ProgramFiles(x86)}\Zotero\zotero.exe"
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return ""
}

function Get-ZoteroProcesses {
  param([string]$ExpectedExe)
  $processes = @(Get-Process -Name zotero -ErrorAction SilentlyContinue)
  $expected = Normalize-PathForCompare $ExpectedExe
  if (!$expected) {
    return $processes
  }
  $matching = @()
  foreach ($process in $processes) {
    $path = ""
    try {
      $path = $process.Path
    }
    catch {}
    if ((Normalize-PathForCompare $path) -eq $expected) {
      $matching += $process
    }
  }
  if ($matching.Count -gt 0) {
    return $matching
  }
  return $processes
}

function Restore-ZoteroWindow {
  param([object[]]$Processes)
  $windows = @()
  foreach ($process in $Processes) {
    foreach ($hwnd in @([PaperBridgeOpenZoteroWin32]::FindWindowsForProcess([int]$process.Id))) {
      $windows += $hwnd
    }
  }
  if ($windows.Count -eq 0) {
    return $false
  }
  foreach ($hwnd in $windows) {
    [void][PaperBridgeOpenZoteroWin32]::ShowWindow($hwnd, 9)
  }
  [void][PaperBridgeOpenZoteroWin32]::SetForegroundWindow($windows[0])
  return $true
}

if (!$ProfilePath) {
  $ProfilePath = Resolve-DefaultProfile
}

if (Try-HelperShow) {
  exit 0
}

$resolvedZoteroExe = Resolve-ZoteroExe
$processes = @(Get-ZoteroProcesses -ExpectedExe $resolvedZoteroExe)
if ($processes.Count -gt 0 -and (Restore-ZoteroWindow -Processes $processes)) {
  exit 0
}

if (!$resolvedZoteroExe) {
  throw "Could not find zotero.exe. Pass -ZoteroExe explicitly."
}
Start-Process -FilePath $resolvedZoteroExe
