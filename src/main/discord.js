'use strict';

// Sending a Discord message for you, through your own Discord app (discord.ps1 does it), only ever
// after your click on Ty's Send button. No bot and no token: it's your Discord, driven like you would.

const path = require('node:path');
const { execFile } = require('node:child_process');

// asar-unpacked when installed, like windows.ps1
const SCRIPT = path.join(__dirname, 'discord.ps1').replace('app.asar', 'app.asar.unpacked');
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

// { ok, message }
function send({ to, text, dryRun = false }) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, message: 'Windows only' });
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-To', b64(to)];
  if (text) args.push('-Text', b64(text));
  if (dryRun) args.push('-DryRun');
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 45000 }, (err, out) => {
      const line = String(out || '').trim().split(/\r?\n/).pop();
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, message: err ? err.message.split('\n')[0] : 'something went wrong' });
      }
    });
  });
}

module.exports = { send };
