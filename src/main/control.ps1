# Ty typing into an app or pressing a shortcut in it for you (only after you clicked his button).
# The app's window is brought to the front and has to stay there for every step, or nothing more
# is done. Terminals, the Registry Editor, Task Manager and Windows' own Run box are never touched.
# Args, base64 UTF-8: -App (a name or part of a window title), -Text (pasted), -Keys ("ctrl+s", "enter"…)
param([string]$App, [string]$Text, [string]$Keys)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Ty -Name Ctl -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
'@

function Out($ok, $msg) { @{ ok = $ok; message = $msg } | ConvertTo-Json -Compress; exit 0 }
function Decode($b) { if ($b) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) } else { '' } }
function InFront($h) { [Ty.Ctl]::GetForegroundWindow() -eq $h }

# where typed text could run commands or break Windows
$NEVER = 'cmd', 'powershell', 'pwsh', 'windowsterminal', 'openconsole', 'conhost', 'wsl', 'bash', 'wt',
  'regedit', 'mmc', 'taskmgr', 'msconfig', 'gpedit', 'secpol', 'services', 'systemsettings', 'control',
  'explorer', 'mintty', 'putty', 'diskmgmt', 'diskpart', 'electron', 'ty'

$app = (Decode $App).Trim()
$text = Decode $Text
$keys = (Decode $Keys).Trim().ToLower()
if (-not $app) { Out $false 'which app?' }
if (-not $text -and -not $keys) { Out $false 'nothing to type' }

$wins = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }
$win = $wins | Where-Object { $_.ProcessName -ieq $app } | Select-Object -First 1
if (-not $win) { $win = $wins | Where-Object { $_.ProcessName -like "*$app*" -or $_.MainWindowTitle -like "*$app*" } | Select-Object -First 1 }
if (-not $win) { Out $false "$app isn't open (open it first)" }
if ($NEVER -contains $win.ProcessName.ToLower()) { Out $false "$($win.ProcessName) is off-limits (terminals and system tools could break stuff)" }
$h = $win.MainWindowHandle

if ([Ty.Ctl]::IsIconic($h)) { [void][Ty.Ctl]::ShowWindow($h, 9) }
[Ty.Ctl]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Ty.Ctl]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) # Alt tap: lets it take the front
[void][Ty.Ctl]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 450
if (-not (InFront $h)) { Out $false "couldn't bring $($win.ProcessName) to the front" }

# "ctrl+shift+s", "enter", "alt+f4" -> SendKeys
$NAMED = @{ enter = '{ENTER}'; tab = '{TAB}'; esc = '{ESC}'; escape = '{ESC}'; backspace = '{BACKSPACE}'; delete = '{DELETE}'; del = '{DELETE}';
  up = '{UP}'; down = '{DOWN}'; left = '{LEFT}'; right = '{RIGHT}'; home = '{HOME}'; end = '{END}'; space = ' ';
  pageup = '{PGUP}'; pagedown = '{PGDN}'; f1 = '{F1}'; f2 = '{F2}'; f3 = '{F3}'; f4 = '{F4}'; f5 = '{F5}'; f6 = '{F6}';
  f7 = '{F7}'; f8 = '{F8}'; f9 = '{F9}'; f10 = '{F10}'; f11 = '{F11}'; f12 = '{F12}' }
function Combo($combo) {
  $mods = ''; $key = ''
  foreach ($part in ($combo -split '\+') | ForEach-Object { $_.Trim() }) {
    switch ($part) { 'ctrl' { $mods += '^' } 'control' { $mods += '^' } 'shift' { $mods += '+' } 'alt' { $mods += '%' }
      default { $key = if ($NAMED.ContainsKey($part)) { $NAMED[$part] } elseif ($part.Length -eq 1) { $part } else { throw "unknown key: $part" } } }
  }
  if (-not $key) { throw "no key in $combo" }
  "$mods$key"
}

$saved = try { [System.Windows.Forms.Clipboard]::GetText() } catch { '' }
try {
  if ($text) {
    [System.Windows.Forms.Clipboard]::SetText($text); Start-Sleep -Milliseconds 120
    if (-not (InFront $h)) { Out $false "$($win.ProcessName) lost focus, stopped" }
    [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 250
  }
  if ($keys) {
    foreach ($combo in $keys -split '\s*,\s*|\s+then\s+') {
      if (-not $combo) { continue }
      if (-not (InFront $h)) { Out $false "$($win.ProcessName) lost focus, stopped" }
      try { $sk = Combo $combo } catch { Out $false $_.Exception.Message }
      [System.Windows.Forms.SendKeys]::SendWait($sk); Start-Sleep -Milliseconds 200
    }
  }
  $did = @(); if ($text) { $did += 'typed it' }; if ($keys) { $did += "pressed $keys" }
  Out $true "$($did -join ' and ') in $($win.ProcessName)"
} finally {
  if ($saved) { [System.Windows.Forms.Clipboard]::SetText($saved) }
}
