'use strict';

// Ty Live, in a viewer's browser: her chat as it happens (/events), her video in the corner (/video),
// and a box to talk to her when the PC allows it (/say). The key comes from this page's own link.

const key = new URLSearchParams(location.search).get('k') || '';
const q = `?k=${encodeURIComponent(key)}`;
const $ = (s) => document.querySelector(s);
const feed = $('.feed');
const status = $('.status');
const FACES = {
  calm: 'face-calm.png', aside: 'face-aside.png', smug: 'face-smug.png', wide: 'face-wide.png',
  look: 'face-look.png', laugh: 'face-laugh.png', many: 'face-many.png', grin: 'capri-face.png',
};

let typing = null; // her answer being written
let lineTimer = null;

function setStatus(state, text) {
  status.dataset.state = state;
  status.querySelector('em').textContent = text;
}

function nearBottom() {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
}

function add(kind, who, text, quote) {
  const stick = nearBottom();
  feed.querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = `msg msg--${kind}`;
  const w = document.createElement('div');
  w.className = 'msg__who';
  w.textContent = who;
  const t = document.createElement('div');
  t.className = 'msg__text';
  t.textContent = text;
  if (quote) {
    const qq = document.createElement('span');
    qq.className = 'msg__quote';
    qq.textContent = quote;
    t.append(qq);
  }
  el.append(w, t);
  feed.append(el);
  while (feed.children.length > 200) feed.firstElementChild.remove();
  if (stick) feed.scrollTop = feed.scrollHeight;
  return el;
}

function face(name) {
  const img = $('.cam__face');
  const src = `/face/${FACES[name] || FACES.grin}`;
  if (img.getAttribute('src') === src) return;
  img.src = src;
  img.classList.remove('is-swap');
  void img.offsetWidth;
  img.classList.add('is-swap');
}

// a line over her video, for a few seconds (what she just said)
function caption(text) {
  const el = $('.cam__line');
  el.textContent = text.length > 90 ? `${text.slice(0, 88)}…` : text;
  el.classList.add('is-on');
  clearTimeout(lineTimer);
  lineTimer = setTimeout(() => el.classList.remove('is-on'), 6000);
}

function onUpdate(u) {
  if (u.type === 'face') return face(u.face);
  if (u.type === 'user') {
    typing = null;
    return add('you', u.remote ? 'LIVE CHAT' : 'AT THE PC', u.text);
  }
  if (u.type === 'say') {
    if (u.face) face(u.face);
    caption(u.line);
    return add('say', `TY${u.badge ? ` // ${u.badge}` : ''}`, u.line, u.quote);
  }
  if (u.type === 'ty') {
    if (!typing) {
      typing = add('ty', 'TY', '');
      typing.classList.add('is-typing');
    }
    const stick = nearBottom();
    typing.querySelector('.msg__text').textContent = u.text;
    if (stick) feed.scrollTop = feed.scrollHeight;
    if (u.done) {
      typing.classList.remove('is-typing');
      caption(u.text);
      typing = null;
    }
  }
  return undefined;
}

function connect() {
  const events = new EventSource(`/events${q}`);
  events.addEventListener('hello', (e) => {
    const info = JSON.parse(e.data);
    setStatus('live', 'live');
    $('.say').hidden = !info.chat;
    feed.replaceChildren();
    typing = null;
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'nothing yet. talk to her on the PC, or here.';
    feed.append(empty);
  });
  events.onmessage = (e) => onUpdate(JSON.parse(e.data));
  events.onerror = () => setStatus('down', 'reconnecting…');
}

// her video: reloaded if it drops (the PC slept, Ty restarted)
function video() {
  const img = $('.cam__video');
  img.onerror = () => setTimeout(() => { img.src = `/video${q}&t=${Date.now()}`; }, 3000);
  img.src = `/video${q}`;
}

$('.say').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.text;
  const text = input.value.trim();
  if (!text) return;
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch(`/say${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (res.ok) input.value = '';
    else add('say', 'TY LIVE', res.status === 429 ? 'slow down a sec' : res.status === 403 ? 'chat is off on the PC' : 'that didn’t go through');
  } catch {
    add('say', 'TY LIVE', 'couldn’t reach the PC');
  } finally {
    button.disabled = false;
    input.focus();
  }
});

$('.cam__size').addEventListener('click', () => $('.cam').classList.toggle('is-big'));

face('grin');
connect();
video();
