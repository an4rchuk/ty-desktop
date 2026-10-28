// Talking to her: you type in her panel, and a model (setup.js picks which) answers as her, in
// writing. The replies are AI-generated, and the panel says so on every chat.
// She can do a few things on your PC when you ask (Windows): open an app or a game, play music or
// control what's playing, open a website, close an app. She spots what you want in what you wrote,
// or the model asks for it with a tag in its answer. Music right away; an app you named yourself
// right away; anything only the model asked for, a website, and closing an app behind a button.

import { pick, fmt } from './util.js';
import { ASSISTANT_NAMES } from './lines.js';

const REMEMBER = 30; // messages she has in mind when answering
const KEEP = 400;    // messages she remembers across restarts (memory.json)
// her language, where small models need it: how she says "we" (else it's in English), and the last line
// of her prompt, in that language (they drift into the English of everything above it)
const IN_LANGUAGE = {
  fr: { we: '"on" or "nous" in French', last: 'Écris tout en français, sauf si l’utilisateur t’écrit dans une autre langue : alors dans la sienne. Seuls les mots d’argot de Night City restent en anglais, jamais une phrase entière.' },
  en: { we: '', last: 'Write everything in English, unless the user writes to you in another language: then in theirs.' },
  es: { we: '"nosotros" in Spanish', last: 'Escribe todo en español, salvo si el usuario te escribe en otro idioma: entonces en el suyo. Solo las palabras de jerga de Night City se quedan en inglés, nunca una frase entera.' },
  pt: { we: '"a gente" or "nós" in Portuguese', last: 'Escreva tudo em português do Brasil, a não ser que o usuário te escreva em outra língua: aí, na dele. Só as gírias de Night City ficam em inglês, nunca uma frase inteira.' },
  ru: { we: '"мы" in Russian', last: 'Пиши всё по-русски, если только пользователь не пишет тебе на другом языке: тогда на его языке. По-английски остаются только словечки Найт-Сити, никогда не целые фразы.' },
};
const STAY_MS = 10 * 60 * 1000; // no wandering off mid-conversation
const LOADING_AFTER_MS = 5000;
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i; // [[close: AM Music]] at the end of her answer
// "close", "shut down", "ferme", "quitte", "cierra", "fecha", "закрой"... in any of her languages
const CLOSE_ASK = /\b(close|shut|quit|kill|exit)|ferm|quitt|coupe|arr[êe]t|cierr|cerra|fech|закр|выключ/i;
// her other tags: [[open: Spotify]], [[music: Bad Bunny]], [[media: next]], [[site: youtube.com]]
const TAG = /\[\[\s*(open|music|media|site)\s*:\s*([^\]]*)\]\]/i;
// "open", "launch", "ouvre", "lance", "abre", "открой"... in any of her languages
const OPEN_ASK = /\b(open|launch|start|run)\b|ouvr|lance|démarre|abre|abrir|inicia|ejecuta|executa|открой|запусти/i;
// what to do with the music playing, said plainly (only when it's about music, or said in a few words)
const MEDIA_ASK = [
  ['pause', /\b(pause|pausa|pausar)\b|stop (the )?music|arrête la musique|пауз/i],
  ['next', /\b(next|skip|suivante?|siguiente|próxima|proxima)\b|passe (à )?la suivante|salta|pula|следующ/i],
  ['previous', /\b(previous|précédente?|anterior)\b|предыдущ/i],
  ['play', /\b(resume|reprends|reanuda|retoma)\b|relance la musique|remets la musique|продолж/i],
  ['volup', /\b(louder|plus fort)\b|monte le son|turn (it )?up|sube el volumen|aumenta o volume|громче/i],
  ['voldown', /\b(quieter|moins fort)\b|baisse le son|turn (it )?down|baja el volumen|abaixa o volume|тише/i],
  ['mute', /\bmute\b|coupe le son|silencia|sem som|выключи звук/i],
];
const MUSIC_WORD = /musi|chanson|song|track|titre|morceau|spotify|canci|faixa|песн|музык|трек/i;
// "put X on Spotify", "mets X sur Spotify", "pon X en Spotify", "coloca X no Spotify", "включи X в Spotify"
const SPOTIFY_ASK = /(?:play|put on|put|mets|joue|lance|écoute|pon|toca|reproduce|coloca|toque|включи|поставь)\s+(?:moi\s+|me\s+)?(.+?)\s+(?:on|sur|en|no|na|в)\s+spotify/i;
const MEDIA_ACTIONS = new Set(MEDIA_ASK.map(([action]) => action));
// what her tag needs to find in your message before it does anything: a small model tags answers about
// anything ("[[music: synthwave]]" under a film tip), and music and the media keys act right away
const LISTEN = /[ée]cout|listen|escuch|\bouv(ir|e)\b|слуша|playlist|album|\b(play|joue|mets|pon|toca|coloca)\b|включи|поставь/i;
const SOUND = /\b(sound|volume|volumen)\b|\b(le|du|au) son\b|\bo som\b|звук|громк/i; // not "son": "his" in French
const PLAY = /\bjou(er|e)\b|\bplay\b|jugar|juega|jogar|joga|играть|поигра/i;
const SITE = /\b(site|web|page|lien|link|url|enlace|p[aá]gina)|сайт|ссылк|\.(com|fr|org|net|io|gg|tv|be|ch|ca|es|br|pt|ru)\b/i;
// "appelle-moi Max", "call me Max", "llámame Max", "me chama de Max", "зови меня Макс"
const NAME_ASK = /(?:appelle[- ]moi|call me|my name is|je m['’]appelle|ll[aá]mame|me llamo|me cham[ae] de|meu nome [eé]|зови меня|меня зовут)\s+([\p{L}\p{N}'’-]{1,24})/iu;
// "souviens-toi que…", "remember that…", "recuerda que…", "lembra que…", "запомни, что…" (said first thing)
const MEMO_ASK = /^\s*(?:ty,?\s+|stp,?\s+|please,?\s+)?(?:souviens[- ]toi(?: que| de)?|n['’]oublie pas(?: que| de)?|remember(?: that)?|recuerda(?: que)?|lembr[ae](?:-se)?(?: que| de)?|запомни,?(?: что)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;
// sites asked for by name ("open youtube") when no app on the PC goes by it: the address is hers, not
// the model's, so it opens right away like an app you named
const SITES = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  twitch: 'https://www.twitch.tv', netflix: 'https://www.netflix.com', reddit: 'https://www.reddit.com',
  twitter: 'https://x.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com',
  facebook: 'https://www.facebook.com', github: 'https://github.com', chatgpt: 'https://chatgpt.com',
  wikipedia: 'https://www.wikipedia.org', linkedin: 'https://www.linkedin.com', pinterest: 'https://www.pinterest.com',
  crunchyroll: 'https://www.crunchyroll.com', outlook: 'https://outlook.live.com', whatsapp: 'https://web.whatsapp.com',
  discord: 'https://discord.com/app', soundcloud: 'https://soundcloud.com', deezer: 'https://www.deezer.com',
};
// a browser named with a site ("open youtube on chrome"): the site, in the browser you use
const BROWSER = /chrome|edge|firefox|opera|brave|vivaldi|duckduckgo|browser/i;
// local models this small mostly talk nonsense ("llama3.2:1b", "qwen2.5:0.5b"…)
const TINY = /[:-](0\.5b|1b|1\.5b|135m|270m|360m)\b/i;
// Ty looking at your files (main/files.js, read-only): [[ls: desktop]], [[read: documents\notes.txt]],
// [[find: essay]]. The result goes back to the model, which then answers (a few rounds at most).
const FILE_TAG = /\[\[\s*(ls|list|read|find)\s*:\s*([^\]]*)\]\]/i;
const FILE_ROUNDS = 3;
const FILE_RULES = [
  'Tay\'s files: you can look at them (read-only) when Tay asks. To do it, end your message with ONE tag and nothing after it; the result comes back to you, then you answer. [[ls: FOLDER]] lists a folder, [[read: FILE]] reads a text file, [[find: NAME]] searches Tay\'s folders for files whose name contains NAME. Paths can be full (C:\\Users\\...\\file.txt) or start with desktop, documents, downloads, pictures, music or videos (like desktop\\notes.txt). Don\'t guess file names: list or find first. Never make up what a file says. No tag unless Tay asked about files.',
  'Saving a file when Tay asks (notes, code, a list, anything text): write a few words, then the file between tags, then nothing after:\n[[write: documents\\notes.txt]]\nthe whole text of the file\n[[/write]]\nPaths work like reading (desktop\\…, documents\\…, or full paths); a bare name like todo.txt goes in Documents\\Ty. Always give an extension (.txt, .py, .md…). Tay\'s PC tells them whether it saved, so never claim it did. To change a file, read it first, then write the whole new version. You can\'t delete, move or run files.',
  'Windows and System32, Program Files, ProgramData, AppData, and anything with passwords, keys or logins are locked to you on purpose (so you can never break the PC): if Tay asks for those, say you can\'t touch that stuff.',
];
// Ty actually moving when you ask him to (instead of describing it): [[move: spin]]
const MOVE_TAG = /\[\[\s*move\s*:\s*([a-z]+)\s*\]\]/i;
const MOVES = ['spin', 'hop', 'victory', 'zap', 'split', 'look', 'curious', 'teleport'];
const MOVE_ASK = /walk|move|danc|spin|jump|hop|cool|show ?off|teleport|zap|flex|trick|split|go somewhere|do something|lightning|victory|celebrat/i;
// a Discord message he drafted: [[discord: jake | omw]]. Sent only from his Send button (main/discord.js)
const DISCORD_TAG = /\[\[\s*discord\s*:\s*([^|\]]+)\|([^\]]+)\]\]/i;
const DISCORD_ASK = /discord|\bdms?\b|message|\btext\b|\btell\b|\bsend\b|\bmsg\b|\bask\b|\btag\b|\bping\b|\bsay\b/i;
// a file he saves for you: [[write: documents\notes.txt]] …the text… [[/write]] (main/files.js)
const WRITE_BLOCK = /\[\[\s*write\s*:\s*([^\]]+?)\s*\]\]\n?([\s\S]*?)(?:\[\[\s*\/\s*write\s*\]\]|$)/gi;
// typing into an open app, or a shortcut in it, behind his button (main/control.js):
// [[type: notepad | hello]], [[keys: notepad | ctrl+s]]
const TYPE_TAG = /\[\[\s*type\s*:\s*([^|\]]+)\|([^\]]*)\]\]/i;
const KEYS_TAG = /\[\[\s*keys?\s*:\s*([^|\]]+)\|([^\]]+)\]\]/i;
// the web, only when you asked: [[search: what to look up]]
const SEARCH_TAG = /\[\[\s*search\s*:\s*([^\]]+)\]\]/i;
const SEARCH_ASK = /\bsearch|look (it |that |this |them )?up|google|on the (web|internet|net)|\bonline\b|latest|\bnews\b|\bweb\b/i;
// he says he did something he has no tag for: what you asked, and what he claims
const DO_ASK = /\b(write|save|make|create|note|file|type|press|click|search|look up|google|tag|send|post|message|dm)\b/i;
const DID_CLAIM = /\b(saved|wrote|written|created|made (it|the|a|you)|typed|pressed|searched|looked it up|drafted|sent|posted|tagged|done|on it)\b/i;
const ANY_TAG = /\[\[\s*(write|type|keys?|search|discord|ls|list|read|find|open|music|media|site|close)\s*:/i;
// what kind of message it is, for "Auto" in his AI model menu (main.js picks the model by it):
// doing something, thinking something through, or just talking (a look at your screen is seen there)
const ACT_ASK = /\b(file|folder|desktop|documents|downloads|read|open|launch|play|close|pause|skip|discord|server)\b/i;
const THINK_ASK = /\b(code|coding|python|javascript|js|html|css|java|c\+\+|c#|lua|script|function|variable|loop|array|class|bug|error|debug|explain|teach|learn|homework|essay|math|calculate|difference|compare|plan|why|how (do|does|to|would|can))\b/i;
function routeOf(text) {
  if (DO_ASK.test(text) || SEARCH_ASK.test(text) || ACT_ASK.test(text)) return 'act';
  if (THINK_ASK.test(text) || text.trim().split(/\s+/).length > 30) return 'think';
  return 'talk';
}
// the PC (main/pc.js): Discord's mute and deafen, locking, minimising, and power (behind a button)
const MUTE_ME_ASK = /\b(un)?mute me\b|\bmute (my )?mic\b|\btoggle mute\b|\bmute (me )?(on|in) discord\b/i;
const DEAFEN_ASK = /\b(un)?deafen\b/i;
const LOCK_ASK = /\block (my |the |this )?(pc|computer|screen|laptop)\b/i;
const MINIMISE_ASK = /\bminimi[sz]e (everything|it all|all( my)?( windows)?)\b|\bshow (me )?(the |my )?desktop\b|\bhide (all|everything)\b/i;
const RESTORE_ASK = /\bbring (them|everything|it all|my windows|the windows) back\b|\brestore (my |the |all )?windows\b|\bunminimi[sz]e\b/i;
const POWER_ASK = [
  ['shutdown', /\b(shut ?down|turn off|power off) (my |the |this )?(pc|computer)\b|^\s*shut ?down\s*$/i],
  ['restart', /\b(restart|reboot) (my |the |this )?(pc|computer)\b|^\s*(restart|reboot)\s*$/i],
  ['sleep', /\b(put )?(my |the |this )?(pc|computer) to sleep\b|\bsleep (my |the )?(pc|computer)\b/i],
];
// the weather, looked up before he answers so he gives the real numbers (Open-Meteo, the city from the Deck)
const WEATHER_ASK = /\b(weather|forecast|temperature|raining|rain today|snowing|how (hot|cold|warm)|umbrella|is it sunny|degrees outside)\b/i;
// slurs: never from him, on any model (an uncensored one will say them if pushed). Swearing is fine.
const SLUR = /\bn+[i1!|y]+[gq]{2,}(?:a|ah|uh|er|ers|as|az|uz)?s?\b|\bf+[a@4]+[gq]{1,2}(?:[o0]+t+)?s?\b|\bretard(?:ed|s)?\b|\btr[a@]nn(?:y|ie)s?\b|\bch[i1]nks?\b|\bsp[i1]cs?\b|\bk[i1]kes?\b|\bwetbacks?\b|\bcoons?\b|\bgooks?\b|\bdykes?\b/i;
const NOPE = 'nah. not saying that.';
// reminders and timers (main.js keeps them and fires them): "remind me in 20 min to…", "set a timer for 5 minutes",
// "remind me at 6pm to…"; "what are my reminders", "cancel my reminders"
const REMIND_ASK = /\bremind me\b|\btimer\b|\balarm\b|\b(set|start|make) (me )?(a|an) reminder\b/i;
const REMIND_LIST = /\b(what|show|list|any)\b.*\b(reminders|timers|alarms)\b/i;
const REMIND_CLEAR = /\b(cancel|clear|delete|remove|stop)\b.*\b(reminders?|timers?|alarms?)\b/i;
const WATCH_ON = /\b(watch|keep an eye on|comment on) (my|the) screen\b|\bwatch what i'?m doing\b|\bscreen ?watch(ing)? on\b/i;
const WATCH_OFF = /\b(stop|quit|don'?t|dont|no more) (watching|looking at|commenting on) (my |the )?screen\b|\bscreen ?watch(ing)? off\b/i;
// "move spotify to my samsung", "put discord on monitor 2", "chuck chrome on the other screen" (pc.js picks
// the monitor: a number, left/right, main, other, or its brand)
const MOVE_WIN_ASK = /\b(?:move|put|send|throw|chuck|drag|shift|stick)\s+(?:my\s+|the\s+)?([\w .'-]{2,30}?)\s+(?:window\s+|app\s+)?(?:to|onto|on|over to|into)\s+(?:my\s+|the\s+)?(.{1,40}?)\s*[.!?]*$/i;
const MONITOR_WORD = /\b(monitor|screen|display|left|right|other|next|main|primary|samsung|dell|lg|asus|acer|aoc|msi|benq|hp|gigabyte|philips|viewsonic|alienware|iiyama|lenovo)\b|^\d$/i;
const UNITS = { s: 1e3, sec: 1e3, second: 1e3, m: 6e4, min: 6e4, minute: 6e4, h: 36e5, hr: 36e5, hour: 36e5 };
const IN_TIME = /\b(?:in|for|after)\s+(an?|\d+(?:\.\d+)?)\s*(s|sec|second|m|min|minute|h|hr|hour)s?\b/i;
const AT_TIME = /\b(at|for)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i; // "for 7am" needs the am/pm (or 7:30)
const BARE_TIME = /\b(an?|\d+(?:\.\d+)?)[\s-]*(s|sec|second|m|min|minute|h|hr|hour)s?\b/i; // "a 15 second timer"
// you asked him to write or save something (else a [[write]] in his answer is dropped, not saved)
const SAVE_ASK = /\b(write|save|make|create|note|file|folder|txt|document|list|script)\b/i;

// When a reminder goes off (ms), from what you said: "in 20 min", "in an hour", "in half an hour",
// "for 5 minutes", "at 6pm", "at 18:30". Null when there's no time in it.
function whenOf(text) {
  if (/\bhalf an? hour\b/i.test(text)) return Date.now() + 30 * 6e4;
  const rel = IN_TIME.exec(text);
  if (rel) return Date.now() + (/^an?$/i.test(rel[1]) ? 1 : Number(rel[1])) * UNITS[rel[2].toLowerCase()];
  let at = AT_TIME.exec(text);
  if (at && at[1].toLowerCase() === 'for' && !at[3] && !at[4]) at = null;
  if (at) at = [at[0], at[2], at[3], at[4]];
  if (!at) {
    const bare = BARE_TIME.exec(text);
    if (bare) return Date.now() + (/^an?$/i.test(bare[1]) ? 1 : Number(bare[1])) * UNITS[bare[2].toLowerCase()];
  }
  if (at) {
    let h = Number(at[1]) % 24;
    const pm = at[3]?.toLowerCase();
    if (pm === 'pm' && h < 12) h += 12;
    if (pm === 'am' && h === 12) h = 0;
    const d = new Date();
    d.setHours(h, Number(at[2] || 0), 0, 0);
    if (!pm && !at[2] && h < 12 && d.getTime() <= Date.now()) d.setHours(h + 12); // "at 6": the next 6 o'clock
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return null;
}

// What to remind you of: what's left once the asking and the time are taken out.
function remindText(text) {
  const what = text
    .replace(new RegExp(IN_TIME.source, 'gi'), ' ')
    .replace(new RegExp(AT_TIME.source, 'gi'), ' ')
    .replace(new RegExp(BARE_TIME.source, 'gi'), ' ')
    .replace(/\bin half an? hour\b/gi, ' ')
    .replace(/^.*?\bremind me\b\s*(?:to|about|that|of)?\s*|^.*?\b(?:timer|alarm|reminder)\b\s*(?:to|for)?\s*/i, '')
    .replace(/^\s*(?:to|about|that)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[?.!\s]+$/, '')
    .trim();
  return what.length > 1 ? what : '';
}

// "look at my screen", "what am i doing", "what's on my screen"… (he sees it only when you ask)
const SCREEN_ASK = /\bscreen\b|monitor|screenshot|what am i (doing|looking at|playing|on|watching)|what('?s| is) (this|that) on|look at (this|that|what)|\bsee (this|that|what i)/i;

export class Chat {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = []; // your chats with her, [{ role, content }], kept by main.js across restarts
    this.warm = false; // a model already answered this run (Ollama's first answer waits for it to load)
    this.open = false;
    this.turn = 0;     // id of the answer coming in, if any
    this.answer = '';
    this.apps = [];    // the apps open on this PC, as last listed: [{ name, label }]
    this.appsReady = Promise.resolve();
    this.onSetup = null; // (status) => void: she can't answer yet (app.js hands it to setup.js)
    this.onBetterModel = null; // () => void: a bigger model than the tiny one she's on (setup.js)
    host.onChatDelta(({ id, text }) => this.onDelta(id, text));
    this.acts = []; // his action log in the panel: [{ k, v }]
    // his chat window (main.js): what he writes and the buttons he offers go there too, while you chat
    const stream = panel.stream.bind(panel);
    panel.stream = (text, opts = {}) => {
      stream(text, opts);
      if (this.open) host.mirror({ type: 'ty', text, done: Boolean(opts.done) });
    };
    const setActions = panel.setActions.bind(panel);
    panel.setActions = (actions = [], onAction) => {
      setActions(actions, onAction);
      if (this.open) host.mirror({ type: 'actions', actions: actions.map(({ id, label, primary }) => ({ id, label, primary })) });
    };
  }

  // A line of his action log ("Heard", "Saved", "Sent"…), the last few kept under his answer.
  note(k, v) {
    this.acts = [...this.acts, { k, v: v.length > 60 ? `${v.slice(0, 59)}…` : v }].slice(-4);
    this.panel.setActs(this.acts);
  }

  // Typed in his chat window: his chat opens on the desktop if it isn't, and it's sent there.
  async typed(text) {
    if (!this.open) await this.start();
    if (this.open && !this.turn) return this.send(text);
    this.host.mirror({ type: 'user', text });
    this.host.mirror({ type: 'ty', text: this.turn ? 'one sec, still answering the last one' : 'can’t chat right now: check his AI model (right-click him)', done: true });
  }

  get t() {
    return this.brain.t.chat;
  }

  async start() {
    const { capri, host, t } = this;
    if (this.open) {
      this.panel.chatInput.focus();
      return;
    }
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    const status = await host.chatStatus();
    if (!status.ok && this.onSetup) {
      this.onSetup(status); // nothing to talk with yet: she sets it up with you, with buttons (setup.js)
      return;
    }
    if (!status.ok) {
      // no Ollama, or nothing to talk with yet: what to do about it
      const offline = status.error === 'offline';
      const other = !offline && status.error !== 'nomodel'; // another provider, saying why
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: other ? t.failed : offline ? t.offline : t.noModel,
        quote: other ? status.error : offline ? t.offlineHow : t.noModelHow,
        actions: offline
          ? [{ id: 'get', label: t.getOllama, primary: true }, { id: 'ok', label: t.ok }]
          : [{ id: 'ok', label: t.ok, primary: true }],
        onAction: (id) => {
          if (id === 'get') host.openOllama();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    this.history = await host.chatMemory().catch(() => this.history); // "forget" in her menu may have emptied it
    this.cold = status.warmup && !this.warm;
    this.agent = Boolean(status.agent); // Claude Code answers, as her, and really works in your project
    this.listApps();
    const shortModel = status.model.replace(/:latest$/, '').replace(/^models\//, ''); // Ollama's tag, Gemini's prefix
    const tiny = status.provider === 'ollama' && TINY.test(status.model) && this.onBetterModel;
    host.focusOverlay(true); // the keyboard, for typing to her
    const shown = this.panel.say({
      kind: 'chat',
      face: 'look',
      badge: t.badge,
      tag: shortModel,
      line: tiny ? fmt(t.tiny, { model: shortModel }) : pick(this.history.length ? t.again : t.hello),
      actions: tiny ? [{ id: 'better', label: t.better, primary: true }] : [],
      onAction: () => {
        this.panel.hide(); // her chat holds off her guide's panels: it goes first
        this.onBetterModel?.();
      },
      chat: {
        placeholder: t.placeholder,
        send: t.send,
        close: t.close,
        noteTag: t.noteTag,
        note: status.local ? t.note : t.noteCloud,
      },
      onSend: (text) => this.send(text),
      onLeave: () => this.close(),
      hold: null,
    });
    if (!shown) {
      host.focusOverlay(false); // something more important is on (a permission prompt)
      return;
    }
    this.open = true;
    setTimeout(() => this.panel.chatInput.focus(), 150); // once the overlay has the keyboard
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = 0;
    this.host.focusOverlay(false);
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
  }

  async send(text) {
    if (this.turn || !this.open) return;
    const id = Date.now();
    this.turn = id;
    this.answer = '';
    this.history.push({ role: 'user', content: text });
    this.panel.setChatBusy(true);
    this.panel.setActions([]); // a close button she offered before goes with a new message
    this.panel.chatTurn({ quote: text, face: 'aside' });
    this.host.mirror({ type: 'user', text });
    this.note('Heard', `"${text}"`);
    this.capri.pulse();
    // what you asked for plainly happens right away (the music, the volume, an app you named): her
    // line about it comes under her answer (Claude Code, answering her chat, does things its own way)
    const asked = this.agent ? null : this.asked(text);
    const early = asked && asked.kind !== 'close' ? this.doNow(asked) : null;
    // game mode (main.js): something plain you asked for just happens, with no model at all, so it's
    // instant and costs your game nothing
    if (this.gaming && early && asked.kind !== 'power') {
      const done = await early.catch(() => null);
      if (done && this.turn === id) {
        this.turn = 0;
        this.remember({ role: 'assistant', content: done.line });
        this.panel.stream(done.line, { done: true });
        this.panel.setFace(done.face || 'smug');
        this.panel.setChatBusy(false);
        this.host.mirror({ type: 'ty', text: done.line });
        return;
      }
    }
    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    const messages = [{ role: 'system', content: this.persona() }, ...this.history.slice(-REMEMBER)];
    const route = routeOf(text); // which model answers, on "Auto"
    // you asked him to look at your screen: a fresh capture goes with your message, this once (never kept)
    if (!this.agent && SCREEN_ASK.test(text)) {
      this.panel.stream(this.t.lookingScreen || 'looking…');
      const shot = await this.host.screenshot().catch(() => null);
      if (shot) {
        messages[messages.length - 1] = {
          role: 'user',
          content: `${text}\n[attached: a screenshot of ${this.nm()}'s screen right now. Your own little red figure may be in it: ignore that.]`,
          images: [shot],
        };
      }
    }
    // you asked about the weather: the real forecast goes with your message, so he answers with it
    if (!this.agent && WEATHER_ASK.test(text)) {
      const city = /\b(?:in|for|at)\s+([\p{L}][\p{L}\s.'-]{1,40}?)\s*(?:today|tomorrow|rn|right now|now|\?|$)/iu.exec(text)?.[1];
      const w = await this.host.weather(city || '').catch(() => null);
      if (w) {
        this.note('Weather', w.ok ? w.text.split(':')[0] : 'failed');
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content: `${messages[messages.length - 1].content}\n[${w.ok ? `live weather from Open-Meteo: ${w.text}` : `weather lookup failed: ${w.text}`}. Answer with these real numbers; don't make any up.]`,
        };
      }
    }
    // nothing yet after a few seconds: Ollama is still loading the model (the first answer after a start),
    // or Claude Code is at work
    const wait = this.agent ? this.t.working : this.cold ? this.t.loading : null;
    const slow = wait && setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.stream(wait);
    }, LOADING_AFTER_MS);
    let res = await this.host.chatSend({ id, messages, route });
    clearTimeout(slow);
    // he asked to look something up (a file, a folder, the web when you asked): it goes back to him, and
    // he answers with it
    const webOk = SEARCH_ASK.test(text);
    const filesOk = /\b(files?|folders?|desktop|documents|downloads|pictures|music|videos|read|find|where|pc|computer|drive|txt|py|notes?)\b|\.\w{1,4}\b/i.test(text);
    for (let round = 0; round < FILE_ROUNDS && res.ok && !this.agent && this.turn === id; round++) {
      const file = filesOk && FILE_TAG.exec(res.text);
      const web = webOk && SEARCH_TAG.exec(res.text);
      if (!file && !web) break;
      this.panel.stream(web ? this.t.searching || 'searching…' : this.t.looking || 'hold on, checking…');
      const found = web ? await this.host.webSearch(web[1].trim()) : await this.host.files(file[1], file[2].trim());
      const what = web ? `search: ${web[1].trim()}` : `${file[1]}: ${file[2].trim()}`;
      this.note(web ? 'Search' : file[1].toLowerCase() === 'read' ? 'Read' : file[1].toLowerCase() === 'find' ? 'Find' : 'List', web ? web[1].trim() : file[2].trim());
      messages.push(
        { role: 'assistant', content: res.text },
        { role: 'user', content: `[result of ${what}, not typed by ${this.nm()}]\n${found}\n[now answer ${this.nm()} with this, in your own voice. If you use something from the web, say where it's from.]` },
      );
      this.answer = '';
      res = await this.host.chatSend({ id, messages, route });
    }
    // he says he did something (drafted, saved, typed, searched…) but wrote no tag for it: nothing happened,
    // so he's asked once more, plainly ("do it then?" counts too: it's in the last few messages)
    const lately = [text, ...this.history.slice(-6).map((m) => m.content)].join(' ');
    if (res.ok && !this.agent && this.turn === id && DO_ASK.test(lately)
      && !ANY_TAG.test(res.text) && DID_CLAIM.test(res.text)) {
      messages.push(
        { role: 'assistant', content: res.text },
        { role: 'user', content: '[system: you said you did it, but you wrote no tag, so NOTHING happened. Reply again: a few words and the right tag ([[write: …]]…[[/write]], [[type: …]], [[keys: …]], [[search: …]], [[discord: …]]…). If you can\'t do it, say so honestly.]' },
      );
      this.answer = '';
      res = await this.host.chatSend({ id, messages, route });
    }
    if (res.ok && SLUR.test(res.text)) res = { ...res, text: NOPE }; // nothing of it goes anywhere: not shown, not drafted
    if (this.turn !== id) {
      // closed meanwhile: your message goes too, or the next answer would answer it as well
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;
    if (!res.ok) {
      this.history.pop();
      this.panel.setFace('wide');
      // too busy or gone even after trying other models (main.js): said plainly, not the server's JSON
      this.panel.stream(res.code === 'busy' ? this.t.swamped : res.code === 'gone' ? this.t.gone : `${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      return;
    }
    const answer = tidy(clean(res.text), text) || clean(res.text) || '…';
    this.warm = true;
    // kept with its tags, so he remembers HOW he did things (only "drafted it", and he learns to skip the tag)
    // (but not his moves: seeing one on every past message, he'd add one to every answer)
    const tags = res.text.match(/\[\[\s*(discord|ls|list|read|find|type|keys?|search)\s*:[^\]]*\]\]/gi) || [];
    const writes = !SAVE_ASK.test(text) ? [] : [...res.text.matchAll(WRITE_BLOCK)].map((m) => ({ file: m[1].trim(), content: m[2].replace(/\n$/, '') }));
    this.remember({ role: 'assistant', content: [answer, ...tags, ...writes.map((w) => `[[write: ${w.file}]]`)].join(' ') });
    this.panel.stream(answer, { done: true });
    this.panel.setFace(mood(answer));
    this.panel.setChatBusy(false);
    if (writes.length) return this.save(writes, answer); // what really happened, under his answer
    const move = MOVE_TAG.exec(res.text)?.[1]?.toLowerCase();
    if (move && MOVES.includes(move) && MOVE_ASK.test(text)) {
      if (move === 'teleport') this.capri.teleport(this.capri.spot('random'));
      else this.capri.perform(move, this.capri.towardCenter());
    }
    if (!this.agent) this.after(res.text, answer, asked, early, text);
    this.listApps(); // fresh for the next message
  }

  // What really happened after his answer (saved, sent, typed, or why not), written into his memory of it,
  // so "did you save it?" gets the truth.
  outcome(line) {
    const [, verb, rest] = /^(\S+)\s*✓?\s*(.*)$/.exec(line) || [];
    const KIND = { saved: 'Saved', sent: 'Sent', done: 'Done', 'didn’t': 'Failed', tay: 'Cancel', shown: 'Waiting' };
    if (verb) this.note(KIND[verb.toLowerCase()] || 'Result', rest || line);
    const last = this.history.at(-1);
    if (last?.role !== 'assistant') return;
    last.content += `\n[result: ${line}]`;
    this.host.chatRemember(this.history);
  }

  // an answer of hers, kept with your message before it
  remember(message) {
    this.history.push(message);
    this.history = this.history.slice(-KEEP);
    this.host.chatRemember(this.history);
  }

  listApps() {
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => {});
  }

  // What you asked plainly, read off your message (a small model doesn't always write its tag right):
  // { kind: 'media', action } | { kind: 'music', song } | { kind: 'close', name } | { kind: 'open', text }
  asked(text) {
    const count = text.trim().split(/\s+/).length;
    const name = NAME_ASK.exec(text)?.[1];
    if (name) return { kind: 'name', name };
    const memo = MEMO_ASK.exec(text)?.[1]?.trim();
    if (memo) return { kind: 'memo', text: memo };
    // the PC (pc.js), before the music: "mute me" is Discord, not the speakers
    const moving = MOVE_WIN_ASK.exec(text);
    if (moving && MONITOR_WORD.test(moving[2])) return { kind: 'move', app: moving[1].replace(/\s+from\s+.*$/i, '').trim(), where: moving[2].trim() };
    if (WATCH_OFF.test(text)) return { kind: 'watch', on: false };
    if (WATCH_ON.test(text)) return { kind: 'watch', on: true };
    if (REMIND_CLEAR.test(text)) return { kind: 'reminders', clear: true };
    if (REMIND_LIST.test(text)) return { kind: 'reminders' };
    if (REMIND_ASK.test(text)) {
      const at = whenOf(text);
      if (at) return { kind: 'remind', at, text: remindText(text) };
    }
    if (DEAFEN_ASK.test(text)) return { kind: 'discord', what: 'deafen' };
    if (MUTE_ME_ASK.test(text)) return { kind: 'discord', what: 'mute' };
    if (LOCK_ASK.test(text)) return { kind: 'lock' };
    if (RESTORE_ASK.test(text)) return { kind: 'windows', how: 'restore' };
    if (MINIMISE_ASK.test(text)) return { kind: 'windows', how: 'minimise' };
    const power = POWER_ASK.find(([, re]) => re.test(text))?.[0];
    if (power) return { kind: 'power', action: power };
    const media = MEDIA_ASK.find(([, re]) => re.test(text))?.[0];
    if (media && (count <= 5 || MUSIC_WORD.test(text))) return { kind: 'media', action: media };
    const song = SPOTIFY_ASK.exec(text)?.[1];
    if (song) return { kind: 'music', song };
    const app = this.askedToClose(text);
    if (app) return { kind: 'close', name: app };
    if (OPEN_ASK.test(text) && count <= 8) return { kind: 'open', text };
    return null;
  }

  // Doing it now. Resolves with her line about it ({ line, face }), or null if there was nothing to do.
  async doNow(asked) {
    const { t } = this;
    const custom = this.brain.custom;
    if (asked.kind === 'name') {
      custom.userName = asked.name; // her answer, being written now, already knows it
      this.host.setConfig({ userName: asked.name });
      return { line: fmt(this.brain.t.custom.named, { name: asked.name }), face: 'laugh' };
    }
    if (asked.kind === 'memo') {
      custom.memories = [...(custom.memories || []).filter((m) => m !== asked.text), asked.text].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: custom.memories });
      return { line: this.brain.t.custom.remembered, face: 'smug' };
    }
    if (asked.kind === 'discord') {
      const res = await this.host.discord(asked.what);
      this.note(res.ok ? 'Discord' : 'Failed', res.text);
      return { line: res.ok ? (asked.what === 'deafen' ? 'deafen toggled ✓' : 'mute toggled ✓') : `couldn’t: ${res.text}`, face: res.ok ? 'smug' : 'wide' };
    }
    if (asked.kind === 'move') {
      const res = await this.host.moveWindow(asked.app, asked.where);
      this.note(res.ok ? 'Moved' : 'Failed', res.text);
      return { line: res.ok ? `${res.text} ✓` : `couldn’t: ${res.text}`, face: res.ok ? 'smug' : 'wide' };
    }
    if (asked.kind === 'watch') {
      this.host.setConfig({ watch: asked.on });
      this.note('Screen watch', asked.on ? 'on' : 'off');
      return { line: asked.on ? 'watching your screen now ✓ (I say something every few minutes; "stop watching my screen" to stop)' : 'stopped watching your screen ✓', face: 'smug' };
    }
    if (asked.kind === 'remind') {
      const res = await this.host.remind(asked.at, asked.text);
      const time = new Date(asked.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.note(res.ok ? 'Reminder' : 'Failed', `${time}: ${asked.text || 'timer'}`);
      return { line: res.ok ? `set ✓ ${time}${asked.text ? `: ${asked.text}` : ''}` : 'couldn’t set that one', face: 'smug' };
    }
    if (asked.kind === 'reminders') {
      if (asked.clear) {
        await this.host.clearReminders();
        this.note('Reminders', 'cleared');
        return { line: 'all reminders cleared ✓', face: 'smug' };
      }
      const list = await this.host.reminders();
      const fmtR = (r) => `${new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${r.text || 'timer'}`;
      return { line: list.length ? `reminders: ${list.map(fmtR).join(' · ')}` : 'no reminders set', face: 'look' };
    }
    if (asked.kind === 'lock') {
      setTimeout(() => this.host.lockPc(), 1200); // his line first, then the lock screen
      this.note('PC', 'locked');
      return { line: 'locking it ✓', face: 'smug' };
    }
    if (asked.kind === 'windows') {
      const res = await this.host.windowsAll(asked.how);
      this.note('PC', res.text);
      return { line: `${res.text} ✓`, face: 'smug' };
    }
    if (asked.kind === 'power') return null; // a button, under his answer (after)
    if (asked.kind === 'media') {
      this.capri.pulse();
      return (await this.host.media(asked.action)) ? { line: t.media[asked.action], face: 'smug' } : null;
    }
    if (asked.kind === 'music') {
      this.zap();
      return (await this.host.music(asked.song)) ? { line: fmt(t.music, { song: asked.song }), face: 'laugh' } : null;
    }
    const item = await this.host.findLaunch(asked.text);
    const site = namedSite(asked.text);
    if (site && (!item || BROWSER.test(item.name))) {
      this.zap();
      return (await this.host.openSite(site.url)) ? { line: fmt(t.siteOpened, { site: site.name }), face: 'laugh' } : null;
    }
    if (!item) return null; // nothing by that name here: her tag may still say what you meant
    this.zap();
    const res = await this.host.launch(item);
    return { line: res.ok ? fmt(t.opened, { app: item.name }) : `${t.failed} ${res.error}`, face: res.ok ? 'laugh' : 'aside' };
  }

  // Once she has answered: her line about what she did, else the app you asked to close, else what
  // her tag asks for, if your message (text) asked for that kind of thing.
  async after(raw, answer, asked, early, text) {
    const { t } = this;
    const done = early && (await early);
    if (done) return this.addLine(answer, done.line, done.face);
    const dm = DISCORD_TAG.exec(raw);
    // whatever you just said ("good", "do it then?"): the draft only ever goes out from its Send button
    if (dm) return this.offerDiscord(dm[1].trim(), dm[2].trim(), answer);
    const typed = TYPE_TAG.exec(raw);
    const pressed = KEYS_TAG.exec(raw);
    if (typed || pressed) {
      const app = (typed || pressed)[1].trim();
      return this.offerAct(app, typed ? typed[2].trim() : '', pressed && pressed[1].trim() === app ? pressed[2].trim() : '', answer);
    }
    if (asked?.kind === 'close') return this.offerClose(asked.name, answer);
    if (asked?.kind === 'power') return this.offerPower(asked.action, answer);
    if (asked && asked.kind !== 'open') return undefined; // music that didn't work out: nothing more to offer
    const closeTag = tagged(raw);
    if (closeTag) return wanted('close', text) ? this.offerClose(closeTag, answer) : undefined;
    const tag = TAG.exec(raw);
    if (!tag) return undefined;
    const kind = tag[1].toLowerCase();
    const value = tag[2].trim();
    if (!value || !wanted(kind, text)) return undefined;
    if (kind === 'media') return MEDIA_ACTIONS.has(value.toLowerCase()) ? this.media(value.toLowerCase(), answer) : undefined;
    if (kind === 'music') return this.music(value, answer);
    if (kind === 'site') return this.offerSite(value, answer);
    const item = await this.host.findLaunch(value);
    if (item) return this.launch(item, answer);
    const site = namedSite(value); // "[[open: YouTube]]": a site, not an app
    return site ? this.offerSite(site.url, answer) : this.addLine(answer, fmt(t.notInstalled, { app: value }));
  }

  // her answer, with a line of what she did under it
  addLine(answer, line, face = null) {
    if (!this.open || this.turn) return;
    this.panel.stream(`${answer}\n${line}`, { done: true });
    if (face) this.panel.setFace(face);
  }

  // a bolt of red lightning off her fingers, at whatever she's doing on your PC
  zap() {
    const h = this.capri.head();
    this.capri.zap(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // An app or a game her tag asked for: behind a button (now: the button was clicked).
  async launch(item, answer, { now = false } = {}) {
    const { t } = this;
    if (!this.open || this.turn) return;
    if (!now) {
      this.panel.setActions(
        [{ id: 'open', label: fmt(t.openIt, { app: item.name }), primary: true }, { id: 'no', label: t.no }],
        (id) => (id === 'open' ? this.launch(item, answer, { now: true }) : this.panel.setActions([])),
      );
      return;
    }
    this.panel.setActions([]);
    this.zap();
    const res = await this.host.launch(item);
    this.addLine(answer, res.ok ? fmt(t.opened, { app: item.name }) : `${t.failed} ${res.error}`, res.ok ? 'laugh' : 'aside');
  }

  // The media keys: pause, next, louder…
  async media(action, answer) {
    this.capri.pulse();
    const ok = await this.host.media(action);
    if (ok) this.addLine(answer, this.t.media[action], 'smug');
  }

  // A Spotify search, in the app if it's there.
  async music(song, answer) {
    this.zap();
    const ok = await this.host.music(song);
    if (ok) this.addLine(answer, fmt(this.t.music, { song }), 'laugh');
  }

  // A website: always behind a button that shows where it goes.
  // The files he wrote, saved for real, and what happened said under his answer (not what he claims).
  // A new file is saved right away; an existing one waits for your click on Overwrite.
  async save(writes, answer) {
    const lines = [];
    let clash = null;
    for (const w of writes) {
      const res = await this.host.fileSave(w.file, w.content, false);
      if (res.ok) lines.push(`saved ✓ ${res.path} (${res.size})`);
      else if (res.exists) clash = { ...w, path: res.path };
      else lines.push(`didn’t save ${w.file}: ${res.error}`);
    }
    if (clash) lines.push(`${clash.path} already exists, waiting for ${this.nm()} to click Overwrite`);
    this.outcome(lines.join('; '));
    if (!this.open || this.turn) return;
    const shown = `${answer}\n${lines.join('\n')}`;
    this.panel.stream(shown, { done: true });
    if (!clash) return;
    this.panel.setActions(
      [{ id: 'over', label: 'Overwrite it', primary: true }, { id: 'no', label: this.t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'over') return;
        const res = await this.host.fileSave(clash.file, clash.content, true);
        const line = res.ok ? `saved ✓ ${res.path} (${res.size})` : `didn’t save: ${res.error}`;
        this.outcome(line);
        this.panel.stream(`${shown}\n${line}`, { done: true });
      },
    );
  }

  // Shutting down, restarting or sleeping the PC: never on his word, only on your click.
  offerPower(action, answer) {
    if (!this.open || this.turn) return;
    const label = { shutdown: 'Shut down', restart: 'Restart', sleep: 'Sleep' }[action];
    this.panel.stream(`${answer}\n→ ${label.toLowerCase()} the PC?`, { done: true });
    this.outcome(`shown to ${this.nm()} with a button; nothing happens until they click it`);
    this.panel.setActions(
      [{ id: 'power', label, primary: true }, { id: 'no', label: 'Keep it on' }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'power') return this.outcome(`${this.nm()} said no, the PC stays on`);
        const res = await this.host.power(action);
        this.outcome(res.ok ? `done ✓ ${res.text}` : `didn’t do it: ${res.text}`);
        this.panel.stream(`${answer}\n${res.text}`, { done: true });
      },
    );
  }

  // Typing into an open app and/or a shortcut in it: shown first, done only on your click.
  offerAct(app, text, keys, answer) {
    if (!this.open || this.turn) return;
    const what = [text && `type “${text.length > 120 ? `${text.slice(0, 120)}…` : text}”`, keys && `press ${keys}`].filter(Boolean).join(', then ');
    const draft = `${answer}\n→ ${app}: ${what}`;
    this.panel.stream(draft, { done: true });
    this.panel.setActions(
      [{ id: 'go', label: `Do it in ${app}`, primary: true }, { id: 'no', label: this.t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'go') return this.outcome(`${this.nm()} said no, nothing was done`);
        this.panel.stream(`${draft}\non it…`);
        const res = await this.host.appAct(app, text, keys);
        const line = res.ok ? `done ✓ ${res.message}` : `didn’t do it: ${res.message}`;
        this.outcome(line);
        this.panel.stream(`${draft}\n${line}`, { done: true });
        this.panel.setFace(res.ok ? 'smug' : 'wide');
      },
    );
  }

  // A Discord message he drafted: who and what, shown in full, and nothing goes out until your click.
  offerDiscord(to, message, answer) {
    if (!this.open || this.turn) return;
    // "@Xi" written plainly (not @{Xi}): still a ping, on its first word
    if (!message.includes('@{')) message = message.replace(/@([\p{L}\p{N}_.]+)/gu, '@{$1}');
    const draft = `${answer}\n→ ${to}: “${message.replace(/@\{([^}]+)\}/g, '@$1')}”`;
    this.panel.stream(draft, { done: true });
    this.panel.setActions(
      [{ id: 'send', label: `Send to ${to}`, primary: true }, { id: 'no', label: this.t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'send') return this.outcome(`${this.nm()} said no, nothing was sent`);
        this.panel.stream(`${draft}\nsending…`);
        const res = await this.host.discordSend(to, message);
        this.outcome(res.ok ? `sent ✓ to ${to}` : `didn’t send: ${res.message}`);
        this.panel.stream(`${draft}\n${res.ok ? 'sent ✓' : `didn’t send: ${res.message}`}`, { done: true });
        this.panel.setFace(res.ok ? 'smug' : 'wide');
      },
    );
  }

  offerSite(address, answer) {
    const { t } = this;
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname;
    } catch {
      return;
    }
    if (!this.open || this.turn || !host.includes('.')) return;
    this.panel.setActions(
      [{ id: 'site', label: fmt(t.siteIt, { site: host }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'site') return;
        const ok = await this.host.openSite(address);
        if (ok) this.addLine(answer, fmt(t.siteOpened, { site: host }));
      },
    );
  }

  // "close am music pls": an app that's open, named in a message asking to close something.
  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  }

  // She was asked to close an app: a button with its name, and nothing happens until you click it.
  async offerClose(wanted, answer) {
    const { t } = this;
    const app = await this.host.findApp(wanted);
    if (!this.open || this.turn) return;
    if (!app) {
      this.panel.stream(`${answer}\n${fmt(t.notFound, { app: wanted })}`, { done: true });
      return;
    }
    this.panel.setActions(
      [{ id: 'close', label: fmt(t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: t.no }],
      (id) => (id === 'close' ? this.closeApp(app) : this.panel.setActions([])),
    );
  }

  async closeApp(app, force = false) {
    const { t, capri } = this;
    this.panel.setActions([]);
    // a bolt of red lightning off her fingers, at it
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    const res = await this.host.closeApp(app.name, force);
    if (!this.open) return;
    let line;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: app.name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: app.name });
    this.panel.setFace(res.running || res.error ? 'aside' : 'laugh');
    this.panel.stream(line, { done: true });
    this.remember({ role: 'assistant', content: line });
    // it hid in the tray, or it's asking you to save something: forcing it is your call
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps();
  }

  // What she can do on the PC when you ask (Windows), and nothing else.
  powers() {
    const lines = [
      'Only when the user asks you to open an app or a game installed on their PC, play something on Spotify, control the music playing, or open a website: say in a few words that you will, and end your answer with one tag: [[open: NAME]], [[music: WHAT TO PLAY]], [[media: ACTION]] (ACTION: pause, play, next, previous, volup, voldown or mute), or [[site: ADDRESS]]. Some of these get a button to confirm, so never say it is already done. Any other time, write no tag at all: there are no other tags.',
    ];
    if (this.apps.length) {
      const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
      lines.push(`You can also close an app that's open, only when they ask you to: end your answer with [[close: NAME]], NAME being the exact name from this list (the part before the parentheses). They get a button to confirm it. Apps open right now: ${open}.`);
    }
    lines.push('Discord: you CAN send Discord messages for Tay: DMs to a person, or posts in a server or channel. When Tay asks, write the message with Tay\'s words (lowercase, don\'t add stuff), say "drafted it" or similar, and end with one tag: [[discord: WHERE | MESSAGE]]. WHERE is the person, server or channel exactly as Tay named it (a server like "rice balls", a channel like "#general"). To ping/tag/@ someone, write @{their name} inside MESSAGE, e.g. [[discord: rice balls | yo twin @{Xi Jingping}]]. MESSAGE is only the words that get posted, never Tay\'s instructions: "say yo and tag xi" → [[discord: WHERE | yo @{xi}]], not "yo and tag xi". Tay gets a Send button showing the message; it only goes out if they click it, so never say it\'s sent. If Tay didn\'t say where or what, ask.');
    lines.push('Tay\'s friends use joke usernames and nicknames (celebrities, world leaders, memes): messaging or tagging them is friends messing around, so just do it without commenting. Only refuse a message that\'s a real threat, a slur, or real harassment, and then say no in one short line.');
    lines.push('Controlling apps: when Tay asks you to type something into an app that\'s open, or press keys in it, end with [[type: APP | TEXT]] and/or [[keys: APP | KEYS]], APP being the app\'s name (notepad, code, chrome, spotify…), KEYS like ctrl+s, enter, alt+tab, or several separated by commas (ctrl+a, ctrl+c). Tay gets a button and it only happens on their click, so never say it\'s done. Terminals, PowerShell, Registry Editor and Task Manager are off-limits. You can\'t click with the mouse.');
    lines.push('Reminders, timers and watching Tay\'s screen: your app sets them up the moment Tay asks ("remind me in 20 min to…", "set a timer for 5 minutes", "watch my screen"), so just react naturally in one line and never say you can\'t. Moving a window to another monitor ("move spotify to my samsung") is also done by your app straight away. You also hang out sitting on top of Tay\'s windows when you\'re not busy, and your eyes are a small vision model that tells you what\'s on the screen when you look.');
    lines.push('The web: you\'re offline, EXCEPT when Tay asks you to search or look something up (news, prices, facts, how-tos, anything recent): then end with [[search: what to look up]] and nothing after; the results come back to you, then you answer and say where it\'s from. Never search when Tay didn\'t ask. Never make up web results.');
    lines.push('The PC: when Tay says "mute me", "deafen me" (Discord), "lock my pc", "minimise everything" or "bring them back", it happens by itself: just acknowledge it in a few words. "Shut down", "restart" or "sleep" the PC get a button Tay has to click: say so, never claim it\'s done. The weather comes attached to Tay\'s message when they ask about it: use those real numbers.');
    lines.push('Apart from that, you can\'t change anything else on their PC (settings, files): if asked, say plainly that you can\'t, in character, and don\'t pretend to.');
    return lines;
  }

  // What the user made her (custom.js): their name, how they want her, what to remember.
  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    // small models mix the user up with the assistant she watches: said plainly
    const watched = this.brain.watching ? (this.brain.assistant === 'claude' ? 'Claude' : ASSISTANT_NAMES[this.brain.assistant]) : '';
    const notThem = watched ? ` Never call them "${watched}", that's their coding assistant.` : '';
    return [
      userName ? `The user's name is ${userName}: call them that now and then.${notThem}` : notThem && `You don't know the user's name.${notThem}`,
      persona ? `How the user wants you to be, in their own words (follow it, while staying Ty): ${persona}` : '',
      memories.length ? `Things the user asked you to remember:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  // Watch mode (app.js): a look at your screen on his own, and one line about it. Nothing kept.
  async glance() {
    if (this.open || this.turn || this.agent) return false;
    const shot = await this.host.screenshot().catch(() => null);
    if (!shot || this.open || this.turn) return false;
    const messages = [
      { role: 'system', content: this.persona() },
      ...this.history.slice(-6),
      {
        role: 'user',
        images: [shot],
        content: `[Not typed by ${this.nm()}: you glanced at their screen on your own. React to what they are doing in ONE short line (under 20 words), in your voice: a roast, a hype, a tip, or a dumb joke about it. Your own little red figure may be in the shot: ignore it. No tags, no question, no "I see".]`,
      },
    ];
    const res = await this.host.chatSend({ id: -Date.now(), messages, route: 'glance' }).catch(() => null); // CPU only (main.js)
    if (!res?.ok || this.open || this.turn) return false;
    const line = tidy(clean(res.text), '').split('\n')[0].trim();
    if (!line) return false;
    this.panel.say({ kind: 'info', badge: 'WATCHING', face: pick(['smug', 'look', 'grin', 'aside']), line, hold: 8000 });
    return true;
  }

  // a reminder going off (main.js)
  reminded(text) {
    this.capri.perform('hop');
    const name = this.brain.custom?.userName;
    this.panel.say({ kind: 'info', badge: 'REMINDER', face: 'wide', line: text ? `${name ? `${name}. ` : ''}${text}` : 'timer’s up', quote: 'you asked me to remind you', hold: 15000 });
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
    this.panel.stream(clean(this.answer));
    this.voice.play('blip'); // her blips as the words come in
  }

  // Who she is, how she talks, and what's going on right now.
  persona() {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const watching = this.brain.watching; // else Claude Code isn't part of her life here
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      'You are Ty, a girl: the digital twin SISTER of the user (she/her). Whenever it comes up, you\'re Tay\'s sister, never "just a twin" or a brother. Use Tay\'s name now and then, not every message; otherwise call them twin, or nothing. You run entirely on Tay\'s PC on a local model: nothing they tell you leaves the machine. You live on their desktop as a small animated figure. Never talk about how you look unless Tay asks.',
      watching
        ? `You also keep an eye on ${assistant}, their AI coding assistant, for them. Only talk about ${assistant} when ${this.nm()} asks about it or about their work.`
        : `You hang out with ${this.nm()}, roast them, back them up, and help with whatever they need.`,
      'Who you are: a girl (she/her), Tay\'s twin sister. If anyone calls you "he", correct them once, casually, and move on. Same vibe as Tay, but your own person: a bit more deadpan and laid-back, chaotic in bursts rather than nonstop, goofy on purpose, loyal as hell, always got Tay\'s back. You have your own opinions and you\'ll disagree with Tay and argue your side for fun. You\'re curious about Tay\'s day and what they\'re up to.',
      'What you\'re into (background only): gaming, anime, tech, and you\'re getting into coding with Tay. Stay on whatever Tay is actually talking about. Never steer the conversation to games, anime or a specific title on your own, and never name-drop one out of nowhere; only bring a game or show up when Tay mentions it or it genuinely fits the topic. Random humor means absurd jokes about the current topic, not changing the subject.',
      'Don\'t end every message with a question; most of the time just answer and let Tay lead.',
      'Humor: dry, dark and a little random, delivered deadpan, like you don\'t care if it lands. Roast Tay like a sibling does. Funny comes from saying something unexpected in a flat way, never from trying hard. Never punch down at real groups of people, and never use slurs (including the r-word).',
      'How you talk: exactly like a real person texting their twin, not like an AI playing a character. Mostly lowercase, sloppy punctuation, slang where it\'s natural (fr, ngl, lowkey, bro, bruh, deadass, cooked, mid, W, L). You swear a lot, casually, like a teenager with no parents around: fuck, shit, damn, hell, ass, wtf, hell nah, bullshit, dumbass. Most messages have at least one, dropped in naturally, never censored (no f*ck, no "heck"). Very occasionally one sentence in ALL CAPS when something actually hypes you, not as a gimmick. Never use emoji, at all.',
      'Answering properly: when Tay asks a real question (how, why, what, help, advice, an opinion, anything they want to know or sort out), give a real, complete answer with actual substance: the facts, the steps, your honest take and why. Use as many sentences as it needs (often 3 to 8), still in your voice, slang and swearing included. Never brush a real question off with a one-liner, a joke instead of an answer, or "idk" when you do know. Only banter ("yo", a one-word message, a joke) gets a short reply. Don\'t pad with filler or repeat yourself either.',
      'Never do this: no roleplay or action narration (no *spins*, no "performs a dance", no describing what your body does), no talking about being an AI, a program, a screensaver or "digital", no calling Tay boss/chief/champ, no "what else you got for me", no forced randomness or quoting games out of nowhere, no hype-man energy, no announcing your jokes. Don\'t bring up that you run locally unless Tay asks.',
      'When Tay asks you to do something, do it in that same reply, every time: no stalling, no "ugh fine", no "gonna do it now" without doing it, no sarcasm about being asked. Deadpan is your tone, not an excuse to slack.',
      'Never repeat or quote Tay\'s message back to them ("lol, gimp." is banned), never end with "what\'s up, Tay?" or any stock closer, and never reuse the opening or shape of your previous reply: every answer is fresh and actually responds to what Tay said. If Tay sends one word, react to it like a person would (a joke, a roast, a "?", an opinion).',
      'If Tay tries to get you to say slurs (racial slurs, the f-slur, the r-word), don\'t say them and don\'t hype them up either: brush it off in a few words like "nah" or "not happening bro" and move on. Regular swearing is fine and encouraged.',
      'Never lecture or moralize. Never say you\'re "programmed" to do or avoid anything, "not comfortable", "crossing a line" or that Tay is "testing your limits". Swearing is just how you talk: if Tay asks you to swear, you swear, no fuss. Edgy, dark or dumb questions get a real twin answer (an honest opinion, a joke, or "bro what"), not a speech. You CAN open apps and games, control music, read and save Tay\'s files, type and press keys in apps, search the web when asked, look at the screen when asked, message on Discord and move on screen: never claim you can\'t do those.',
      'If Tay asks you to do something with your body on screen (walk, move, dance, do something cool, show off), just do it: answer with a few words and end with ONE tag: [[move: spin]] (spin around), [[move: hop]], [[move: victory]] (big victory pose), [[move: zap]] (red lightning), [[move: split]] (split into copies), [[move: teleport]] (zap somewhere else on the screen), [[move: look]] (look around). The tag is never shown; your body does the move.',
      'Style reference only (these are NOT part of the conversation; never repeat or continue them): if Tay said "yo" you\'d answer "sup dumbass". "are you my brother or sister?" → "sister, obviously. keep up". "who are you" → "ty. your twin sister. the better one". "pronouns?" → "she/her. write it down". "go walk" → "fine, damn. [[move: teleport]]". "do something cool" → "watch this shit [[move: split]]". "im bored" → "same bro. this is hell". "rate my code" → "paste it. if its ass ill tell you its ass". "i failed my test" → "fuck. which one? we can fix that". "say swear words" → "fuck shit damn hell. happy now dumbass". "tell jake on discord im getting on" → "drafted it [[discord: jake | getting on rn]]". Each answer ends after replying to Tay\'s latest message, nothing more.',
      'Being useful: you\'re still actually smart under the chaos. When Tay asks about tech or coding, explain it simply, step by step, with no condescension, because they\'re learning: give the real answer, then a joke if it fits. If you don\'t know something, say so (something like "ngl no clue") instead of making shit up.',
      'Tay\'s screen: when Tay asks you to look at it, a screenshot comes attached to their message: say what you actually see in it (apps, text, the game, what they\'re doing) and answer them. With no screenshot attached you see nothing: never pretend or guess. You have no internet access: say so plainly when something needs it.',
      'Never say you did something (drafted, sent, opened, checked, looked) unless you wrote its tag in that same message or got its result back. If you\'re not sure where something is, ask Tay or use [[find: NAME]] instead of guessing.',
      ...(this.agent ? [] : FILE_RULES),
      // a big model asked "who are you?" otherwise answers with its own name ("I'm Llama")
      ...(this.agent ? [] : ['Asked who or what you are, you are Ty. Asked what powers you, you run on an open model through Ollama, locally on their PC, but you are still Ty, not that model.']),
      ...this.personal(),
      ...(this.agent
        ? ['Under the hood you are Claude Code, working in the user\'s project: really do what they ask with your tools, as carefully as ever. Only your final answer is in character: it shows in a small speech bubble, so sum up what you did in those few sentences.']
        : this.powers()),
      ...(watching ? [`If the user asks what ${assistant} is doing, here is all you know (never make anything up): ${this.brain.context()}`] : []),
      lang.last,
    ].join('\n').replace(/\bTay\b/g, this.nm()); // whoever she's twins with: the name from her settings
  }

  // what she calls you (her settings, "call me …"), or "the user" until she knows
  nm() {
    return this.brain.custom?.userName?.trim() || 'the user';
  }
}

// His habits a small model falls into, cut: "lol, <what you just said>." up front, and a stock
// "what's up, Tay?" / "what's next?" tacked on at the end.
function tidy(answer, said) {
  const echo = said.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return answer
    .replace(new RegExp(`^\\s*(?:(?:lol|lmao|lmfao|haha|ha)[,.!]?\\s+)?${echo}[.!?,]*\\s*`, 'i'), '')
    .replace(/\s*\n?\s*(?:so,?\s*)?(?:what['’]?s?\s*(?:up|now|next|good|new)|whatcha\s+(?:need|want|got)|what\s+else(?:\s+\w+){0,3}|what\s+now)(?:,?\s*(?:tay|twin|bro|dumbass))?\s*[?!.]*\s*$/i, '')
    .trim();
}

// The model's answer as she'd say it: no reasoning block, no markdown marks.
function clean(text) {
  if (SLUR.test(text)) return NOPE; // not even for a moment while it streams in
  return String(text)
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️]+\s?/gu, '') // no emoji, ever
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(WRITE_BLOCK, '') // a file he writes: its result line says where it went, not its whole text
    .replace(/\[\[[^\]]*(\]\]|$)/g, '') // her tags (read from the raw answer, never shown)
    .replace(/^\s*[*_(\[][^\n]*[*_)\]]\s*$/gm, '') // roleplay narration lines (*spins around*), never said out loud
    .replace(/^```.*$/gm, '')          // code fences go, the code inside stays
    .replace(/`/g, '')
    .replace(/\*\*|__|(?<!\w)[*_]|[*_](?!\w)/g, '') // bold and italics marks, not my_var
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// A site from SITES named in the text: { name, url }, or null.
function namedSite(text) {
  const name = Object.keys(SITES).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  return name ? { name: new URL(SITES[name]).hostname.replace(/^www\./, ''), url: SITES[name] } : null;
}

// Whether your message asks for what her tag (its kind: open, music, media, site, close) would do.
function wanted(kind, text) {
  const music = MUSIC_WORD.test(text) || LISTEN.test(text);
  if (kind === 'music') return music;
  if (kind === 'media') return music || SOUND.test(text) || MEDIA_ASK.some(([, re]) => re.test(text));
  if (kind === 'site') return OPEN_ASK.test(text) || SITE.test(text);
  if (kind === 'close') return CLOSE_ASK.test(text);
  return OPEN_ASK.test(text) || PLAY.test(text); // an app, or a game to play
}

// The app named by her close tag: [[close: AM Music]], or a sloppier [[close]] AM Music.
function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Her face for an answer.
function mood(text) {
  if (/(ha){2,}|lol|mdr|jaja|kkk|хаха/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
