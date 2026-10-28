# Ty moving an app's window to another monitor ("move spotify to my samsung"). Keeps its size and
# place relative to the screen (shrunk if it doesn't fit), maximised again if it was.
# Args: -App (base64 UTF-8: a process name or part of a window title), -Screens (base64 JSON of every
# monitor's work area in real pixels, [{x,y,w,h}]), -To (index into it, or -1: the next one along)
param([string]$App, [string]$Screens, [int]$To = -1)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Ty -Name Mv -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsZoomed(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int w, int h2, uint flags);
[DllImport("user32.dll")] public static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr value);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
[void][Ty.Mv]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) # real pixels on every monitor (this thread: PowerShell itself is set already)

function Out($ok, $msg) { @{ ok = $ok; message = $msg } | ConvertTo-Json -Compress; exit 0 }

$app = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($App)).Trim()
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Screens))
$mons = @($json | ConvertFrom-Json | ForEach-Object { $_ }) # (PowerShell 5 hands back a JSON list as one item)
if (-not $app) { Out $false 'which app?' }

# Ty's own windows and the desktop itself stay where they are
$NEVER = 'explorer', 'electron', 'ty', 'shellexperiencehost', 'searchhost', 'startmenuexperiencehost'
$wins = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }
$win = $wins | Where-Object { $_.ProcessName -ieq $app } | Select-Object -First 1
if (-not $win) { $win = $wins | Where-Object { $_.ProcessName -like "*$app*" -or $_.MainWindowTitle -like "*$app*" } | Select-Object -First 1 }
if (-not $win) { Out $false "$app isn't open" }
if ($NEVER -contains $win.ProcessName.ToLower()) { Out $false "can't move $($win.ProcessName)" }
$h = $win.MainWindowHandle

$max = [Ty.Mv]::IsZoomed($h)
if ([Ty.Mv]::IsIconic($h) -or $max) { [void][Ty.Mv]::ShowWindow($h, 9) } # restored, to move it
$r = New-Object Ty.Mv+RECT
[void][Ty.Mv]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
$cx = $r.Left + $w / 2; $cy = $r.Top + $hgt / 2

# the monitor it's on now: the one its middle is in
$from = 0
for ($i = 0; $i -lt $mons.Count; $i++) {
  $s = $mons[$i]
  if ($cx -ge $s.x -and $cx -lt $s.x + $s.w -and $cy -ge $s.y -and $cy -lt $s.y + $s.h) { $from = $i }
}
$target = if ($To -ge 0) { $To } else { ($from + 1) % $mons.Count }
if ($target -ge $mons.Count) { Out $false 'no such monitor' }
$a = $mons[$from]; $b = $mons[$target]

# same place and the same share of the screen (75% of the Dell is 75% of the Samsung)
$nw = [Math]::Min($b.w, [int]($w / [Math]::Max(1, $a.w) * $b.w)); $nh = [Math]::Min($b.h, [int]($hgt / [Math]::Max(1, $a.h) * $b.h))
$nx = $b.x + [int](($r.Left - $a.x) / [Math]::Max(1, $a.w) * $b.w)
$ny = $b.y + [int](($r.Top - $a.y) / [Math]::Max(1, $a.h) * $b.h)
$nx = [Math]::Max($b.x, [Math]::Min($nx, $b.x + $b.w - $nw))
$ny = [Math]::Max($b.y, [Math]::Min($ny, $b.y + $b.h - $nh))
[void][Ty.Mv]::SetWindowPos($h, [IntPtr]::Zero, $nx, $ny, $nw, $nh, 0x0014) # no z-order change, no activate
# onto a monitor with other scaling (your 4K Samsung at 300%), the app resizes itself for it: set again
Start-Sleep -Milliseconds 150
[void][Ty.Mv]::SetWindowPos($h, [IntPtr]::Zero, $nx, $ny, $nw, $nh, 0x0014)
if ($max) { [void][Ty.Mv]::ShowWindow($h, 3) }
Out $true "$($win.ProcessName) -> monitor $($target + 1)"
