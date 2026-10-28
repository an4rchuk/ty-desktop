'use strict';

// Ty's chat window: what you type goes to Ty on your desktop (his overlay answers it, with all he can do),
// and his answer, his buttons and what really happened come back here as they stream in.

const log = document.querySelector('.log');
const form = document.querySelector('.compose');
const input = document.querySelector('.compose__input');
const send = document.querySelector('.compose__send');
const skin = document.querySelector('.skin');
const label = document.querySelector('.head__label');
const host = window.chatwin;

let live = null; // his message being written right now

function bubble(who, text) {
  const msg = document.createElement('section');
  msg.className = `msg msg--${who}`;
  const name = document.createElement('p');
  name.className = 'msg__who';
  name.textContent = who === 'ty' ? 'Ty' : 'You';
  const body = document.createElement('p');
  body.className = 'msg__text';
  body.textContent = text;
  msg.append(name, body);
  log.append(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

function busy(on) {
  document.body.classList.toggle('is-busy', on);
  label.textContent = on ? 'LIVE' : 'IDLE';
  send.disabled = on;
}

// what Ty's overlay says: { type: 'user' | 'ty' | 'actions', … }
host.onUpdate((u) => {
  if (u.type === 'user') {
    bubble('me', u.text);
    live = null;
    busy(true);
  } else if (u.type === 'ty') {
    if (!live) live = bubble('ty', '');
    live.querySelector('.msg__text').textContent = u.text;
    live.classList.toggle('is-live', !u.done);
    if (u.done) busy(false);
    log.scrollTop = log.scrollHeight;
  } else if (u.type === 'actions' && live) {
    live.querySelector('.msg__actions')?.remove();
    if (!u.actions.length) return;
    const row = document.createElement('div');
    row.className = 'msg__actions';
    for (const a of u.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = a.label;
      if (a.primary) button.className = 'is-primary';
      button.addEventListener('click', () => {
        row.remove();
        host.answer(a.id); // exactly as clicking it on his panel
      });
      row.append(button);
    }
    live.append(row);
    log.scrollTop = log.scrollHeight;
  } else if (u.type === 'busy') {
    busy(u.on);
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  input.value = '';
  host.send(text);
});

skin.addEventListener('change', () => {
  document.documentElement.dataset.skin = skin.value;
  document.querySelector('.head__mode').textContent = skin.value === 'an4rch' ? 'AN4RCH' : skin.value.toUpperCase();
  host.setSkin(skin.value);
});

// the conversation so far, and the skin you picked last time
(async () => {
  const { history, skin: saved } = await host.init();
  if (saved) {
    skin.value = saved;
    skin.dispatchEvent(new Event('change'));
  }
  for (const m of history.slice(-40)) {
    const text = String(m.content)
      .replace(/\[\[[^\]]*\]\]/g, '')
      .replace(/\n?\[result: ([^\]]*)\]/g, '\n$1')
      .replace(/[\p{Extended_Pictographic}‍️]+\s?/gu, '') // no emoji, old chats included
      .trim();
    if (text) bubble(m.role === 'user' ? 'me' : 'ty', text);
  }
  if (!history.length) bubble('ty', 'yo. type to me here, same as on the desktop.');
  input.focus();
})();
