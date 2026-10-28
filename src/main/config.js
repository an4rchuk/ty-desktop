'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,        // sprite scale, 0.6 â‰ˆ 250px tall
  muted: false,
  volume: 0.7,
  lang: 'auto',      // 'auto' follows the system language, or 'fr' / 'en'
  displayId: null,   // null = primary display
  wander: true,      // random teleports when idle
  possess: true,     // now and then she dives into the window she sits on and takes it over
  visible: true,
  welcomed: false,   // she has introduced herself (her welcome panel)
  assistant: 'auto', // the coding assistant she watches: 'claude' or 'codex' ('auto': whichever has her hooks)
  linked: false,     // a Claude Code event has reached her at least once
  chatModel: 'auto', // 'auto': a model per message (main.js ROUTES), else a model's name (null: the provider's first one)
  provider: 'ollama', // who answers her chat: a key of llm.js PROVIDERS
  apiKeys: {},       // { openai: 'sk-...' }, else the provider's env variable
  customUrl: '',     // the 'custom' provider: any OpenAI-compatible base URL (http://host:port/v1)
  claudeCwd: null,   // the folder Claude Code works in (null: your home folder)
  userName: '',      // what she calls you ("call me …", or the Deck); '' until she knows
  persona: '',       // how you want her, in your words (her chat)
  myLines: [],       // lines of yours she says now and then, with hers
  memories: [],      // things you asked her to remember (her chat)
  claudeMode: 'default', // Claude Code's permission mode in her chat: 'default' only reads, 'acceptEdits' edits without asking
  greet: true,       // he says hi when you unlock the PC or it wakes up
  greetBig: true,    // ...big, in the middle of the screen, then back to his corner
  weatherCity: '',   // the weather (Open-Meteo): your home city
  weatherUnits: 'metric', // 'metric' (°C, km/h) or 'imperial' (°F, mph)
  discordMuteKey: '',   // your own Discord keybind for mute (works with Discord in the tray), else Ctrl+Shift+M
  discordDeafenKey: '', // same for deafen, else Ctrl+Shift+D
  customApps: [],    // apps you named yourself in the Deck: [{ name, aliases, path, args }]
  chatSkin: 'holocall', // his chat window's look
  skin: '',          // his own look: a folder in %APPDATA%\ty-desktop\skins ('' = Capri's pictures)
  startupSet: false, // starting with Windows turned on once (main.js); after that the Deck's switch decides
  reminders: [],     // "remind me in 20 min to…": [{ at (ms), text }], fired by main.js
  watch: false,      // he glances at your screen now and then and says something about it
  watchEvery: 5,     // minutes between glances
  watchGaming: false, // glance while a fullscreen game is up too
  gameMode: true,    // in a game: his big model off the GPU, a tiny one on the CPU, quick commands instant
  claude: false,     // he watches Claude Code (off: she just keeps you company, no word of it)
  rest: 'perch',    // where she rests when nothing's going on: 'corner', or 'taskbar' (sitting on it)
  motion: 'auto',    // her animations: 'auto' (like Windows' animation effects), 'full' or 'reduced'
  motionAsked: false, // she asked once, Windows' animations being off, whether to move anyway
  render: 'auto',   // how her window is drawn: 'auto', 'gl' (OpenGL) or 'software' (no graphics card), for PCs that show it black
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load(fresh = false) {
  if (cache && !fresh) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

module.exports = { load, save, file, DEFAULTS };
