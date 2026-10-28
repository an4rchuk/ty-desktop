'use strict';

// Ty doing PC things you ask for: the weather (Open-Meteo, free, only the city name is sent), Discord's
// mute and deafen, locking the PC, minimising everything and bringing it back, and shutting down,
// restarting or sleeping (those three only ever after your click on his button, chat.js).

const { execFile, spawn } = require('node:child_process');

const WIN = process.platform === 'win32';

function ps(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout }, (err, out) => (err ? reject(err) : resolve(String(out).trim())));
  });
}

// ---------- weather ----------

const SKY = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers',
  82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm',
  96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
};

// "Manchester: 7°C (feels 4°C), light rain, wind 18 km/h. Today 4–9°C, 80% chance of rain. Tomorrow…"
async function weather(city, units = 'metric') {
  const name = String(city || '').trim();
  if (!name) return { ok: false, text: 'no home city set (right-click Ty › Deck › Assistant)' };
  try {
    const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`,
      { signal: AbortSignal.timeout(8000) })).json();
    const place = geo.results?.[0];
    if (!place) return { ok: false, text: `couldn't find a place called "${name}"` };
    const imperial = units === 'imperial';
    const q = new URLSearchParams({
      latitude: place.latitude, longitude: place.longitude, timezone: 'auto', forecast_days: '2',
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
      temperature_unit: imperial ? 'fahrenheit' : 'celsius', wind_speed_unit: imperial ? 'mph' : 'kmh',
    });
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) })).json();
    const deg = imperial ? '°F' : '°C';
    const wind = imperial ? 'mph' : 'km/h';
    const r = (n) => Math.round(n);
    const c = w.current;
    const d = w.daily;
    const day = (i, label) => `${label} ${r(d.temperature_2m_min[i])}–${r(d.temperature_2m_max[i])}${deg}, ${SKY[d.weather_code[i]] || 'mixed'}, ${d.precipitation_probability_max[i] ?? 0}% chance of rain`;
    const where = [place.name, place.admin1, place.country].filter(Boolean).slice(0, 2).join(', ');
    return {
      ok: true,
      text: `${where}: ${r(c.temperature_2m)}${deg} (feels ${r(c.apparent_temperature)}${deg}), ${SKY[c.weather_code] || 'mixed'}, wind ${r(c.wind_speed_10m)} ${wind}. ${day(0, 'Today')}. ${day(1, 'Tomorrow')}.`,
    };
  } catch (err) {
    return { ok: false, text: `weather didn't load: ${err.message}` };
  }
}

// ---------- Discord: mute, deafen ----------

// Your own keybind (set in Discord › Keybinds, works anywhere) is just pressed; with none, Discord's
// built-in Ctrl+Shift+M / Ctrl+Shift+D, which need Discord in front for a split second: it's brought
// up, the keys pressed, and the window you were in put back.
const SENDKEYS = (combo) => combo.toLowerCase().split('+').map((k) => k.trim()).reduce((acc, k) => {
  if (k === 'ctrl' || k === 'control') return { ...acc, mods: `${acc.mods}^` };
  if (k === 'shift') return { ...acc, mods: `${acc.mods}+` };
  if (k === 'alt') return { ...acc, mods: `${acc.mods}%` };
  if (/^f\d{1,2}$/.test(k)) return { ...acc, key: `{${k.toUpperCase()}}` };
  return { ...acc, key: k.length === 1 ? k : `{${k.toUpperCase()}}` };
}, { mods: '', key: '' });

async function discordToggle(what, keybind) {
  if (!WIN) return { ok: false, text: 'Windows only' };
  const custom = String(keybind || '').trim();
  const { mods, key } = SENDKEYS(custom || (what === 'deafen' ? 'ctrl+shift+d' : 'ctrl+shift+m'));
  if (!key) return { ok: false, text: `that keybind doesn't look right: ${custom}` };
  const send = `[System.Windows.Forms.SendKeys]::SendWait('${mods}${key}')`;
  const script = custom
    ? `Add-Type -AssemblyName System.Windows.Forms; ${send}; 'ok'`
    : `Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Ty -Name Fg -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);'
$d = Get-Process Discord -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $d) { 'closed'; exit }
$prev = [Ty.Fg]::GetForegroundWindow(); $min = [Ty.Fg]::IsIconic($d.MainWindowHandle)
if ($min) { [void][Ty.Fg]::ShowWindow($d.MainWindowHandle, 9) }
[Ty.Fg]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [Ty.Fg]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[void][Ty.Fg]::SetForegroundWindow($d.MainWindowHandle); Start-Sleep -Milliseconds 250
if ([Ty.Fg]::GetForegroundWindow() -ne $d.MainWindowHandle) { 'focus'; exit }
${send}; Start-Sleep -Milliseconds 120
if ($min) { [void][Ty.Fg]::ShowWindow($d.MainWindowHandle, 6) }
[void][Ty.Fg]::SetForegroundWindow($prev); 'ok'`;
  try {
    const out = await ps(script);
    if (out.endsWith('closed')) return { ok: false, text: 'Discord isn’t open (or it’s only in the tray: set your own keybind in the Deck to reach it there)' };
    if (out.endsWith('focus')) return { ok: false, text: 'couldn’t get to Discord’s window' };
    return { ok: true, text: what === 'deafen' ? 'toggled deafen' : 'toggled mute' };
  } catch (err) {
    return { ok: false, text: err.message.split('\n')[0] };
  }
}

// ---------- the PC itself ----------

const detach = (cmd, args) => new Promise((resolve) => {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => resolve(false));
  child.on('spawn', () => { child.unref(); resolve(true); });
});

async function lock() {
  // Mac: the screen off (locked when "require password" is on); Linux: the session's own lock
  const ok = process.platform === 'darwin' ? await detach('pmset', ['displaysleepnow'])
    : !WIN ? (await detach('loginctl', ['lock-session'])) || (await detach('xdg-screensaver', ['lock']))
      : await detach('rundll32.exe', ['user32.dll,LockWorkStation']);
  return ok ? { ok: true, text: 'locked' } : { ok: false, text: 'couldn’t lock it on this system' };
}

async function windows(how) {
  if (!WIN) return { ok: false, text: 'minimising everything only works on Windows for now' };
  await ps(`(New-Object -ComObject Shell.Application).${how === 'restore' ? 'UndoMinimizeALL' : 'MinimizeAll'}()`);
  return { ok: true, text: how === 'restore' ? 'windows back' : 'everything minimised' };
}

// shut down, restart, sleep: only from his button (chat.js), never on the model's word
async function power(action) {
  const mac = (verb) => ['osascript', ['-e', `tell application "System Events" to ${verb}`]];
  const cmd = (process.platform === 'darwin' ? {
    shutdown: mac('shut down'), restart: mac('restart'), sleep: mac('sleep'),
  } : !WIN ? {
    shutdown: ['systemctl', ['poweroff']], restart: ['systemctl', ['reboot']], sleep: ['systemctl', ['suspend']],
  } : {
    shutdown: ['shutdown.exe', ['/s', '/t', '5']],
    restart: ['shutdown.exe', ['/r', '/t', '5']],
    sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
  })[action];
  if (!cmd) return { ok: false, text: 'unknown' };
  if (!(await detach(cmd[0], cmd[1]))) return { ok: false, text: `couldn’t ${action} on this system` };
  return { ok: true, text: action === 'sleep' ? 'going to sleep' : `${action === 'restart' ? 'restarting' : 'shutting down'}${WIN ? ' in 5 seconds' : ''}` };
}

// ---------- moving a window to another monitor ----------

const path = require('node:path');
const MOVE = path.join(__dirname, 'move.ps1').replace('app.asar', 'app.asar.unpacked');
const ORDINALS = { first: 1, one: 1, main: 1, primary: 1, second: 2, two: 2, third: 3, three: 3, fourth: 4, four: 4 };

// Your monitors: "monitor 1" is your main one, then the others left to right (top to bottom). Each
// with its name (the model, as Windows knows it: "DELL P2422HE", "SAMSUNG"…) so "my samsung" finds it.
function monitors() {
  const { screen } = require('electron');
  const main = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays()
    .sort((a, b) => (b.id === main) - (a.id === main) || a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d, i) => ({ n: i + 1, label: d.label || '', primary: d.id === main, bounds: d.bounds, area: screen.dipToScreenRect(null, d.workArea) }));
}

// the monitor furthest that way: left, right, top or bottom
function furthest(list, side) {
  const key = { left: (m) => m.bounds.x, right: (m) => -(m.bounds.x + m.bounds.width), top: (m) => m.bounds.y, bottom: (m) => -(m.bounds.y + m.bounds.height) }[side];
  return list.reduce((best, m, i) => (key(m) < key(list[best]) ? i : best), 0);
}

// Which monitor "where" means: a number, first/second, left/right, main, a brand or model name, or
// "other"/"next" (-1: the next one along from where the window is).
function whichMonitor(where, list) {
  const w = String(where || '').toLowerCase().replace(/\b(my|the|monitor|screen|display|one)\b/g, (m) => (m === 'one' ? '1' : ' ')).trim();
  const num = /\b(\d)\b/.exec(w)?.[1] || ORDINALS[Object.keys(ORDINALS).find((k) => new RegExp(`\\b${k}\\b`).test(w))];
  if (/\b(main|primary)\b/.test(w)) return list.findIndex((m) => m.primary);
  if (num) return Number(num) <= list.length ? Number(num) - 1 : null;
  const side = /\b(left|right|top|bottom|up|down|above|below|upper|lower)\b/.exec(w)?.[1];
  if (side) return furthest(list, { up: 'top', above: 'top', upper: 'top', down: 'bottom', below: 'bottom', lower: 'bottom' }[side] || side);
  if (!w || /\b(other|next|second)\b/.test(w)) return -1;
  const words = w.split(/\s+/).filter((x) => x.length > 2);
  const hit = list.findIndex((m) => words.some((x) => m.label.toLowerCase().includes(x)));
  return hit >= 0 ? hit : null;
}

// { ok, text }
function moveWindow(app, where) {
  if (!WIN) return Promise.resolve({ ok: false, text: 'Windows only' });
  const list = monitors();
  if (list.length < 2) return Promise.resolve({ ok: false, text: 'you’ve only got one monitor plugged in' });
  const to = whichMonitor(where, list);
  const names = list.map((m) => `${m.n}: ${m.label || "monitor"}${m.primary ? " (main)" : ""}`).join(', ');
  if (to === null) return Promise.resolve({ ok: false, text: `no monitor called "${where}" (you’ve got ${names})` });
  const screens = Buffer.from(JSON.stringify(list.map((m) => ({ x: m.area.x, y: m.area.y, w: m.area.width, h: m.area.height }))), 'utf8').toString('base64');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', MOVE, '-App', Buffer.from(app, 'utf8').toString('base64'), '-Screens', screens, '-To', String(to)];
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 15000 }, (err, out) => {
      try {
        const res = JSON.parse(String(out || '').trim().split(/\r?\n/).pop());
        const n = Number(/monitor (\d+)/.exec(res.message)?.[1]);
        const m = list[n - 1];
        resolve({ ok: res.ok, text: res.ok ? `moved ${app} to monitor ${n}${m?.label ? ` (${m.label})` : ""}` : res.message });
      } catch {
        resolve({ ok: false, text: err ? err.message.split('\n')[0] : 'something went wrong' });
      }
    });
  });
}

module.exports = { weather, discordToggle, lock, windows, power, moveWindow, monitors };
