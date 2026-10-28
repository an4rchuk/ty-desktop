# Ty sending a Discord message for you, through your own Discord app (only after you clicked his
# Send button). Ctrl+K jumps to the chat, the window title has to name it before anything is typed,
# and Discord has to stay in front the whole time: if any check fails, nothing is sent.
# Args: -To and -Text, base64 UTF-8 (so no quoting can break out). -DryRun stops before typing the message.
param([string]$To, [string]$Text, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Ty -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
'@

function Out($ok, $msg) { @{ ok = $ok; message = $msg } | ConvertTo-Json -Compress; exit 0 }
function Decode($b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }
function Key($vk, [switch]$Ctrl) {
  if ($Ctrl) { [Ty.Win]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero) }
  [Ty.Win]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [Ty.Win]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
  if ($Ctrl) { [Ty.Win]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero) }
}
function Title($h) { $sb = New-Object Text.StringBuilder 512; [void][Ty.Win]::GetWindowText($h, $sb, 512); $sb.ToString() }
function Window { Get-Process Discord -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
function InFront($h) { [Ty.Win]::GetForegroundWindow() -eq $h }
function Paste($s) { [System.Windows.Forms.Clipboard]::SetText($s); Start-Sleep -Milliseconds 120; Key 0x56 -Ctrl }

$asked = (Decode $To).Trim()
$channelOnly = $asked.StartsWith('#') # "#general" is in every server: only the one you have open counts
$to = $asked.TrimStart('@', '#')
$text = Decode $Text
if (-not $to -or (-not $text -and -not $DryRun)) { Out $false 'nothing to send' }

# Discord open, or started and waited for
$win = Window
if (-not $win) {
  $update = Join-Path $env:LOCALAPPDATA 'Discord\Update.exe'
  if (-not (Test-Path $update)) { Out $false 'Discord isn''t installed' }
  Start-Process $update -ArgumentList '--processStart', 'Discord.exe'
  for ($i = 0; $i -lt 40 -and -not ($win = Window); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not $win) { Out $false 'Discord didn''t open in time' }
  Start-Sleep -Seconds 4 # it shows its window before it's ready
}
$h = $win.MainWindowHandle

# in front (an Alt tap lets a background app take the foreground)
if ([Ty.Win]::IsIconic($h)) { [void][Ty.Win]::ShowWindow($h, 9) }
Key 0x12
[void][Ty.Win]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 400
if (-not (InFront $h)) { Out $false 'couldn''t bring Discord to the front' }

$saved = try { [System.Windows.Forms.Clipboard]::GetText() } catch { '' }
try {
  $title = Title $h
  if ($title -notlike "*$to*") {
    if ($channelOnly) { Out $false "you're not in #$to right now: open it, or tell me the server name" }
    # Ctrl+K: Discord's quick switcher, to the chat
    Key 0x4B -Ctrl; Start-Sleep -Milliseconds 500
    if (-not (InFront $h)) { Out $false 'Discord lost focus' }
    Paste $to; Start-Sleep -Milliseconds 900
    Key 0x0D; Start-Sleep -Milliseconds 1300
    $title = Title $h
  }
  if ($title -notlike "*$to*") {
    if (InFront $h) { Key 0x1B } # the switcher, if it's still up
    Out $false "Discord opened `"$($title -replace ' - Discord$', '')`", not $to, so I didn't send anything"
  }
  if ($DryRun) { Out $true "dry run: chat with $to is open ($title), nothing typed" }
  # the message, piece by piece: @{name} becomes a real ping through Discord's own @ autocomplete (Tab picks it)
  foreach ($part in [regex]::Split($text, '(@\{[^}]+\})')) {
    if (-not $part) { continue }
    if (-not (InFront $h)) { Out $false 'Discord lost focus, didn''t send' }
    if ($part -match '^@\{([^}]+)\}$') {
      # only the first word: Discord's autocomplete finds the rest even when the spelling is off ("Xi Jingping")
      Paste "@$(($Matches[1].Trim() -split '\s+')[0])"; Start-Sleep -Milliseconds 1200
      Key 0x09; Start-Sleep -Milliseconds 300
    } else {
      Paste $part; Start-Sleep -Milliseconds 200
    }
  }
  Start-Sleep -Milliseconds 200
  if (-not (InFront $h)) { Out $false 'Discord lost focus, didn''t send (the text may still be in the message box)' }
  Key 0x0D
  Out $true "sent to $to"
} finally {
  if ($saved) { [System.Windows.Forms.Clipboard]::SetText($saved) }
}
