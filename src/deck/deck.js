'use strict';

// Ty // Deck: his settings. Every switch and box saves as you change it (the app table with its Save
// button), straight into his config, and he follows it right away.

const api = window.deck;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let cfg = {};
let apps = [];

function saved(text = 'saved ✓') {
  const el = $('.saved');
  el.textContent = text;
  clearTimeout(saved.timer);
  saved.timer = setTimeout(() => { el.textContent = ''; }, 2200);
}

async function set(patch) {
  Object.assign(cfg, patch);
  await api.set(patch);
  chips();
  saved();
}

// ---------- header chips ----------

function chips() {
  const model = cfg.chatModel === 'auto' ? 'AUTO' : String(cfg.chatModel || '?').split(/[/:]/).slice(-2, -1)[0]?.toUpperCase() || 'MODEL';
  const list = [
    ['CHATBOT ON', true],
    [`MODEL ${model}`.slice(0, 22), true],
    [`APPS ${apps.length}`, apps.length > 0],
    ['WEB ON ASK', true],
    [`GREET ${cfg.greet === false ? 'OFF' : 'ON'}`, cfg.greet !== false],
    [`WATCH ${cfg.watch ? 'ON' : 'OFF'}`, cfg.watch === true],
  ];
  $('.chips').replaceChildren(...list.map(([text, on]) => {
    const el = document.createElement('span');
    el.className = on ? 'chip' : 'chip is-off';
    el.textContent = text;
    return el;
  }));
}

// ---------- tabs ----------

function tab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === name));
  $$('.page').forEach((p) => p.classList.toggle('is-on', p.dataset.page === name));
  if (name === 'found' && !$('.found').childElementCount) found();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => tab(b.dataset.tab)));

// ---------- plain settings: data-key on inputs ----------

function bind() {
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    if (el.type === 'checkbox') {
      // data-optin: off unless turned on (the rest are on unless turned off)
      el.checked = el.hasAttribute('data-invert') ? !cfg[key] : el.hasAttribute('data-optin') ? cfg[key] === true : cfg[key] !== false;
      el.addEventListener('change', () => set({ [key]: el.hasAttribute('data-invert') ? !el.checked : el.checked }));
    } else {
      el.value = cfg[key] ?? '';
      const save = () => set({ [key]: el.hasAttribute('data-num') ? Number(el.value) : el.value.trim() });
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'change', save);
    }
  }
}

// ---------- 01 apps ----------

function cell(value, placeholder) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.className = 'input';
  input.value = value || '';
  input.placeholder = placeholder;
  td.append(input);
  return td;
}

function renderApps() {
  const body = $('.apps tbody');
  body.replaceChildren();
  if (!apps.length) {
    body.innerHTML = '<tr class="empty"><td colspan="5">No custom apps yet. Steam/Epic games and your Start menu work anyway. Add one to give it your own name.</td></tr>';
  }
  apps.forEach((a, i) => {
    const tr = document.createElement('tr');
    tr.append(cell(a.name, 'Bloxstrap'), cell(a.aliases, 'blocks strap, blox strap'), cell(a.path, '%LOCALAPPDATA%\\…\\app.exe'), cell(a.args, ''));
    const actions = document.createElement('td');
    actions.style.whiteSpace = 'nowrap';
    const test = document.createElement('button');
    test.className = 'btn btn--x';
    test.textContent = 'Test';
    test.addEventListener('click', async () => {
      readApps();
      await api.saveApps(apps);
      const res = await api.testLaunch(i);
      saved(res.ok ? `launched ${apps[i].name} ✓` : `couldn’t launch: ${res.error}`);
    });
    const del = document.createElement('button');
    del.className = 'btn btn--x';
    del.textContent = '✕';
    del.title = 'Remove';
    del.addEventListener('click', () => {
      readApps();
      apps.splice(i, 1);
      renderApps();
    });
    actions.append(test, ' ', del);
    tr.append(actions);
    body.append(tr);
  });
}

function readApps() {
  const rows = $$('.apps tbody tr:not(.empty)');
  apps = rows.map((tr) => {
    const [name, aliases, p, args] = $$('input', tr).map((i) => i.value.trim());
    return { name, aliases, path: p, args };
  });
}

$('[data-do="add"]').addEventListener('click', () => {
  readApps();
  apps.push({ name: '', aliases: '', path: '', args: '' });
  renderApps();
  $$('.apps tbody tr').at(-1).querySelector('input').focus();
});

$('[data-do="browse"]').addEventListener('click', async () => {
  const file = await api.browse();
  if (!file) return;
  readApps();
  const name = file.split('\\').pop().replace(/\.(exe|lnk|bat|url)$/i, '');
  apps.push({ name, aliases: '', path: file, args: '' });
  renderApps();
});

$('[data-do="save-apps"]').addEventListener('click', async () => {
  readApps();
  apps = apps.filter((a) => a.name && a.path);
  await api.saveApps(apps);
  renderApps();
  chips();
  saved(`saved ${apps.length} app${apps.length === 1 ? '' : 's'} ✓`);
});

let trying = 0;
$('#try').addEventListener('input', (e) => {
  const text = e.target.value.trim();
  const id = ++trying;
  clearTimeout(trying.timer);
  setTimeout(async () => {
    if (id !== trying) return;
    if (!text) {
      $('.try-out').textContent = 'Type what you’d say. This only shows what would happen; nothing runs.';
      return;
    }
    const hit = await api.tryCommand(text);
    if (id !== trying) return;
    $('.try-out').textContent = hit
      ? `→ Ty would open: ${hit.name} (${{ custom: 'your app', steam: 'Steam game', epic: 'Epic game', app: 'Start menu' }[hit.kind] || hit.kind})`
      : '→ nothing matches: he’d tell you he can’t find it';
  }, 250);
});

// ---------- 02 found ----------

async function found(fresh = false) {
  $('.found-count').textContent = 'scanning…';
  const list = fresh ? await api.rescan() : await api.installed();
  const tag = { steam: 'Steam', epic: 'Epic', app: 'Start', custom: 'Yours' };
  $('.found').replaceChildren(...list
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)))
    .map((it) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `[${tag[it.kind] || it.kind}] `;
      li.append(b, it.name);
      return li;
    }));
  $('.found-count').textContent = `${list.length} things he can open`;
}
$('[data-do="rescan"]').addEventListener('click', () => found(true));

// ---------- the rest of the buttons ----------

$('[data-do="weather"]').addEventListener('click', async () => {
  $('.weather-out').textContent = 'checking…';
  const res = await api.weather(cfg.weatherCity, cfg.weatherUnits);
  $('.weather-out').textContent = res.text;
});
$('[data-do="greet"]').addEventListener('click', () => api.greet());
$('[data-do="open-chat"]').addEventListener('click', () => api.openChat());
$('[data-startup]').addEventListener('change', (e) => { api.startup(e.target.checked); saved(); });

// ---------- skins ----------

async function skins(pick = cfg.skin || '') {
  const list = await api.skins();
  const el = $('[data-key="skin"]');
  el.replaceChildren(...[['', 'Capri (default)'], ...list.map((s) => [s, s])].map(([v, t]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    return o;
  }));
  el.value = list.includes(pick) ? pick : '';
}
$('[data-do="new-skin"]').addEventListener('click', async () => {
  const res = await api.newSkin($('#skin-name').value);
  if (!res.ok) {
    $('.skin-out').textContent = `couldn’t: ${res.error}`;
    return;
  }
  $('#skin-name').value = '';
  await skins(res.name);
  await set({ skin: res.name });
  $('.skin-out').textContent = `made “${res.name}” and switched to it. It looks like Capri until you draw over its pictures (folder opened). Pick it again here to reload after you save changes.`;
});
$('[data-do="open-skins"]').addEventListener('click', () => api.openSkins());

// ---------- start ----------

(async () => {
  const init = await api.init();
  cfg = init.cfg;
  apps = cfg.customApps || [];
  $('.version').textContent = `v${init.version}`;
  const models = $('[data-key="chatModel"]');
  models.replaceChildren(...[['auto', 'Auto (picks one per message)'], ...init.models.map((m) => [m, m])].map(([v, t]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    return o;
  }));
  $('[data-startup]').checked = init.startup;
  await skins();
  bind();
  renderApps();
  chips();
  tab(init.tab || 'apps');
})();
