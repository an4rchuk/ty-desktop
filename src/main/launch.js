'use strict';

// Opening things when you ask her to (chat.js): an app from the Start menu (Store apps like Spotify
// included), a Steam or Epic game, your music (the media keys: pause, next…, so it works with
// Spotify and most players), a Spotify search, or a website. Windows only.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { shell } = require('electron');
const { powershell } = require('./apps');
const config = require('./config');

const WIN = process.platform === 'win32';
// not things to open from a chat: uninstallers, help pages and the like
const SKIP = /uninstall|désinstaller|desinstalar|deinstall|readme|documentation|release notes|support center|website|manual/i;
const STEAM_SKIP = /redistributable|dedicated server|steamworks/i;
// words that don't tell apps apart ("Roblox Player" is "roblox")
const FILLER = new Set(['player', 'launcher', 'app', 'the', 'for', 'windows', 'desktop', 'client', 'x64', 'x86', 'beta']);
const CACHE_MS = 10 * 60 * 1000; // installed apps hardly change

let cache = null; // { at, items }

const plain = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const words = (text) => plain(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

// The apps you named yourself in his Deck, each under its name and every "also say" one, first in line
// ({ name, aliases: 'blocks strap, blox strap', path, args }): [{ name, kind: 'custom', id: index }]
function customItems() {
  return (config.load().customApps || []).flatMap((a, i) => (a?.name && a?.path
    ? [a.name, ...String(a.aliases || '').split(',')].map((n) => n.trim()).filter(Boolean).map((name) => ({ name, kind: 'custom', id: i }))
    : []));
}

// Everything she can open: [{ name, kind: 'app' | 'steam' | 'epic' | 'custom', id }]
async function launchables() {
  return [...customItems(), ...(await installed())];
}

async function installed() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!WIN) {
    // a Mac's .app bundles, Linux's .desktop entries, and Steam games on either
    const items = [];
    const seen = new Set();
    for (const item of [...steamGames(await steamRoot()), ...(process.platform === 'darwin' ? macApps() : linuxApps())]) {
      const key = words(item.name).join(' ');
      if (!key || seen.has(key) || SKIP.test(item.name)) continue;
      seen.add(key);
      items.push(item);
    }
    cache = { at: Date.now(), items };
    return items;
  }
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const key = words(item.name).join(' ');
    if (!key || seen.has(key) || SKIP.test(item.name)) return;
    seen.add(key);
    items.push(item);
  };
  // games first: a game's own entry wins over a shortcut to it
  for (const game of [...steamGames(await steamRoot()), ...epicGames()]) add(game);
  // the Start menu's list is slow the first time (PowerShell starting cold): main.js asks for it early
  const out = await powershell('Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress', 45000).catch(() => null);
  for (const { Name, AppID } of [].concat(out ? JSON.parse(out) : [])) {
    if (Name && AppID && !/^https?:/i.test(AppID)) add({ name: Name, kind: 'app', id: AppID });
  }
  if (out !== null) cache = { at: Date.now(), items }; // a list that failed isn't kept: next time, again
  return items;
}

function steamRoot() {
  if (!WIN) {
    // Mac and Linux keep Steam in your home folder
    const home = require('node:os').homedir();
    const spots = process.platform === 'darwin'
      ? [path.join(home, 'Library', 'Application Support', 'Steam')]
      : [path.join(home, '.steam', 'steam'), path.join(home, '.local', 'share', 'Steam'), path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')];
    return Promise.resolve(spots.find((p) => fs.existsSync(path.join(p, 'steamapps'))) || null);
  }
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      const found = !err && /SteamPath\s+REG_SZ\s+(.+)/.exec(String(out))?.[1].trim();
      resolve(found ? path.normalize(found) : null);
    });
  });
}

// Steam's games, from the manifests in each of its libraries
// Mac: the apps in /Applications (and the system's, and your own ~/Applications), opened with `open -a`
function macApps() {
  const home = require('node:os').homedir();
  const items = [];
  for (const dir of ['/Applications', '/Applications/Utilities', '/System/Applications', path.join(home, 'Applications')]) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.app'));
    } catch {
      continue;
    }
    for (const n of names) items.push({ name: n.replace(/\.app$/, ''), kind: 'app', id: path.join(dir, n) });
  }
  return items;
}

// Linux: the .desktop entries your app menu shows (system, your own, Flatpak, Snap), opened with gtk-launch
function linuxApps() {
  const home = require('node:os').homedir();
  const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(home, '.local', 'share', 'applications'),
    '/var/lib/flatpak/exports/share/applications', path.join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
    '/var/lib/snapd/desktop/applications'];
  const items = [];
  for (const dir of dirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop'));
    } catch {
      continue;
    }
    for (const f of files) {
      let text = '';
      try {
        text = fs.readFileSync(path.join(dir, f), 'utf8');
      } catch {
        continue;
      }
      const entry = text.split(/^\[/m).find((s) => s.startsWith('Desktop Entry]')) || '';
      if (/^(NoDisplay|Hidden)=true/m.test(entry) || !/^Type=Application/m.test(entry)) continue;
      const name = /^Name=(.+)$/m.exec(entry)?.[1]?.trim();
      if (name) items.push({ name, kind: 'app', id: path.join(dir, f) });
    }
  }
  return items;
}

function steamGames(root) {
  if (!root) return [];
  const libraries = new Set([root]);
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
  } catch {
    // one library, the main one
  }
  const games = [];
  for (const library of libraries) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(library, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const acf = fs.readFileSync(path.join(library, 'steamapps', file), 'utf8');
        const id = /"appid"\s+"(\d+)"/.exec(acf)?.[1];
        const name = /"name"\s+"([^"]+)"/.exec(acf)?.[1];
        if (id && name && !STEAM_SKIP.test(name)) games.push({ name, kind: 'steam', id });
      } catch {
        // a manifest being written: skip it
      }
    }
  }
  return games;
}

// Epic's games, from its launcher's manifests (not the Unreal Engine plugins it also keeps there)
function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'));
  } catch {
    return [];
  }
  const games = [];
  for (const file of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (m.bIsIncompleteInstall || m.CatalogNamespace === 'ue' || !m.DisplayName || !m.AppName) continue;
      games.push({ name: m.DisplayName, kind: 'epic', id: `${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}` });
    } catch {
      // not one of its manifests
    }
  }
  return games;
}

// The one of `items` named in `text` (your message, or the name in her tag): all the words of its
// name in it, else at least half of them; the closest wins. null if nothing fits well enough.
function match(items, text) {
  const said = new Set(words(text));
  const joined = words(text).join('');
  let best = null;
  for (const item of items) {
    const key = words(item.name).filter((w) => !FILLER.has(w));
    if (!key.length) continue;
    const hits = key.filter((w) => said.has(w) || (w.length >= 5 && joined.includes(w)));
    if (!hits.some((w) => w.length >= 3) || hits.length / key.length < 0.5) continue;
    const rank = (hits.length / key.length) * 10 + hits.join('').length / 10;
    if (!best || rank > best.rank) best = { item, rank };
  }
  return best?.item || null;
}

async function find(text) {
  return match(await launchables(), text);
}

// Opens one of them (only something she listed herself): a Start menu app through its AppsFolder
// entry (desktop and Store apps alike), a game through its launcher's link.
async function launch({ kind, id } = {}) {
  const item = (await launchables()).find((i) => i.kind === kind && i.id === id);
  if (!item) throw new Error('not found');
  if (kind === 'custom') {
    // %LOCALAPPDATA% and friends in the path; a link or a Steam id works too
    const app = config.load().customApps?.[id];
    const target = String(app.path).replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);
    if (/^\d+$/.test(target)) return shell.openExternal(`steam://rungameid/${target}`);
    if (/^[a-z][\w+.-]*:/i.test(target) && !/^[a-z]:\\/i.test(target)) return shell.openExternal(target);
    const args = String(app.args || '').match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];
    spawn(target, args, { detached: true, stdio: 'ignore', cwd: path.dirname(target) }).on('error', () => {}).unref();
    return undefined;
  }
  if (kind === 'steam') return shell.openExternal(`steam://rungameid/${id}`);
  if (kind === 'epic') return shell.openExternal(`com.epicgames.launcher://apps/${encodeURIComponent(id)}?action=launch&silent=true`);
  if (process.platform === 'darwin') {
    spawn('open', ['-a', id], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return undefined;
  }
  if (!WIN) {
    // gtk-launch takes the entry's name; without it (no GTK), gio opens the .desktop file itself
    spawn('gtk-launch', [path.basename(id, '.desktop')], { detached: true, stdio: 'ignore' })
      .on('error', () => spawn('gio', ['launch', id], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref())
      .unref();
    return undefined;
  }
  spawn('explorer.exe', [`shell:AppsFolder\\${id}`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return undefined;
}

// The media keys, as if pressed on the keyboard: whatever plays music (Spotify, a browser…) reacts.
// Play and pause are the same key; the volume moves a few steps at a time. Sent as keys (their virtual
// key codes), not typed: typed, they come out as "³" or "°" on a German keyboard.
const MEDIA = { pause: [0xb3, 1], play: [0xb3, 1], next: [0xb0, 1], previous: [0xb1, 1], volup: [0xaf, 5], voldown: [0xae, 5], mute: [0xad, 1] };
const KEY_DOWN = 1; // KEYEVENTF_EXTENDEDKEY
const KEY_UP = 3;   // ...and KEYEVENTF_KEYUP

// Mac: Spotify (else Apple Music) through AppleScript, the volume through the system's own
const MAC_MEDIA = {
  pause: 'pause', play: 'play', next: 'next track', previous: 'previous track',
};
const MAC_VOLUME = { volup: '+ 10', voldown: '- 10' };
// Linux: playerctl (any MPRIS player: Spotify, browsers, VLC…) and PulseAudio / PipeWire's pactl
const LINUX_MEDIA = {
  pause: ['playerctl', ['pause']], play: ['playerctl', ['play']], next: ['playerctl', ['next']], previous: ['playerctl', ['previous']],
  volup: ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', '+10%']], voldown: ['pactl', ['set-sink-volume', '@DEFAULT_SINK@', '-10%']],
  mute: ['pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']],
};
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000 }, (err) => resolve(!err)));

async function media(action) {
  if (process.platform === 'darwin') {
    if (MAC_MEDIA[action]) {
      const verb = MAC_MEDIA[action];
      return run('osascript', ['-e', `if application "Spotify" is running then tell application "Spotify" to ${verb} else tell application "Music" to ${verb}`]);
    }
    if (MAC_VOLUME[action]) return run('osascript', ['-e', `set volume output volume ((output volume of (get volume settings)) ${MAC_VOLUME[action]})`]);
    if (action === 'mute') return run('osascript', ['-e', 'set volume output muted (not (output muted of (get volume settings)))']);
    return false;
  }
  if (!WIN) return LINUX_MEDIA[action] ? run(...LINUX_MEDIA[action]) : false;
  if (!MEDIA[action]) return false;
  const [key, times] = MEDIA[action];
  return powershell(
    'Add-Type -Namespace Capri -Name Keys -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);\'; '
    + `1..${times} | ForEach-Object { [Capri.Keys]::keybd_event(${key}, 0, ${KEY_DOWN}, [UIntPtr]::Zero); [Capri.Keys]::keybd_event(${key}, 0, ${KEY_UP}, [UIntPtr]::Zero) }`,
  ).then(() => true, () => false);
}

// A Spotify search for it: in the app if it's installed, else on the web.
async function music(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return false;
  try {
    await shell.openExternal(`spotify:search:${encodeURIComponent(q)}`);
  } catch {
    await shell.openExternal(`https://open.spotify.com/search/${encodeURIComponent(q)}`);
  }
  return true;
}

// A website: http or https, with a real host name.
function siteUrl(address) {
  try {
    const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

async function site(address) {
  const url = siteUrl(String(address || '').trim());
  if (!url) return false;
  await shell.openExternal(url.toString());
  return true;
}

// a fresh look at what's installed ("Rescan" in his Deck)
function rescan() {
  cache = null;
  return launchables();
}

module.exports = { launchables, match, find, launch, media, music, site, siteUrl, rescan };
