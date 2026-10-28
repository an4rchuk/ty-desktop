'use strict';

// Ty looking at your files when you ask him in his chat: read-only (list a folder, read a text
// file, find a file by name). He can't change, move, delete or run anything, and he never gets into
// what runs Windows (Windows, System32, Program Files, ProgramData…) or what holds your logins
// (AppData, .ssh, keys, password vaults, .env…). Checked on the real path, after junctions and links.

const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const HOME = os.homedir();
const READ_MAX = 16 * 1024;  // what he reads of a file
const LIST_MAX = 80;         // entries he sees in a folder
const FIND_MAX = 25;         // files a search returns
const FIND_DIRS = 6000;      // folders a search goes through, at most
const FIND_MS = 4000;

// "desktop\notes.txt", "documents", "downloads"… where Windows really keeps them (OneDrive or not)
const ALIASES = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'];
const alias = (name) => {
  try {
    return app.getPath(name);
  } catch {
    return path.join(HOME, name[0].toUpperCase() + name.slice(1));
  }
};

// the other drives (D:, E:…): anything on them but their system folders. On C:, only your user folder.
const DRIVES = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => {
  try {
    return fss.existsSync(d);
  } catch {
    return false;
  }
});

// what runs Windows and its programs, at the top of any drive
const SYSTEM = /^[a-z]:\\(windows|windows\.old|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information|recovery|boot|efi|config\.msi|msocache|perflogs|drivers|intel|amd|nvidia|\$windows\.~bt|\$windows\.~ws|\$winreagent|\$sysreset|onedrivetemp)(\\|$)/i;
const SYSTEM_FILES = /^[a-z]:\\(pagefile|hiberfil|swapfile)\.sys$|^[a-z]:\\(bootmgr|dumpstack\.log.*)$/i;
// in your user folder: app data and the places that hold logins and keys
const PRIVATE_DIRS = new Set([
  'appdata', 'application data', 'local settings', 'cookies', 'nethood', 'printhood', 'recent', 'sendto', 'templates', 'start menu',
  '.ssh', '.aws', '.azure', '.gnupg', '.docker', '.kube', '.config', '.claude', '.codex', '.gemini', '.ollama', '.vscode', '.cache', '.local',
]);
// any file that looks like a secret, wherever it is
const SECRET = /^\.env(\..*)?$|\.(pem|key|pfx|p12|kdbx|kdb|ppk|ovpn|rdp|wallet|keystore|jks|asc|gpg|sqlite|db|ldb|dat)$|^id_(rsa|ed25519|ecdsa|dsa)|^ntuser|credential|password|passwd|secret|token|cookie|login data|wallet|\.git-credentials$|\.npmrc$|\.netrc$|\.pypirc$/i;
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.next', 'dist', 'build']);

// a drive's root keeps its backslash: "C:" alone means the current folder on C:, not its root
const norm = (p) => {
  const full = path.resolve(p);
  return /^[a-z]:\\$/i.test(full) ? full : full.replace(/[\\/]+$/, '');
};
const inside = (p, root) => {
  const a = norm(p).toLowerCase();
  const b = norm(root).toLowerCase();
  return a === b || a.startsWith(b.endsWith('\\') ? b : `${b}\\`);
};

// Why he can't go there, or null if he can.
function blocked(p) {
  const full = norm(p);
  if (SYSTEM.test(full) || SYSTEM_FILES.test(full)) return 'that’s a Windows system or program folder';
  const parts = path.relative(HOME, full).split(path.sep);
  if (inside(full, HOME)) {
    if (parts.some((part) => PRIVATE_DIRS.has(part.toLowerCase()))) return 'that’s app data or login stuff';
  } else if (!DRIVES.some((d) => inside(full, d))) {
    return 'only your user folder and the other drives are open to Ty';
  }
  if (SECRET.test(path.basename(full))) return 'that file looks like passwords, keys or logins';
  return null;
}

// The path asked for, made real: aliases, ~, relative to the home folder, then junctions and links
// followed so a link can't lead him somewhere he can't go.
async function resolve(asked) {
  let p = String(asked || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\//g, '\\');
  if (!p || p === '~' || /^home$/i.test(p)) p = HOME;
  p = p.replace(/^~\\?/, `${HOME}\\`);
  const first = p.split('\\')[0].toLowerCase();
  if (ALIASES.includes(first)) p = path.join(alias(first), p.slice(first.length));
  if (!path.isAbsolute(p)) p = path.join(HOME, p);
  const why = blocked(p);
  if (why) throw new Error(`blocked: ${why}`);
  let real;
  try {
    real = await fs.realpath(p);
  } catch {
    throw new Error(`not found: ${p}`);
  }
  const whyReal = blocked(real);
  if (whyReal) throw new Error(`blocked: ${whyReal}`);
  return real;
}

const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function list(asked) {
  const dir = await resolve(asked);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const shown = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name.startsWith('.') && e.isDirectory() || blocked(full)) continue;
    if (e.isDirectory()) shown.push({ dir: true, line: `[folder] ${e.name}` });
    else if (e.isFile()) {
      const st = await fs.stat(full).catch(() => null);
      shown.push({ dir: false, line: `${e.name} (${st ? size(st.size) : '?'})` });
    }
  }
  shown.sort((a, b) => b.dir - a.dir);
  const more = shown.length > LIST_MAX ? `\n…and ${shown.length - LIST_MAX} more` : '';
  return `Folder ${dir} (${shown.length} items):\n${shown.slice(0, LIST_MAX).map((s) => s.line).join('\n') || '(empty)'}${more}`;
}

async function read(asked) {
  const file = await resolve(asked);
  const st = await fs.stat(file);
  if (st.isDirectory()) return list(file);
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, READ_MAX));
    await handle.read(buf, 0, buf.length, 0);
    if (buf.includes(0)) return `File ${file} is not text (${path.extname(file) || 'no extension'}, ${size(st.size)}): Ty can't read inside it.`;
    const cut = st.size > READ_MAX ? `\n[…cut: only the first ${size(READ_MAX)} of ${size(st.size)}]` : '';
    return `File ${file} (${size(st.size)}):\n${buf.toString('utf8')}${cut}`;
  } finally {
    await handle.close();
  }
}

// Files and folders whose name has `query` in it, under the home folder (and the other drives).
async function find(query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) throw new Error('give at least two letters to look for');
  const queue = [HOME, ...DRIVES];
  const found = [];
  const until = Date.now() + FIND_MS;
  let seen = 0;
  while (queue.length && found.length < FIND_MAX && seen < FIND_DIRS && Date.now() < until) {
    const dir = queue.shift();
    seen++;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.name.startsWith('.') || SKIP.has(e.name.toLowerCase()) || blocked(full)) continue;
      if (e.name.toLowerCase().includes(q)) found.push(e.isDirectory() ? `[folder] ${full}` : full);
      if (e.isDirectory() && !e.isSymbolicLink()) queue.push(full);
    }
  }
  return found.length ? `Found ${found.length} for "${query}":\n${found.join('\n')}` : `Nothing named like "${query}" in Tay's folders.`;
}

// Saving a text file for you: same places as reading (never Windows, programs, AppData or secrets),
// a new file right away, an existing one only with `overwrite` (his Overwrite button). Folders are
// made as needed, inside those places.
const WRITE_MAX = 512 * 1024;
const APP_ROOT = path.join(__dirname, '..', '..');
async function write(asked, content, { overwrite = false } = {}) {
  let p = String(asked || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\//g, '\\');
  if (!p) throw new Error('no file name');
  const first = p.split('\\')[0].toLowerCase();
  if (ALIASES.includes(first)) p = path.join(alias(first), p.slice(first.length));
  else if (/^~\\?/.test(p)) p = p.replace(/^~\\?/, `${HOME}\\`);
  else if (!path.isAbsolute(p)) p = path.join(alias('documents'), 'Ty', p); // a bare name: Documents\Ty
  const why = blocked(p) || (inside(p, APP_ROOT) && 'that’s Ty’s own code, he can’t rewrite himself');
  if (why) throw new Error(`blocked: ${why}`);
  if (!path.extname(p)) throw new Error('give the file an extension (like .txt or .py)');
  const text = String(content ?? '');
  if (Buffer.byteLength(text) > WRITE_MAX) throw new Error('too big (max 512 KB)');
  // the deepest folder that exists, made real, has to be allowed too (no links out of bounds)
  let dir = path.dirname(p);
  while (!fss.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const whyDir = blocked(await fs.realpath(dir));
  if (whyDir) throw new Error(`blocked: ${whyDir}`);
  const exists = fss.existsSync(p);
  if (exists) {
    const st = await fs.stat(p);
    if (st.isDirectory()) throw new Error('that’s a folder');
    if (!overwrite) return { ok: false, exists: true, path: p };
    const whyReal = blocked(await fs.realpath(p));
    if (whyReal) throw new Error(`blocked: ${whyReal}`);
  }
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return { ok: true, path: p, size: size(Buffer.byteLength(text)), replaced: exists };
}

const OPS = { ls: list, list, read, find };

// What Ty gets back, always as text (errors included, so he can say what went wrong).
async function run(op, arg) {
  const fn = OPS[String(op).toLowerCase()];
  if (!fn) return `Unknown file action: ${op}`;
  try {
    return await fn(arg);
  } catch (err) {
    return `Couldn't ${op} "${arg}": ${err.message}`;
  }
}

// { ok, path, size, replaced } | { ok: false, exists: true, path } | { ok: false, error }
async function save(asked, content, opts) {
  try {
    return await write(asked, content, opts);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { run, save, blocked, resolve };
