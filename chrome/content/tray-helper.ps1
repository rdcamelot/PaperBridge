param(
    [int]$Port = 23128,
    [int]$ZoteroPid = 0,
    [string]$ZoteroExe = "",
    [string]$Token = "",
    [string]$QuitRequestPath = "",
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PaperBridgeWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int count);

    public static IntPtr[] FindWindowsForProcess(int processId, bool visibleOnly) {
        var windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint windowProcessId;
            GetWindowThreadProcessId(hWnd, out windowProcessId);
            if (windowProcessId == processId && (!visibleOnly || IsWindowVisible(hWnd))) {
                windows.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static string WindowText(IntPtr hWnd) {
        var text = new System.Text.StringBuilder(512);
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static string WindowClass(IntPtr hWnd) {
        var text = new System.Text.StringBuilder(256);
        GetClassName(hWnd, text, text.Capacity);
        return text.ToString();
    }
}
"@

if ($SelfTest) {
    "PaperBridge tray helper self-test passed"
    exit 0
}

[void][PaperBridgeWin32]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

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

function Add-ProcessIfUnique {
    param(
        [System.Collections.ArrayList]$Processes,
        [hashtable]$Seen,
        [object]$Process
    )

    if (!$Process -or $Seen.ContainsKey([int]$Process.Id)) {
        return
    }
    [void]$Seen.Add([int]$Process.Id, $true)
    [void]$Processes.Add($Process)
}

function Get-ZoteroProcesses {
    $processes = [System.Collections.ArrayList]::new()
    $seen = @{}

    if ($ZoteroPid -gt 0) {
        Add-ProcessIfUnique -Processes $processes -Seen $seen -Process (Get-Process -Id $ZoteroPid -ErrorAction SilentlyContinue)
    }

    foreach ($process in @(Get-Process -Name zotero -ErrorAction SilentlyContinue)) {
        Add-ProcessIfUnique -Processes $processes -Seen $seen -Process $process
    }

    $expectedPath = Normalize-PathForCompare $ZoteroExe
    if (!$expectedPath) {
        return @($processes)
    }

    $matching = @()
    foreach ($process in @($processes)) {
        $processPath = ""
        try {
            $processPath = $process.Path
        }
        catch {}
        if ((Normalize-PathForCompare $processPath) -eq $expectedPath) {
            $matching += $process
        }
    }

    if ($matching.Count -gt 0) {
        return $matching
    }
    return @($processes)
}

function Get-ZoteroWindows {
    param([switch]$VisibleOnly)

    $windows = @()
    $seen = @{}
    foreach ($process in @(Get-ZoteroProcesses)) {
        foreach ($hwnd in @([PaperBridgeWin32]::FindWindowsForProcess([int]$process.Id, [bool]$VisibleOnly))) {
            $key = $hwnd.ToInt64()
            if (!$seen.ContainsKey($key)) {
                $seen[$key] = $true
                $windows += $hwnd
            }
        }
    }
    return $windows
}

function Test-ZoteroMainWindow {
    param([IntPtr]$Hwnd)

    if ($Hwnd -eq [IntPtr]::Zero) {
        return $false
    }
    $class = [PaperBridgeWin32]::WindowClass($Hwnd)
    $title = [PaperBridgeWin32]::WindowText($Hwnd)
    return $class -eq "MozillaWindowClass" -and $title -like "*Zotero*"
}

function Get-ZoteroMainWindows {
    param([switch]$VisibleOnly)

    $windows = if ($VisibleOnly) {
        @(Get-ZoteroWindows -VisibleOnly)
    }
    else {
        @(Get-ZoteroWindows)
    }
    return @($windows | Where-Object { Test-ZoteroMainWindow $_ })
}

function Hide-Zotero {
    $windows = @(Get-ZoteroMainWindows -VisibleOnly)
    if ($windows.Count -eq 0) {
        # Treat hide as idempotent. During close-to-tray the visible top-level
        # window can disappear before the helper receives the command, and a
        # second hide command may arrive while Zotero is already hidden.
        $allWindows = @(Get-ZoteroMainWindows)
        if ($allWindows.Count -gt 0 -or @(Get-ZoteroProcesses).Count -gt 0) {
            return $true
        }
        return $false
    }
    $script:hiddenWindowHandles = @($windows)
    foreach ($hwnd in $windows) {
        [void][PaperBridgeWin32]::ShowWindow($hwnd, 0)
    }
    return $true
}

function Show-Zotero {
    $windows = @($script:hiddenWindowHandles | Where-Object { [PaperBridgeWin32]::IsWindow($_) -and (Test-ZoteroMainWindow $_) })
    if ($windows.Count -eq 0) {
        $windows = @(Get-ZoteroMainWindows)
    }
    if ($windows.Count -eq 0) {
        return $false
    }
    foreach ($hwnd in $windows) {
        [void][PaperBridgeWin32]::ShowWindow($hwnd, 9)
    }
    $script:hiddenWindowHandles = @()
    if ($windows.Count -gt 0) {
        [void][PaperBridgeWin32]::SetForegroundWindow($windows[0])
    }
    return $true
}

function Zotero-IsVisible {
    return @(Get-ZoteroWindows -VisibleOnly).Count -gt 0
}

function Toggle-Zotero {
    if (Zotero-IsVisible) {
        return Hide-Zotero
    }
    else {
        return Show-Zotero
    }
}

function Request-Zotero-Quit {
    if ($QuitRequestPath) {
        try {
            $directory = [System.IO.Path]::GetDirectoryName($QuitRequestPath)
            if ($directory -and !(Test-Path -LiteralPath $directory)) {
                [System.IO.Directory]::CreateDirectory($directory) | Out-Null
            }
            [System.IO.File]::WriteAllText($QuitRequestPath, $Token, [System.Text.Encoding]::UTF8)
        }
        catch {}
    }

    $windows = @(Get-ZoteroMainWindows)
    if ($windows.Count -eq 0) {
        $windows = @(Get-ZoteroWindows)
    }
    foreach ($hwnd in $windows) {
        [void][PaperBridgeWin32]::ShowWindow($hwnd, 9)
        [void][PaperBridgeWin32]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    }

    return $true
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()

$context = [System.Windows.Forms.ApplicationContext]::new()
$tray = [System.Windows.Forms.NotifyIcon]::new()
$tray.Text = "Zotero PaperBridge"
$script:stopping = $false
$script:processCheckTicks = 0
$script:processLaunchCheckTicks = 0
$script:hiddenWindowHandles = @()
$script:knownZoteroProcessIDs = @{}

function Update-KnownZoteroProcesses {
    $current = @{}
    foreach ($process in @(Get-ZoteroProcesses)) {
        $current[[int]$process.Id] = $true
    }
    $script:knownZoteroProcessIDs = $current
}

function Show-Zotero-When-NewProcessAppears {
    $processes = @(Get-ZoteroProcesses)
    $current = @{}
    $hasNewProcess = $false
    foreach ($process in $processes) {
        $id = [int]$process.Id
        $current[$id] = $true
        if (!$script:knownZoteroProcessIDs.ContainsKey($id)) {
            $hasNewProcess = $true
        }
    }
    $script:knownZoteroProcessIDs = $current

    if ($hasNewProcess -and !(Zotero-IsVisible)) {
        Show-Zotero | Out-Null
    }
}

function Stop-Helper {
    param([bool]$RestoreZotero = $false)

    if ($script:stopping) {
        return
    }
    $script:stopping = $true
    if ($RestoreZotero) {
        Show-Zotero
    }
    try { $timer.Stop() } catch {}
    try { $tray.Visible = $false } catch {}
    try { $tray.Dispose() } catch {}
    try { $listener.Stop() } catch {}
    [System.Windows.Forms.Application]::Exit()
}

try {
    if ($ZoteroExe -and (Test-Path -LiteralPath $ZoteroExe)) {
        $tray.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ZoteroExe)
    }
    else {
        $tray.Icon = [System.Drawing.SystemIcons]::Application
    }
}
catch {
    $tray.Icon = [System.Drawing.SystemIcons]::Application
}

$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$showItem = [System.Windows.Forms.ToolStripMenuItem]::new("Open Zotero")
$exitItem = [System.Windows.Forms.ToolStripMenuItem]::new("Quit Zotero")
$showItem.add_Click({ Show-Zotero })
$exitItem.add_Click({ Request-Zotero-Quit })
[void]$menu.Items.Add($showItem)
[void]$menu.Items.Add($exitItem)
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Show-Zotero
    }
})
$tray.Visible = $true
Update-KnownZoteroProcesses

function Write-HttpResponse {
    param(
        [System.Net.Sockets.TcpClient]$Client,
        [string]$Body = "PaperBridge:OK",
        [int]$StatusCode = 200,
        [string]$StatusText = "OK"
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $header = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream = $Client.GetStream()
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($bytes, 0, $bytes.Length)
}

function Parse-RequestTarget {
    param([string]$RequestLine)

    $result = @{
        Command = "ping"
        Token = ""
    }
    if ($RequestLine -notmatch "^[A-Z]+ ([^ ]+)") {
        return $result
    }

    $target = $Matches[1]
    $query = ""
    $queryIndex = $target.IndexOf("?")
    if ($queryIndex -ge 0) {
        $path = $target.Substring(0, $queryIndex).Trim("/")
        $query = $target.Substring($queryIndex + 1)
    }
    else {
        $path = $target.Trim("/")
    }
    if ($path) {
        $result.Command = [System.Uri]::UnescapeDataString($path)
    }
    if ($query) {
        foreach ($pair in $query.Split("&")) {
            $equalIndex = $pair.IndexOf("=")
            if ($equalIndex -gt 0 -and $pair.Substring(0, $equalIndex) -eq "token") {
                $result.Token = [System.Uri]::UnescapeDataString($pair.Substring($equalIndex + 1))
            }
        }
    }
    return $result
}

function Handle-Command {
    param([string]$Command)

    switch ($Command) {
        "hide" { return Hide-Zotero }
        "show" { return Show-Zotero }
        "toggle" { return Toggle-Zotero }
        "ping" { return $true }
        "quit-zotero" { return Request-Zotero-Quit }
        "quit-helper" {
            Stop-Helper
            return $true
        }
        default { return $false }
    }
}

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 250
$timer.add_Tick({
    $script:processLaunchCheckTicks++
    if ($script:processLaunchCheckTicks -ge 2) {
        $script:processLaunchCheckTicks = 0
        Show-Zotero-When-NewProcessAppears
    }

    $script:processCheckTicks++
    if ($script:processCheckTicks -ge 20) {
        $script:processCheckTicks = 0
        if (@(Get-ZoteroProcesses).Count -eq 0) {
            Stop-Helper
            return
        }
    }

    while ($listener.Pending()) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 1000
            $client.SendTimeout = 1000
            $reader = [System.IO.StreamReader]::new($client.GetStream())
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                throw "Empty HTTP request"
            }
            $headerLines = 0
            while (($line = $reader.ReadLine()) -ne $null -and $line.Length -gt 0) {
                $headerLines++
                if ($headerLines -gt 64) {
                    throw "HTTP request headers are too large"
                }
            }
            $request = Parse-RequestTarget $requestLine
            if ($Token -and $request["Token"] -ne $Token) {
                Write-HttpResponse -Client $client -Body "PaperBridge:FORBIDDEN" -StatusCode 403 -StatusText "Forbidden"
                continue
            }
            if (!(Handle-Command $request["Command"])) {
                Write-HttpResponse -Client $client -Body "PaperBridge:NOT_FOUND" -StatusCode 404 -StatusText "Not Found"
                continue
            }
            Write-HttpResponse -Client $client
        }
        catch {
            try { Write-HttpResponse -Client $client -Body "ERROR" } catch {}
        }
        finally {
            $client.Close()
        }
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run($context)
