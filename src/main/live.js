'use strict';

// Ty Live: her chat and a little video of her, on any phone or PC on your network (Deck › PC & Chat).
// Off unless you turn it on; every address carries a secret key (?k=…), so nobody on your Wi-Fi gets in
// without the link. What a viewer types is only ever talk: no apps, files, screen or PC actions from
// here (chat.js), and only when you allowed viewers to chat.
//
//   GET  /?k=KEY          the page (src/live)
//   GET  /events?k=KEY    her chat as it happens (server-sent events), the recent part first
//   GET  /video?k=KEY     her, live (MJPEG, a few frames a second, only while someone watches)
//   GET  /face/<name>.png her faces (from her skin, if it has them)
//   POST /say?k=KEY       a message to her: { text }

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 47830;
const PAGE_DIR = path.join(__dirname, '..', 'live');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
const KEEP = 40;       // chat lines a new viewer gets straight away
const FPS = 6;         // her video
const SAY_MAX = 300;   // characters a viewer may send
const SAY_EVERY = 3000; // ...at most every 3 s

const newKey = () => crypto.randomBytes(9).toString('base64url');

// Your PC's addresses on the network (Wi-Fi, Ethernet), not the virtual ones (WSL, VPNs, Docker)
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|tailscale|zerotier|vpn/i.test(name)) continue;
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

function createLive({ getConfig, setConfig, face, capture, wantVideo, onSay }) {
  let server = null;
  const viewers = new Set(); // SSE responses
  const watchers = new Set(); // MJPEG responses
  const recent = [];
  let videoTimer = null;
  let lastSay = 0;

  const key = () => {
    let k = getConfig().liveKey;
    if (!k) {
      k = newKey();
      setConfig({ liveKey: k });
    }
    return k;
  };
  const allowed = (url) => {
    const given = Buffer.from(String(url.searchParams.get('k') || ''));
    const real = Buffer.from(key());
    return given.length === real.length && crypto.timingSafeEqual(given, real);
  };

  function send(res, code, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  }

  function serveFile(res, file) {
    fs.readFile(file, (err, data) => (err ? send(res, 404, 'not found') : send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream')));
  }

  // her video: frames only while someone's watching
  function startVideo() {
    if (videoTimer) return;
    wantVideo(true);
    videoTimer = setInterval(async () => {
      if (!watchers.size) return stopVideo();
      const jpg = await capture().catch(() => null);
      if (!jpg) return;
      for (const res of watchers) {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
        res.write(jpg);
        res.write('\r\n');
      }
    }, 1000 / FPS);
  }
  function stopVideo() {
    clearInterval(videoTimer);
    videoTimer = null;
    wantVideo(false);
  }

  function handle(req, res) {
    const url = new URL(req.url, 'http://ty.local');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/live.css' || p === '/live.js')) return serveFile(res, path.join(PAGE_DIR, p.slice(1)));
    if (req.method === 'GET' && /^\/face\/[a-z-]+\.png$/.test(p)) return serveFile(res, face(p.slice(6)));
    if (!allowed(url)) return send(res, 403, 'Ty Live: this link needs its key (copy the whole link from her Deck).');
    if (req.method === 'GET' && p === '/') return serveFile(res, path.join(PAGE_DIR, 'index.html'));
    if (req.method === 'GET' && p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ chat: getConfig().liveChat !== false, name: 'Ty' })}\n\n`);
      for (const e of recent) res.write(`data: ${JSON.stringify(e)}\n\n`);
      viewers.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); viewers.delete(res); });
      return undefined;
    }
    if (req.method === 'GET' && p === '/video') {
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store', connection: 'close' });
      watchers.add(res);
      req.on('close', () => watchers.delete(res));
      startVideo();
      return undefined;
    }
    if (req.method === 'POST' && p === '/say') {
      if (getConfig().liveChat === false) return send(res, 403, 'chat is off');
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4000) req.destroy(); });
      req.on('end', () => {
        let text = '';
        try {
          text = String(JSON.parse(body).text || '').replace(/\s+/g, ' ').trim().slice(0, SAY_MAX);
        } catch {
          return send(res, 400, 'bad message');
        }
        if (!text) return send(res, 400, 'empty');
        if (Date.now() - lastSay < SAY_EVERY) return send(res, 429, 'slow down');
        lastSay = Date.now();
        onSay(text);
        return send(res, 200, 'ok');
      });
      return undefined;
    }
    return send(res, 404, 'not found');
  }

  return {
    // on or off, as her settings say (called whenever they change)
    sync() {
      const on = getConfig().live === true;
      if (on && !server) {
        key();
        server = http.createServer(handle);
        server.on('error', (err) => { console.error('[ty] live:', err.message); server = null; });
        server.listen(PORT, '0.0.0.0');
      } else if (!on && server) {
        for (const res of [...viewers, ...watchers]) res.end();
        viewers.clear();
        watchers.clear();
        stopVideo();
        server.close();
        server = null;
      }
    },
    // a chat update (chat.js through main.js): to every viewer, and kept for the next ones
    push(update) {
      if (!update || update.type === 'busy' || update.type === 'actions') return;
      if (update.type === 'ty' && !update.done) {
        // her answer as it's written: live, but only the finished one is kept
        for (const res of viewers) res.write(`data: ${JSON.stringify(update)}\n\n`);
        return;
      }
      const e = { ...update, at: Date.now() };
      recent.push(e);
      while (recent.length > KEEP) recent.shift();
      for (const res of viewers) res.write(`data: ${JSON.stringify(e)}\n\n`);
    },
    // the links to share
    links() {
      const k = key();
      const hosts = [`${os.hostname().toLowerCase()}.local`, ...addresses()];
      return { on: Boolean(server), port: PORT, urls: hosts.map((h) => `http://${h}:${PORT}/?k=${k}`) };
    },
    newKey() {
      setConfig({ liveKey: newKey() });
      for (const res of [...viewers, ...watchers]) res.end(); // the old links stop working
      return this.links();
    },
    stop() {
      stopVideo();
      server?.close();
    },
  };
}

module.exports = { createLive };
