'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, Notification,
  clipboard, ClipboardItem, dialog, powerMonitor, desktopCapturer,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const llm = require('./llm');
const ollama = require('./ollama');
const setup = require('./setup');
const apps = require('./apps');
const launch = require('./launch');
const files = require('./files');
const discord = require('./discord');
const control = require('./control');
const pc = require('./pc');
const { ASSISTANTS, assistant } = require('./assistants');
const activeAssistant = () => assistant(config.load().assistant); // Claude Code or Codex
const activeHooks = () => activeAssistant().hooks;
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');

// Ty-Portable (tools/make-portable.ps1): her folder has a "portable" file next to Ty.exe, and beside it
// ..\ollama (Ollama itself), ..\models (her models) and ..\TyData (her settings and memory). Nothing goes
// on the PC she runs on, no install, no admin.
const PORTABLE = app.isPackaged && fs.existsSync(path.join(path.dirname(process.execPath), 'portable'))
  ? path.resolve(path.dirname(process.execPath), '..') : null;
if (PORTABLE) app.setPath('userData', path.join(PORTABLE, 'TyData'));
let portableOllama = null;

// Her own Ollama, from the stick, when none is running on this PC already
async function startPortableOllama() {
  const exe = PORTABLE && path.join(PORTABLE, 'ollama', 'ollama.exe');
  if (!exe || !fs.existsSync(exe) || (await ollama.models().catch(() => null))) return;
  portableOllama = require('node:child_process').spawn(exe, ['serve'], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, OLLAMA_MODELS: path.join(PORTABLE, 'models'), OLLAMA_HOST: '127.0.0.1:11434' },
  }).on('error', (err) => console.error('[ty] portable ollama:', err.message));
  for (let i = 0; i < 40 && !(await ollama.models().catch(() => null)); i++) await new Promise((r) => setTimeout(r, 750));
  refreshModels();
}
const PORT = Number(process.env.TY_PORT) || 47824;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;

const OLLAMA_SITE = 'https://ollama.com';

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let chatModels = null; // the provider's models, as last seen (null: not reached)
let chatError = null;  // why not, when the provider said
let chatErrorCode = null; // 'nokey' or 'nourl': what her setup should ask for
const chats = new Map(); // id -> AbortController of an answer being streamed

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// Her memory of your chats, across restarts: { history: [{ role, content }], claude: Claude Code's session }
const memoryFile = () => path.join(app.getPath('userData'), 'memory.json');
function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(patch) {
  try {
    fs.writeFileSync(memoryFile(), JSON.stringify({ ...readMemory(), ...patch }));
  } catch (err) {
    console.error('[capri] could not save her memory:', err.message);
  }
}
function forgetChats() {
  llm.resetClaude();
  saveMemory({ history: [], claude: null });
  sendCommand('forget');
}

// His looks (skins): %APPDATA%\ty-desktop\skins\<name>\, each picture in it standing in for Capri's of
// the same name in assets/capri (capri-full.png his body, face-*.png, cutin-*.png, intro-*.webp),
// the ones it doesn't have staying Capri's. skin.json: { "recolor": false } shows its own colors as
// drawn (else the red/black grade goes over the body, as on Capri's).
const skinsDir = () => path.join(app.getPath('userData'), 'skins');
const SKIN_NAME = /^[\w ()'-]{1,40}$/;
const SKINS_README = `TY SKINS
========
One folder per skin. Pick it in Ty's Deck > Character > Skin. Any picture you put in a skin
replaces Capri's picture of the same name; anything missing stays Capri's, so you can start
with just the body and add faces later.

  capri-full.png     240 x 420   her body: the one picture all her moves are made from.
                                 Keep the same pose and where things are (head, arms, hips,
                                 feet): the animation bends those spots of the picture.
                                 capri-cutout.png is the same body for reference.
  face-*.png         256 x 256   her face in the message panel: aside, calm, laugh, look,
                                 many, smug, wide
  capri-face.png     256 x 256   her face on the chip / icon
  cutin-*.png        360 x 240   the comic-style cut-ins: eyes, grin, laugh, look, many
  intro-*.webp                   the big intro where she grabs the screen (optional)

  skin.json          { "name": "Ty masc", "recolor": false }
                     recolor true:  the red / gunmetal grade goes over the body (like now)
                     recolor false: your colors exactly as you drew them

Transparent PNGs, same sizes. "New skin from Capri" in the Deck starts you with copies of
every picture to draw over. Changes show when you pick the skin again (or restart Ty).
`;

function skinList() {
  try {
    return fs.readdirSync(skinsDir(), { withFileTypes: true }).filter((d) => d.isDirectory() && SKIN_NAME.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
}

// A new skin to draw over: every picture of Capri's copied in, and the folder opened.
function newSkin(name) {
  const clean = String(name || '').trim();
  if (!SKIN_NAME.test(clean)) return { ok: false, error: 'letters, numbers, spaces and - only' };
  const dir = path.join(skinsDir(), clean);
  if (fs.existsSync(dir)) return { ok: false, error: 'there’s a skin called that already' };
  fs.mkdirSync(dir, { recursive: true });
  const from = path.join(ROOT, 'assets', 'capri');
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify({ name: clean, recolor: true }, null, 2));
  fs.writeFileSync(path.join(skinsDir(), 'README.txt'), SKINS_README);
  shell.openPath(dir);
  return { ok: true, name: clean };
}

// capri://app/assets/capri/<file> from the skin picked, when it has that file
function skinFile(pathname) {
  const skin = config.load().skin;
  if (!skin || !SKIN_NAME.test(skin) || !pathname.startsWith('/assets/capri/')) return null;
  const file = path.join(skinsDir(), skin, path.basename(decodeURIComponent(pathname)));
  return fs.existsSync(file) ? file : null;
}

// capri://app/...        -> files of this repo (his pictures from his skin, if it has them)
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    if (url.host === 'app') {
      const skinned = skinFile(url.pathname);
      if (skinned) return net.fetch(pathToFileURL(skinned).toString());
      if (url.pathname === '/assets/capri/skin.json') return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

// Ty's chat window (src/chatwin): a holocall terminal to type to him. It relays to his overlay, which
// answers as usual (with all he can do), and his answers are mirrored back to it.
let chatWin = null;
function openChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) {
    if (chatWin.isMinimized()) chatWin.restore();
    chatWin.focus();
    return;
  }
  chatWin = new BrowserWindow({
    width: 480, height: 680, minWidth: 360, minHeight: 420,
    title: 'Ty - Chat', backgroundColor: '#0a0709', autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icons', 'ty.ico'),
    webPreferences: { preload: path.join(ROOT, 'src', 'chat-preload.js'), contextIsolation: true, sandbox: true },
  });
  chatWin.loadURL('capri://app/src/chatwin/chat.html');
  chatWin.on('closed', () => { chatWin = null; });
}

// Ty // Deck (src/deck): his settings window.
let deckWin = null;
function openDeck() {
  if (deckWin && !deckWin.isDestroyed()) {
    if (deckWin.isMinimized()) deckWin.restore();
    deckWin.focus();
    return;
  }
  deckWin = new BrowserWindow({
    width: 1100, height: 780, minWidth: 760, minHeight: 520,
    title: 'Ty - Deck', backgroundColor: '#0a0709', autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icons', 'ty.ico'),
    webPreferences: { preload: path.join(ROOT, 'src', 'deck-preload.js'), contextIsolation: true, sandbox: true },
  });
  deckWin.loadURL('capri://app/src/deck/deck.html');
  deckWin.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.error(`[deck:${e.level}] ${e.message}`);
  });
  deckWin.on('closed', () => { deckWin = null; });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// Her window: the work area, or the whole screen while she rests on the taskbar (her legs hang
// over it), less its top row of pixels: a window on top covering the whole screen is a fullscreen
// app to Windows (animated wallpapers pause, notifications wait). `gap`: how much of her window is
// below the top of the taskbar (0, or its height).
function overlayArea() {
  const { workArea, bounds } = targetDisplay();
  const area = ['taskbar', 'perch'].includes(config.load().rest) ? { ...bounds, y: bounds.y + 1, height: bounds.height - 1 } : workArea;
  return { area, gap: area.y + area.height - (workArea.y + workArea.height) };
}

function fitOverlay() {
  if (!overlay) return;
  const { area, gap } = overlayArea();
  overlay.setBounds(area);
  overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
}

// The pointer reaches her click-through window through a mouse hook, and Windows drops a hook that
// doesn't answer in time without a word (waking from sleep, a locked screen, a stall): she can't be
// clicked anymore. Off then on puts in a new one; her place on top and her size are set again too.
function rearmOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(false);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

// Back on top of everything, the taskbar included (it comes up over her when it's clicked). Twice:
// the taskbar can come up again a moment later, as its menus and previews open.
function raiseOverlay() {
  for (const wait of [0, 400]) {
    setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
    }, wait);
  }
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...overlayArea().area,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner. Sized again first:
  // Windows keeps a new window inside the work area, and resting on the taskbar it covers it too.
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

// Reminders and timers ("remind me in 20 min to…"): kept in his config so a restart doesn't lose them,
// each one a Windows notification and him popping up with it. Missed by under an hour (the PC was off
// or asleep): they go off as soon as he's back. Older ones are dropped.
let reminderTimers = [];
function armReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  const now = Date.now();
  const list = config.load().reminders.filter((r) => r.at > now - 3600e3);
  if (list.length !== config.load().reminders.length) updateConfig({ reminders: list });
  for (const r of list) {
    reminderTimers.push(setTimeout(() => fireReminder(r), Math.min(Math.max(0, r.at - now) + 500, 2 ** 31 - 1)));
  }
}
function fireReminder(r) {
  if (r.at > Date.now() + 1000) return armReminders(); // over the timer's 24-day limit: armed again
  updateConfig({ reminders: config.load().reminders.filter((x) => !(x.at === r.at && x.text === r.text)) });
  if (Notification.isSupported()) new Notification({ title: 'Ty', body: r.text || 'timer’s up' }).show();
  sendCommand('remind', { text: r.text });
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function playDemo() {
  clearTimeout(demoTimer);
  const steps = demoSteps(resolveLang(config.load().lang)); // in her language
  let i = 0;
  const next = () => {
    if (i >= steps.length) return;
    const [delay, evt] = steps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('claude:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Ty speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const { apiKeys, ...cfg } = config.load(); // the keys stay here: the overlay only learns which ones are set
  return { ...cfg, keys: Object.keys(apiKeys || {}), assistant: activeAssistant().id, lang: resolveLang(cfg.lang), langSetting: cfg.lang, floorGap: overlayArea().gap };
}

function updateConfig(patch) {
  config.save(patch);
  if ('rest' in patch) fitOverlay(); // the taskbar in her window or not
  if ('skin' in patch) {
    // his new look: the overlay and his chat window load their pictures again
    overlay?.webContents.reloadIgnoringCache();
    if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.reloadIgnoringCache();
  }
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

function rebuildTray() {
  if (!tray) return;
  const cfg = config.load();
  const hookState = activeHooks().status();
  const watched = activeAssistant();
  const t = Object.fromEntries(Object.entries(TRAY[resolveLang(cfg.lang)]).map(([key, value]) =>
    [key, typeof value === 'string' && watched.id !== 'claude' ? value.replaceAll('Claude Code', watched.name) : value]));

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const menu = Menu.buildFromTemplate([
    { label: t.online(PORT), enabled: false },
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.demo, click: playDemo },
    { label: t.help, click: () => sendCommand('welcome') },
    ...(cfg.claude ? [{ label: t.report, click: () => sendCommand('report') }] : []),
    { label: 'Chat window…', click: openChatWindow },
    { label: 'Deck (settings)…', click: openDeck },
    { label: t.talk, click: () => sendCommand('chat') },
    {
      label: 'Do something',
      submenu: [['Spin', 'spin'], ['Hop', 'hop'], ['Victory pose', 'victory'], ['Lightning', 'zap'], ['Split into copies', 'split'], ['Look around', 'look']]
        .map(([label, act]) => ({ label, click: () => sendCommand('act', { act }) }))
        .concat([{ label: 'Teleport', click: () => sendCommand('teleport') }, { label: 'Look at the satellite', click: () => sendCommand('satellite') }]),
    },
    { label: 'What’s new', click: () => sendCommand('whatsnew') },
    { label: t.custom, click: () => sendCommand('customize') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: t.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
    },
    {
      label: t.chatModel,
      submenu: [
        { label: t.aiSetup, click: () => sendCommand('setupChat') },
        { type: 'separator' },
        ...Object.entries(llm.PROVIDERS).map(([provider, p]) => ({
          label: p.label, type: 'radio', checked: cfg.provider === provider, click: () => pickProvider(provider),
        })),
        { type: 'separator' },
        ...(chatModels?.length
          ? [
            { label: 'Auto (picks one per message)', type: 'radio', checked: cfg.chatModel === AUTO, click: () => updateConfig({ chatModel: AUTO }) },
            ...chatModels.map((name) => ({
              label: name, type: 'radio', checked: cfg.chatModel !== AUTO && name === pickModel(cfg), click: () => updateConfig({ chatModel: name }),
            })),
          ]
          : [{ label: (chatError || t.noOllama).slice(0, 80), enabled: false }]),
        { type: 'separator' },
        ...(cfg.provider === 'claude' ? [
          { label: `Claude Code: ${cfg.claudeCwd || app.getPath('home')}`, click: pickClaudeFolder },
          {
            label: 'Claude Code permissions',
            submenu: llm.CLAUDE_MODES.map((mode) => ({
              label: mode, type: 'radio', checked: cfg.claudeMode === mode, click: () => updateConfig({ claudeMode: mode }),
            })),
          },
        ] : []),
        { label: t.forget, click: forgetChats },
        // the key (or the address) of the one picked, pasted in her panel
        { label: t.apiKey, click: () => sendCommand('setupKey') },
      ],
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    { label: gaming ? 'Game mode (on now: GPU freed)' : 'Game mode in games', type: 'checkbox', checked: cfg.gameMode !== false, click: (item) => updateConfig({ gameMode: item.checked }) },
    {
      label: t.rest,
      submenu: [['perch', 'On your windows'], ['corner', t.restCorner], ['taskbar', t.restTaskbar]].map(([rest, label]) => ({
        label, type: 'radio', checked: cfg.rest === rest, click: () => updateConfig({ rest }),
      })),
    },
    // the coding assistant she watches (a new one: she says hello and offers to plug herself in), or none
    {
      label: t.watch,
      submenu: [
        ...Object.entries(ASSISTANTS).map(([id, { name }]) => ({
          label: name,
          type: 'radio',
          checked: cfg.claude && watched.id === id,
          click: () => {
            const other = watched.id !== id;
            updateConfig({ claude: true, assistant: id, ...(other && { linked: false, welcomed: false }) });
            if (other) sendCommand('assistantChanged');
          },
        })),
        { label: t.watchNone, type: 'radio', checked: !cfg.claude, click: () => updateConfig({ claude: false }) },
      ],
    },
    {
      label: t.motion,
      submenu: [['auto', t.motionAuto], ['full', t.motionFull], ['reduced', t.motionReduced]].map(([motion, label]) => ({
        label, type: 'radio', checked: cfg.motion === motion, click: () => updateConfig({ motion, motionAsked: true }),
      })),
    },
    {
      label: t.display,
      // only read when she starts: she restarts in the mode picked
      submenu: [['auto', t.displayAuto], ['gl', t.displayGl], ['software', t.displaySoftware]].map(([render, label]) => ({
        label, type: 'radio', checked: cfg.render === render,
        click: () => {
          if (cfg.render === render) return;
          config.save({ render });
          app.relaunch();
          app.exit(0);
        },
      })),
    },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: cfg.lang === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    // her hooks, while she watches Claude Code
    ...(cfg.claude ? [
      { type: 'separator' },
      hookState.installed
        ? { label: t.hooksOn, enabled: false }
        : { label: t.hooksOff, click: () => runHooks('install') },
      ...(hookState.installed ? [{ label: t.hooksRemove, click: () => runHooks('uninstall') }] : []),
    ] : []),
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? activeHooks().install() : activeHooks().uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  rebuildTray();
  return outcome;
}

// models that can look at a picture (your screen)
const SEES = /gemma-?3|llava|vision|[-_.]vl\b|qwen\d?(\.\d)?-?vl|minicpm-v|moondream/i;
// "Auto" in his menu: a model for each message, by what it is (chat.js tells which kind). He talks,
// thinks and does things with Qwen3 (it writes its tags right, and it's light); your screen goes to a
// small vision model first (his eyes, see eyes()), and Qwen3 answers about what it saw.
const AUTO = 'auto';
const TALKER = [/qwen3.*abliterated/i, /qwen3(?!-?vl)/i];
const ROUTES = { act: TALKER, talk: TALKER, think: TALKER, see: TALKER };
// his eyes: the smallest vision model installed
function eyes() {
  const size = (m) => Number((m.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 99);
  return (chatModels || []).filter((m) => SEES.test(m)).sort((x, y) => size(x) - size(y))[0] || null;
}
function routed(route) {
  for (const re of ROUTES[route] || []) {
    const model = chatModels?.find((m) => re.test(m) && !SEES.test(m));
    if (model) return model;
  }
  return null;
}

// The model she talks with: the one picked in her menu if it's still installed, else the first.
// Game mode: a game in front for a few seconds (windows.ps1 tells), and "Auto" picked: his big model
// leaves the GPU and a tiny one answers from the CPU, so he costs your game no VRAM at all.
const TINY = /[:-](0\.6b|1\.7b|1b|1\.2b|2b|3b|4b)\b/i;
let gaming = false;
let gameSeen = 0;   // when the game in front was first seen (0: none in front)
let gameLeft = 0;   // when it stopped being in front
function gameModel() {
  return (chatModels || []).find((m) => TINY.test(m) && !SEES.test(m) && /qwen3/i.test(m)) || null;
}
function checkGame(now = Date.now()) {
  // on after 6 s of a game in front; off 40 s after it left (alt-tabbing to Discord and back changes nothing)
  const on = config.load().gameMode !== false && (gameSeen ? gaming || now - gameSeen > 6000 : gaming && now - gameLeft < 40000);
  if (on === gaming) return;
  gaming = on;
  if (on) ollama.unloadAll().catch(() => {});
  sendCommand('gaming', { on, model: gameModel() });
  rebuildTray();
}

function pickModel(cfg = config.load(), route = 'talk') {
  if (!chatModels?.length) return null;
  if (gaming && cfg.chatModel === AUTO && gameModel()) return gameModel();
  if (cfg.chatModel === AUTO) return routed(route) || routed('think') || chatModels[0];
  return chatModels.includes(cfg.chatModel) ? cfg.chatModel : chatModels[0];
}

async function refreshModels() {
  const cfg = config.load();
  chatError = null;
  chatErrorCode = null;
  chatModels = await llm.models(cfg.provider, llmConfig(cfg)).catch((err) => {
    chatError = err.message;
    chatErrorCode = err.code || null;
    return null;
  });
  rebuildTray();
  return chatModels;
}

// Her answer from the model picked, or from the next one when that one can't: too busy twice in a row
// (Gemini's "high demand"), or not served anymore (an older model closed to new keys). The model
// that answered is kept for next time.
async function chatWithFallback(cfg, messages, send, signal, streamed) {
  let model = pickModel(cfg);
  const tried = new Set();
  let busy = 0;
  for (;;) {
    try {
      const text = await llm.chat(cfg.provider, llmConfig(cfg), { model, messages, cpu: (gaming || cfg.cpuOnly) && model === gameModel() }, send, signal);
      if (model !== pickModel(cfg)) updateConfig({ chatModel: model });
      return text;
    } catch (err) {
      if (signal.aborted || streamed() || !['busy', 'gone'].includes(err.code)) throw err;
      if (err.code === 'busy' && busy++ === 0) {
        await new Promise((r) => setTimeout(r, 1500)); // usually gone a moment later
        continue;
      }
      tried.add(model);
      const next = chatModels?.find((m) => !tried.has(m));
      if (!next || tried.size >= 3) throw err;
      model = next;
      busy = 0;
    }
  }
}

async function pickProvider(provider) {
  updateConfig({ provider });
  await refreshModels();
  if (chatErrorCode) sendCommand('setupKey'); // it needs a key or an address: she asks for it
}

// What llm.js gets: the config with its keys opened (they're kept encrypted, setup.js)
function llmConfig(cfg = config.load()) {
  return { ...cfg, apiKeys: setup.openKeys(cfg.apiKeys) };
}

async function pickClaudeFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: config.load().claudeCwd || app.getPath('home') });
  if (canceled || !filePaths[0]) return;
  llm.resetClaude(); // a new folder, a new Claude Code conversation (hers goes on)
  saveMemory({ claude: null });
  updateConfig({ claudeCwd: filePaths[0] });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Ty');
  tray.on('click', () => sendCommand('status'));
  rebuildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => activeHooks().status());
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(activeHooks().status().file))); // Claude Code keeps its settings there
  ipcMain.on('claude:help', () => shell.openExternal(activeAssistant().help));
  ipcMain.handle('windows:get', () => lastWindows);
  // talking to her (chat.js): is Ollama there, with a model to talk with
  ipcMain.handle('chat:status', async () => {
    const cfg = config.load(true); // keys may have been edited by hand
    const { provider } = cfg;
    const models = await refreshModels();
    if (!models) return { ok: false, error: chatError || 'offline', code: chatErrorCode, provider };
    if (!models.length) return { ok: false, error: 'nomodel', provider };
    if (!gaming) llm.warm(provider, pickModel()); // loading while you type your first message (not mid-game: the GPU is yours)
    return { ok: true, provider, model: config.load().chatModel === AUTO ? 'auto' : pickModel(), agent: provider === 'claude', local: llm.isLocal(provider, cfg), warmup: provider === 'ollama' };
  });
  // her answer, streamed to the overlay piece by piece as `chat:delta`
  ipcMain.handle('chat:send', async (_e, { id, messages, route }) => {
    const abort = new AbortController();
    chats.set(id, abort);
    try {
      let streamed = false;
      const send = (text) => {
        streamed = true;
        overlay?.webContents.send('chat:delta', { id, text });
      };
      let cfg = config.load();
      const looking = messages.some((m) => m.images?.length);
      if (cfg.chatModel === AUTO) cfg = { ...cfg, chatModel: pickModel(cfg, route) };
      // a look of his own at your screen (watch mode): his eyes and the tiny model, both on the CPU, so
      // it costs your GPU nothing and leaves no big model loaded
      const light = route === 'glance' && cfg.provider === 'ollama' && gameModel();
      if (light) cfg = { ...cfg, chatModel: gameModel(), cpuOnly: true };
      // a look at your screen and his model can't see: his eyes describe it, he answers about it
      if (looking && !SEES.test(pickModel(cfg) || '')) {
        let seer = cfg.provider === 'ollama' && eyes();
        if (cfg.provider === 'ollama' && !seer) seer = (await refreshModels(), eyes()); // pulled since he started
        if (!seer) throw new Error('no vision model installed (ollama pull qwen3-vl:2b-instruct)');
        const last = messages.findLast((m) => m.images?.length);
        const seen = await ollama.look(seer, last.images, light ? '' : String(last.content || ''), abort.signal, Boolean(light));
        messages = messages.map((m) => (m === last
          ? { role: m.role, content: `${m.content || ''}

[what's on my screen right now, as your eyes saw it: ${seen || 'nothing readable'}]` }
          : (m.images ? { role: m.role, content: m.content } : m)));
      }
      const text = await chatWithFallback(cfg, messages, send, abort.signal, () => streamed);
      if (cfg.provider === 'claude') saveMemory({ claude: llm.claudeMemory() });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message, code: err.code || null };
    } finally {
      chats.delete(id);
    }
  });
  ipcMain.on('chat:stop', (_e, id) => chats.get(id)?.abort());
  ipcMain.handle('chat:memory', () => readMemory().history || []);
  ipcMain.on('chat:remember', (_e, history) => Array.isArray(history) && saveMemory({ history }));
  ipcMain.on('chat:ollama', () => shell.openExternal(OLLAMA_SITE));
  // setting her up with buttons (setup.js): Ollama and a model, or a key, or an address
  const progress = (payload) => overlay?.webContents.send('setup:progress', payload);
  let pulling = null; // AbortController of the model being fetched
  ipcMain.handle('setup:info', () => ({ models: setup.MODELS, ram: os.totalmem(), keyed: Object.keys(setup.KEY_PAGES) }));
  ipcMain.handle('setup:ollama', () => setup.ollamaState());
  ipcMain.handle('setup:install', () => setup.installOllama((line) => progress({ kind: 'install', line })));
  ipcMain.handle('setup:start', async () => {
    const res = await setup.startOllama();
    await refreshModels();
    return res;
  });
  ipcMain.handle('setup:pull', async (_e, name) => {
    if (!setup.MODELS.some((m) => m.name === name)) return { ok: false, error: 'unknown model' };
    pulling?.abort();
    const abort = new AbortController();
    pulling = abort;
    try {
      await setup.pullModel(name, (p) => progress({ kind: 'pull', ...p }), abort.signal);
      updateConfig({ provider: 'ollama' });
      await refreshModels();
      const model = chatModels?.find((m) => m === name || m.startsWith(`${name}:`));
      if (model) updateConfig({ chatModel: model });
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message };
    } finally {
      if (pulling === abort) pulling = null;
    }
  });
  ipcMain.on('setup:cancel', () => pulling?.abort());
  // who answers her chat, with its key or address if it needs one: saved, tried, and undone if it fails
  ipcMain.handle('setup:use', async (_e, { provider, key, url }) => {
    if (!llm.PROVIDERS[provider]) return { ok: false, error: 'unknown provider' };
    const before = config.load();
    const patch = { provider };
    if (key) patch.apiKeys = { ...before.apiKeys, [provider]: setup.sealKey(String(key).trim()) };
    if (url) patch.customUrl = String(url).trim();
    updateConfig(patch);
    const models = await refreshModels();
    if (models?.length) return { ok: true, model: pickModel() };
    const error = models ? 'no model' : chatError || 'offline';
    updateConfig({ provider: before.provider, apiKeys: before.apiKeys, customUrl: before.customUrl });
    await refreshModels();
    return { ok: false, error };
  });
  ipcMain.on('setup:keyPage', (_e, provider) => setup.KEY_PAGES[provider] && shell.openExternal(setup.KEY_PAGES[provider]));
  ipcMain.handle('setup:launch', (_e, integration) => setup.launchThroughOllama(integration));
  // closing an app you asked her to close, once you've clicked to confirm (apps.js)
  const appInfo = (app) => app && { name: app.process, label: app.label };
  ipcMain.handle('apps:list', async () => (await apps.list().catch(() => [])).map(appInfo));
  ipcMain.handle('apps:find', async (_e, wanted) => appInfo(await apps.find(wanted).catch(() => null)));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }).catch((err) => ({ error: err.message })));
  // opening things you ask her to (launch.js): an app or a game, your music, a website
  ipcMain.handle('apps:findLaunch', (_e, text) => launch.find(String(text || '')).catch(() => null));
  ipcMain.handle('apps:launch', (_e, item) => launch.launch(item).then(() => ({ ok: true }), (err) => ({ ok: false, error: err.message })));
  ipcMain.handle('apps:media', (_e, action) => launch.media(action));
  ipcMain.handle('apps:music', (_e, query) => launch.music(query).catch(() => false));
  ipcMain.handle('apps:site', (_e, address) => launch.site(address).catch(() => false));
  ipcMain.handle('files:run', (_e, { op, arg }) => files.run(op, arg)); // read-only, never system or private folders (files.js)
  ipcMain.handle('discord:send', (_e, { to, text }) => discord.send({ to, text })); // only after the Send button's click (chat.js)
  ipcMain.handle('files:save', (_e, { file, content, overwrite }) => files.save(file, content, { overwrite: Boolean(overwrite) }));
  ipcMain.handle('control:act', (_e, { app, text, keys }) => control.act({ app, text, keys })); // only after his button's click (chat.js)
  ipcMain.handle('web:search', (_e, query) => control.search(query)); // only when you asked him to search (chat.js)
  // his chat window: typing to him there, his answers mirrored back from the overlay
  ipcMain.handle('chatwin:init', () => ({ history: readMemory().history || [], skin: config.load().chatSkin || 'holocall' }));
  ipcMain.on('chatwin:send', (_e, text) => sendCommand('chatText', { text: String(text).slice(0, 2000) }));
  ipcMain.on('chatwin:answer', (_e, id) => sendCommand('answer', { id: String(id) }));
  ipcMain.on('chatwin:skin', (_e, skin) => updateConfig({ chatSkin: String(skin) }));
  ipcMain.on('chatwin:open', () => openChatWindow());
  ipcMain.on('deck:open', () => openDeck());
  // PC things he does when you ask (pc.js): weather, Discord mute/deafen, lock, windows, power (power: his button only)
  ipcMain.handle('pc:weather', (_e, city) => { const c = config.load(); return pc.weather(city || c.weatherCity, c.weatherUnits); });
  ipcMain.handle('pc:discord', (_e, what) => { const c = config.load(); return pc.discordToggle(what, what === 'deafen' ? c.discordDeafenKey : c.discordMuteKey); });
  // his Deck (src/deck)
  ipcMain.handle('deck:init', async () => ({
    cfg: config.load(), version: app.getVersion(), models: (await refreshModels().catch(() => null)) || chatModels || [],
    startup: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
  }));
  ipcMain.handle('deck:set', (_e, patch) => {
    // only settings he knows, never anything else in the file
    const known = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => k in config.DEFAULTS && k !== 'customApps'));
    updateConfig(known);
    return true;
  });
  ipcMain.handle('deck:saveApps', (_e, list) => {
    const customApps = (Array.isArray(list) ? list : []).slice(0, 100).map((a) => ({
      name: String(a?.name || '').slice(0, 80), aliases: String(a?.aliases || '').slice(0, 200),
      path: String(a?.path || '').slice(0, 500), args: String(a?.args || '').slice(0, 300),
    }));
    updateConfig({ customApps });
    return true;
  });
  ipcMain.handle('deck:testLaunch', (_e, index) => launch.launch({ kind: 'custom', id: Number(index) })
    .then(() => ({ ok: true }), (err) => ({ ok: false, error: err.message })));
  ipcMain.handle('deck:browse', async () => {
    const res = await dialog.showOpenDialog(deckWin, { title: 'Pick a program for Ty', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'url'] }] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('deck:try', (_e, text) => launch.find(String(text || '')).then((hit) => (hit ? { name: hit.name, kind: hit.kind } : null), () => null));
  ipcMain.handle('deck:installed', () => launch.launchables().then((l) => l.map(({ name, kind }) => ({ name, kind })), () => []));
  ipcMain.handle('deck:rescan', () => launch.rescan().then((l) => l.map(({ name, kind }) => ({ name, kind })), () => []));
  ipcMain.handle('deck:weather', (_e, city, units) => pc.weather(city, units));
  ipcMain.handle('deck:skins', () => skinList());
  ipcMain.handle('deck:newSkin', (_e, name) => {
    try {
      return newSkin(name);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.on('deck:openSkins', () => {
    fs.mkdirSync(skinsDir(), { recursive: true });
    fs.writeFileSync(path.join(skinsDir(), 'README.txt'), SKINS_README);
    const skin = config.load().skin;
    shell.openPath(skin && skinList().includes(skin) ? path.join(skinsDir(), skin) : skinsDir());
  });
  ipcMain.on('deck:greet', () => sendCommand('greet', { big: config.load().greetBig !== false }));
  ipcMain.on('deck:startup', (_e, on) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(on) }));
  ipcMain.handle('pc:lock', () => pc.lock());
  ipcMain.handle('pc:windows', (_e, how) => pc.windows(how));
  ipcMain.handle('pc:power', (_e, action) => pc.power(action));
  ipcMain.handle('pc:move', (_e, { app: name, where }) => pc.moveWindow(String(name || ''), String(where || '')));
  ipcMain.handle('pc:remind', (_e, { at, text }) => {
    if (!(Number(at) > Date.now())) return { ok: false };
    updateConfig({ reminders: [...config.load().reminders, { at: Number(at), text: String(text || '').slice(0, 200) }] });
    armReminders();
    return { ok: true };
  });
  ipcMain.handle('pc:reminders', () => config.load().reminders);
  ipcMain.handle('pc:clearReminders', () => {
    updateConfig({ reminders: [] });
    armReminders();
    return { ok: true };
  });
  ipcMain.on('chat:mirror', (_e, update) => {
    if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('chatwin:update', update);
  });
  // a look at your screen, only when you ask him in his chat: a JPEG for the local model, never saved
  ipcMain.handle('screen:capture', async () => {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    return source ? source.thumbnail.toJPEG(75).toString('base64') : null;
  });
  // typing to her: the overlay takes the keyboard while the chat is open, and gives it back after
  ipcMain.on('overlay:focus', (_e, on) => {
    if (!overlay) return;
    overlay.setFocusable(Boolean(on));
    if (on) overlay.focus();
    else overlay.blur();
  });
  // her report card's copy button: a picture of that part of the overlay, on the clipboard
  ipcMain.handle('panel:copy', async (_e, rect) => {
    const image = await overlay.webContents.capturePage(rect);
    if (image.isEmpty()) return false;
    const png = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
  ipcMain.handle('guide:claudeFolder', () => {
    const file = activeHooks().status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file), label: fs.existsSync(file) ? path.basename(file) : path.basename(dir) };
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'unhook') {
    // the pointer no longer passed on to her, as when Windows drops the mouse hook
    overlay.setIgnoreMouseEvents(true);
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Ty test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'type') {
    // typing into the overlay (her chat), and Enter if asked
    if (body.text) await overlay.webContents.insertText(body.text);
    if (body.enter) {
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

// How her window is drawn, set before Electron starts (her menu › Display). On some PCs her see-through
// window shows up black (NVIDIA with FXAA, MFAA or HDR on, for one): drawing it through OpenGL, or
// without the graphics card, often fixes it.
function applyRender() {
  const { render } = config.load();
  if (render === 'gl') app.commandLine.appendSwitch('use-angle', 'gl');
  if (render === 'software') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // her drawing still needs WebGL, done on the CPU
  }
  // --dev: what Chromium ended up drawing with
  if (DEV) app.whenReady().then(() => setTimeout(() => console.log('[capri] display:', render, JSON.stringify(app.getGPUFeatureStatus())), 4000));
}

function main() {
  applyRender();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('ty.desktop');

  app.whenReady().then(() => {
    if (!['codex', 'claude'].includes(config.load().assistant)) config.save({ assistant: activeAssistant().id });
    serveProtocol();
    registerIpc();
    createOverlay();
    createTray();
    windowWatch = startWindowWatch({
      overlay,
      onUpdate: (data) => {
        // a click on the taskbar brings it up over her: sitting on it, her legs would vanish behind it
        if (data.taskbar && !lastWindows?.taskbar && ['taskbar', 'perch'].includes(config.load().rest)) raiseOverlay();
        lastWindows = data;
        if (data.game && !gameSeen) gameSeen = Date.now();
        if (!data.game && gameSeen) { gameSeen = 0; gameLeft = Date.now(); }
        overlay?.webContents.send('windows:update', data);
      },
    });
    createBridge({
      port: PORT,
      // her own Claude Code chat's hooks would cover its answer with theirs
      onEvent: (evt) => !llm.isChatSession(evt.session_id) && overlay?.webContents.send('claude:event', evt),
      onDebug: DEV ? debugHandler : null,
    });
    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    globalShortcut.register('Control+Alt+T', () => openChatWindow()); // his chat window, from anywhere
    setTimeout(armReminders, 8000); // once he's up to pop out with them
    // he starts with Windows (you asked): set up once, and the Deck's switch has the last word after
    if (!config.load().startupSet && !PORTABLE) { // (not from a stick: on someone else's PC)
      app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: true });
      updateConfig({ startupSet: true });
    }
    setInterval(checkGame, 3000);
    llm.restoreClaude(readMemory().claude);
    refreshModels(); // for her menu's model list
    startPortableOllama();
    setTimeout(() => launch.launchables().catch(() => {}), 20000); // what she can open, before you ask
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    // after sleep or a locked screen, once Windows has settled
    powerMonitor.on('resume', () => setTimeout(rearmOverlay, 2000));
    // his greeting when you're back: unlocking, or the PC waking up (Deck › PC & Chat)
    const greet = () => config.load().greet !== false && sendCommand('greet', { big: config.load().greetBig !== false });
    powerMonitor.on('resume', () => setTimeout(greet, 3000));
    powerMonitor.on('unlock-screen', () => setTimeout(greet, 1500));
    powerMonitor.on('unlock-screen', () => setTimeout(rearmOverlay, 1000));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    portableOllama?.kill(); // her Ollama from the stick goes with her
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
