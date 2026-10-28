'use strict';

// Ty typing into an open app, or pressing a shortcut in it, after your click on his button
// (control.ps1 does it, refusing terminals and system tools). And web search, only when you ask him.

const path = require('node:path');
const { execFile } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'control.ps1').replace('app.asar', 'app.asar.unpacked');
const b64 = (s) => Buffer.from(String(s || ''), 'utf8').toString('base64');

// { ok, message }
function act({ app, text = '', keys = '' }) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, message: 'Windows only' });
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-App', b64(app)];
  if (text) args.push('-Text', b64(text));
  if (keys) args.push('-Keys', b64(keys));
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 30000 }, (err, out) => {
      try {
        resolve(JSON.parse(String(out || '').trim().split(/\r?\n/).pop()));
      } catch {
        resolve({ ok: false, message: err ? err.message.split('\n')[0] : 'something went wrong' });
      }
    });
  });
}

// DuckDuckGo's plain HTML results: titles, links and snippets, then the text of the first page or two.
// Only the query leaves the PC, and only when you asked him to search.
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

async function pageText(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(6000), redirect: 'follow' });
  if (!res.ok || !/text\/html|text\/plain/.test(res.headers.get('content-type') || '')) return '';
  const html = (await res.text()).slice(0, 400000);
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ');
  return decode(body).slice(0, 2500);
}

async function search(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return 'Nothing to search for.';
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: UA, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < 6) {
      let url = m[1];
      const real = /uddg=([^&]+)/.exec(url);
      if (real) url = decodeURIComponent(real[1]);
      if (url.startsWith('//')) url = `https:${url}`;
      if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
      results.push({ title: decode(m[2]), url, snippet: decode(m[3]) });
    }
    if (!results.length) return `No results for "${q}".`;
    const pages = await Promise.all(results.slice(0, 2).map((r) => pageText(r.url).catch(() => '')));
    const list = results.map((r, i) => `${i + 1}. ${r.title} (${r.url})\n${r.snippet}`).join('\n');
    const read = pages.map((t, i) => (t ? `\n--- from ${results[i].url} ---\n${t}` : '')).join('');
    return `Web results for "${q}" (today is ${new Date().toDateString()}):\n${list}${read}`;
  } catch (err) {
    return `Search failed: ${err.message}`;
  }
}

module.exports = { act, search };
