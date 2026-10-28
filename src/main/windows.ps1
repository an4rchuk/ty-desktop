# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window and the visible
# windows in z-order (front first), as physical-pixel frame bounds. No titles, no contents.
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid>

param([long]$Self = 0, [int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }

  // Ty's game mode: the window in front is a game (from a game folder), or anything but a browser or
  // video player covering its whole monitor. Only the program's path is looked at, never the window.
  static readonly System.Text.RegularExpressions.Regex GameDir = new System.Text.RegularExpressions.Regex(
    @"[\\/](steamapps[\\/]common|Epic Games|Riot Games|XboxGames|Ubisoft Game Launcher[\\/]games|EA Games|GOG Galaxy[\\/]Games|Battle\.net)[\\/]|[\\/]WindowsApps[\\/].*(Minecraft|Xbox)|RobloxPlayerBeta\.exe$|javaw\.exe$",
    System.Text.RegularExpressions.RegexOptions.IgnoreCase);
  static readonly System.Text.RegularExpressions.Regex NotGame = new System.Text.RegularExpressions.Regex(
    @"[\\/](chrome|firefox|msedge|opera|brave|vivaldi|vlc|mpc-hc64|mpv|potplayer\w*|explorer|ApplicationFrameHost|Ty|electron|EpicGamesLauncher|RiotClientServices|RiotClientUx|Battle\.net|Battle\.net Launcher|UbisoftConnect|upc|EADesktop|steamwebhelper|GalaxyClient)\.exe$",
    System.Text.RegularExpressions.RegexOptions.IgnoreCase);

  static string ExePath(IntPtr hwnd) {
    int pid;
    GetWindowThreadProcessId(hwnd, out pid);
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return "";
    var sb = new StringBuilder(1024);
    int size = sb.Capacity;
    string path = QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    CloseHandle(h);
    return path;
  }

  static bool Gaming(IntPtr fg) {
    if (fg == IntPtr.Zero) return false;
    string exe = ExePath(fg);
    if (exe == "" || NotGame.IsMatch(exe)) return false;
    if (GameDir.IsMatch(exe)) return true;
    RECT r;
    if (!GetWindowRect(fg, out r)) return false;
    var mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi)) return false;
    return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
  }
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    IntPtr fg = GetForegroundWindow();
    var fgClass = new StringBuilder(64);
    GetClassName(fg, fgClass, 64);
    // the taskbar clicked: it comes up over her (Windows has no levels among windows on top)
    bool taskbar = fgClass.ToString() == "Shell_TrayWnd" || fgClass.ToString() == "Shell_SecondaryTrayWnd";
    bool game = !taskbar && fgClass.ToString() != "Progman" && fgClass.ToString() != "WorkerW" && Gaming(fg);
    sb.Append("{\"fg\":").Append(fg.ToInt64()).Append(",\"taskbar\":").Append(taskbar ? "true" : "false").Append(",\"game\":").Append(game ? "true" : "false").Append(",\"wins\":[");
    int count = 0;
    EnumWindows((h, l) => {
      if (count >= 40) return false;
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("]}");
    return sb.ToString();
  }
}
"@

[CapriWindows]::Init()
$last = ''
$tick = 0
while ($true) {
  $snap = [CapriWindows]::Snapshot($Self)
  if ($snap -ne $last) {
    [Console]::Out.WriteLine($snap)
    [Console]::Out.Flush()
    $last = $snap
  }
  # stop with Capri, even if she crashed without telling us
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 150
}
