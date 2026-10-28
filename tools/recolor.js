'use strict';

// Ty's colors baked into the pictures the shader doesn't draw (faces, cut-ins, intro, icons):
// the pink-red pulled to a true red, the neon green to electric cyan. Same grade as sprite.js.
// Run once: node_modules\electron\dist\electron.exe tools\recolor.js
// The originals are kept in assets/capri-original; it always starts from them.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'capri');
const KEEP = path.join(ROOT, 'assets', 'capri-original');
// capri-full.png and capri-cutout.png are left alone: the shader grades the sprite itself
const FILES = fs.readdirSync(SRC).filter((f) => /^(face-|cutin-|intro-|capri-face)/.test(f));
const ICONS = ['capri.png', 'tray.png'].map((f) => path.join(ROOT, 'assets', 'icons', f));

const PAGE = `<script>
function rgb2hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h / 6) + 1) % 1, max ? d / max : 0, max];
}
function hsv2rgb(h, s, v) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function grade(r, g, b) {
  let [h, s, v] = rgb2hsv(r, g, b);
  let hx = h < 0.5 ? h + 1 : h;
  const lit = smooth(0.1, 0.3, v);
  const red = smooth(0.78, 0.85, hx) * (1 - smooth(1.06, 1.1, hx)) * lit * smooth(0.06, 0.2, s);
  const green = smooth(0.22, 0.27, h) * (1 - smooth(0.47, 0.52, h)) * lit * smooth(0.15, 0.3, s);
  hx += (1.0 - hx) * red * 0.95;
  h = hx % 1;
  s += (Math.max(s, 0.86) - s) * red;
  h += (0.515 - h) * green; // the green goes electric cyan, red's opposite
  s += (Math.max(s, 0.82) - s) * green;
  v += (Math.min(1, v * 1.25 + 0.05) - v) * red;
  v += (Math.min(1, v * 1.15 + 0.22) - v) * green;
  return hsv2rgb(h, s, v);
}
window.recolor = async (bytes, type) => {
  const bmp = await createImageBitmap(new Blob([bytes], { type }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const [r, g, b] = grade(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
  }
  ctx.putImageData(img, 0, 0);
  const out = await c.convertToBlob({ type, quality: 0.92 });
  return new Uint8Array(await out.arrayBuffer());
};
</script>`;

// a .ico that holds one PNG (Windows Vista and later read those)
function icoFromPng(png) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  head.writeUInt8(w >= 256 ? 0 : w, 6); head.writeUInt8(h >= 256 ? 0 : h, 7);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL(`data:text/html,${encodeURIComponent(PAGE)}`);
  fs.mkdirSync(KEEP, { recursive: true });
  const jobs = [
    ...FILES.map((f) => ({ file: path.join(SRC, f), keep: path.join(KEEP, f) })),
    ...ICONS.map((file) => ({ file, keep: path.join(KEEP, `icon-${path.basename(file)}`) })),
  ];
  for (const { file, keep } of jobs) {
    if (!fs.existsSync(keep)) fs.copyFileSync(file, keep);
    const type = file.endsWith('.webp') ? 'image/webp' : 'image/png';
    const bytes = [...fs.readFileSync(keep)];
    const out = await win.webContents.executeJavaScript(`recolor(new Uint8Array(${JSON.stringify(bytes)}), '${type}').then((a) => [...a])`);
    fs.writeFileSync(file, Buffer.from(out));
    console.log('recolored', path.relative(ROOT, file));
  }
  const ico = path.join(ROOT, 'assets', 'icons', 'ty.ico');
  fs.writeFileSync(ico, icoFromPng(fs.readFileSync(ICONS[0])));
  console.log('wrote', path.relative(ROOT, ico));
  app.quit();
});
