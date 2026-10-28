'use strict';

// Talking to her: a local model through Ollama (https://ollama.com). Done from here, not from
// the overlay's page, which can't reach other local ports. Everything stays on this machine
// unless OLLAMA_HOST points somewhere else.

function base() {
  let host = process.env.OLLAMA_HOST || '127.0.0.1:11434';
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  return host.replace('://0.0.0.0', '://127.0.0.1').replace(/\/+$/, '');
}

// Ollama's errors come as {"error": "..."}
async function failure(res) {
  const body = await res.text().catch(() => '');
  try {
    return new Error(JSON.parse(body).error);
  } catch {
    return new Error(body || `Ollama answered ${res.status}`);
  }
}

// The models installed, by name ("llama3.2:latest"...).
async function models() {
  const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw await failure(res);
  const { models: list = [] } = await res.json();
  return list.map((m) => m.name);
}

// Loads the model into memory ahead of the first message (the first answer after a fresh start
// otherwise waits for it to load, which can take a while).
function warm(model) {
  fetch(`${base()}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: '15m' }),
  }).catch(() => {});
}

// Her answer, streamed: onDelta(piece) as it comes, resolves with all of it.
async function chat({ model, messages, cpu = false }, onDelta, signal) {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: cpu ? '5m' : '15m', // he stays loaded while you chat (the tiny CPU one lets go of your RAM sooner)
      ...(/qwen3|deepseek-r1/i.test(model) ? { think: false } : {}), // no silent reasoning first: he answers right away
      options: { temperature: 0.85, num_predict: 900, num_ctx: cpu ? 4096 : 8192, repeat_penalty: 1.1, repeat_last_n: 256, ...(cpu ? { num_gpu: 0 } : {}) }, // room for his 30-message memory (Ollama's default is 4096)
    }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      const piece = msg.message?.content || ''; // a thinking model's reasoning comes apart, and is left out
      if (piece) {
        text += piece;
        onDelta(piece);
      }
      if (msg.done) return text;
    }
  }
  return text;
}

// His eyes: a small vision model says what's on a picture (your screen), in plain words, so the model
// he talks with (which can't see) answers about it in his own voice. Unloads soon after to free the GPU.
// cpu: on the CPU only (his looks of his own): slower, but no VRAM, and gone a minute after
async function look(model, images, question = '', signal, cpu = false) {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: cpu ? '1m' : '3m',
      think: false,
      messages: [{
        role: 'user',
        images,
        content: 'This is a screenshot of my PC screen. Describe what is on it in plain words: which apps or games are open, what they show, '
          + 'and any readable text that matters (titles, messages, code, errors, numbers). Be specific and factual, under 150 words.'
          + (question ? ` I asked about it: "${question.slice(0, 300)}". Cover what that question needs.` : ''),
      }],
      options: { temperature: 0.2, num_predict: 320, num_ctx: 4096, ...(cpu ? { num_gpu: 0 } : {}) },
    }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const data = await res.json();
  return String(data.message?.content || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

// Game mode: every model he has loaded on the GPU let go of right away, so your game gets all of it.
async function unloadAll() {
  const res = await fetch(base() + '/api/ps', { signal: AbortSignal.timeout(2500) });
  const { models: loaded = [] } = await res.json();
  await Promise.all(loaded.filter((m) => m.size_vram > 0).map((m) => fetch(base() + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: m.name, keep_alive: 0 }),
  }).catch(() => {})));
  return loaded.filter((m) => m.size_vram > 0).map((m) => m.name);
}

module.exports = { base, models, warm, chat, look, unloadAll };
