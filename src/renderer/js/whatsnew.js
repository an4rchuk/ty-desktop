// What's new in Ty: after an update he shows each new thing once, on his own, one after another
// (app.js), and again from "What's new" in his menu. Bump VERSION with each batch.

export const VERSION = '0.7.1';

// { line, quote, face, demo }: demo(ctx) shows it off ({ capri, panel, host, chat })
export const NEWS = [
  {
    line: "oh and it’s she/her now. your twin sister",
    quote: "Same Ty, same attitude, new pronouns. Everything else below.",
    face: "smug",
    demo: ({ capri }) => capri.perform("spin", capri.towardCenter()),
  },
  {
    line: 'new colours. red and electric cyan',
    quote: 'The grey’s gone: cyan is red’s opposite, like Capri’s pink and green. Faces, cut-ins and my icon too.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('victory', 0),
  },
  {
    line: 'i peek at your screen now and then and say something',
    quote: 'Random, about every 10 minutes. Done on your CPU with tiny models, so 0 VRAM and nothing stays loaded. “stop watching my screen” to stop, or Deck › PC & Chat.',
    face: 'smug',
    demo: ({ capri }) => capri.perform('look'),
  },
  {
    line: 'and i start with windows now',
    quote: 'Turn it off in Deck › PC & Chat › Start Ty with Windows. That’s it: right-click me › What’s new to see this again.',
    face: 'laugh',
    demo: ({ capri }) => capri.perform('hop'),
  },
];

// the batch before (0.6.0), kept for reference
export const OLDER_06 = [

  {
    line: 'update. jarvis mode loading',
    quote: 'Skip it anytime, or replay it from my menu › What’s new.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('hop'),
  },
  {
    line: 'game mode. i get out of your GPU when you’re gaming',
    quote: 'A game in front for a few seconds: my big brain unloads, a tiny 1.7B answers from the CPU (0 VRAM). Back to normal 40 s after you leave. Deck › PC & Chat, or my menu.',
    face: 'smug',
    demo: ({ capri }) => capri.perform('zap', capri.towardCenter()),
  },
  {
    line: 'mid-game commands skip the AI. instant',
    quote: '“open discord”, “mute me”, “skip song”, “timer for 10 min”… just happen, nothing to wait for.',
    face: 'grin',
  },
  {
    line: '"move spotify to my samsung". done',
    quote: '“put discord on monitor 2”, “chuck chrome on the other screen”. Monitor 1 is your Dell (main), 2 your Samsung. Same spot, same share of the screen.',
    face: 'laugh',
    demo: ({ capri }) => capri.teleport(capri.spot('random')),
  },
  {
    line: 'that’s it. right-click me › What’s new to see it again',
    quote: 'Older stuff: I sit on your windows, “watch my screen”, reminders and timers, Ctrl+Alt+T for my chat.',
    face: 'laugh',
    demo: ({ capri }) => capri.perform('victory', 0),
  },
];

// the batch before (0.5.0), kept for reference
export const OLDER_05 = [

  {
    line: 'update. new brain setup, new hangout spots',
    quote: 'Skip it anytime, or replay it from my menu › What’s new.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('hop'),
  },
  {
    line: 'i sit on your windows now when you’re not using me',
    quote: 'On top of whatever’s open, hopping between them and the taskbar. Change it in Deck › Character › When he rests.',
    face: 'smug',
    demo: ({ capri }) => capri.goHome(),
  },
  {
    line: 'gemma’s gone. qwen3 does all the talking',
    quote: 'Auto now uses Qwen3 8B for everything. When I look at your screen, a tiny 2B vision model (~2 GB) reads it first and I answer about it. Way lighter.',
    face: 'look',
  },
  {
    line: '"watch my screen" and i’ll chime in every few minutes',
    quote: 'One line about what you’re doing: a roast, a hype, a tip. Off by default, skips fullscreen games. “stop watching my screen” to stop, or Deck › PC & Chat.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('look'),
  },
  {
    line: 'reminders and timers. "remind me in 20 min to take the pizza out"',
    quote: '“set a timer for 5 minutes”, “remind me at 6pm to…”, “what are my reminders”, “cancel my reminders”. A Windows notification and me popping up.',
    face: 'smug',
    demo: ({ capri }) => capri.perform('zap', capri.towardCenter()),
  },
  {
    line: 'and ctrl+alt+t opens my chat window from anywhere',
    quote: 'That’s it. Right-click me › What’s new to see this again.',
    face: 'laugh',
    demo: ({ capri }) => capri.perform('victory', 0),
  },
];

// the batch before (0.4.0), kept for reference
export const OLDER_04 = [

  {
    line: 'yo. update time. new stuff, quick tour',
    quote: 'Skip it anytime, or replay it from my menu › What’s new.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('hop'),
  },
  {
    line: 'the deck. all my settings in one place',
    quote: 'Right-click me › Deck (settings)… Apps, Found on this PC, Character, Assistant, PC & Chat. Opening it now.',
    face: 'smug',
    demo: ({ host }) => host.openDeck(),
  },
  {
    line: 'your own app names. "open blocks strap" can mean bloxstrap',
    quote: 'Deck › Apps: name it, add what else you call it, point it at the program. There’s a “try a command” box that shows what I’d do.',
    face: 'look',
  },
  {
    line: 'weather. ask me and i check it for real',
    quote: '“what’s the weather”, “is it gonna rain tomorrow”. Set your home city in Deck › Assistant. Free, from Open-Meteo, only the city name is sent.',
    face: 'look',
  },
  {
    line: 'discord mute and deafen. "mute me", "deafen me"',
    quote: 'For it to work with Discord in the tray, set your own keybind in Deck › PC & Chat.',
    face: 'smug',
    demo: ({ capri }) => capri.perform('zap', capri.towardCenter()),
  },
  {
    line: 'pc stuff. lock it, minimise everything, bring it back',
    quote: '“lock my pc”, “minimise everything”, “bring them back” just happen. Shut down, restart and sleep always get a button first.',
    face: 'grin',
  },
  {
    line: 'and i say hi when you unlock or wake the pc',
    quote: 'Big, grabbing the screen, then back to my corner. Turn it off or preview it in Deck › PC & Chat.',
    face: 'laugh',
    demo: ({ capri }) => capri.perform('victory', 0),
  },
];

// the batch before (0.3.0), kept for reference
export const OLDER = [
  {
    line: 'yo. got some upgrades. lemme show you real quick',
    quote: 'This plays once after an update. Skip it anytime, or replay it from my menu › What’s new.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('hop'),
  },
  {
    line: 'new panel. TY // MESSAGE, the whole cyberdeck look',
    quote: 'Red frame, cyan brackets, scanlines, and a status badge in the corner.',
    face: 'smug',
  },
  {
    line: 'action log. you see what i actually did, not what i say i did',
    quote: 'Under my answer: Heard, Saved, Sent, Search, Failed… straight from your PC.',
    face: 'look',
    demo: ({ panel }) => panel.setActs([
      { k: 'Heard', v: '"save me a shopping list"' },
      { k: 'Saved', v: 'C:\\Users\\you\\Documents\\Ty\\shopping.txt' },
      { k: 'Search', v: 'latest minecraft update' },
    ]),
  },
  {
    line: 'chat window. for when you’d rather type in a proper window',
    quote: 'Right-click me › Chat window… Five skins: Holocall, Netrunner, Neon, Braindance, AN4RCH. Opening it now.',
    face: 'laugh',
    demo: ({ host }) => host.openChatWindow(),
  },
  {
    line: 'do something. tell me or pick it from my menu',
    quote: 'Right-click me › Do something: spin, hop, victory pose, lightning, split into copies, teleport.',
    face: 'grin',
    demo: ({ capri }) => capri.perform('spin', capri.towardCenter()),
  },
  {
    line: 'i save files, type into apps, and search the web when you ask',
    quote: '“save a note called todo.txt…”, “type hello into notepad”, “search the latest siege patch”. Buttons first, always.',
    face: 'smug',
    demo: ({ capri }) => capri.perform('zap', capri.towardCenter()),
  },
  {
    line: 'auto brain. i pick the right model for each message',
    quote: 'Qwen3 8B for banter and doing stuff, the 12B for coding, explaining and looking at your screen.',
    face: 'look',
  },
  {
    line: 'and no more emojis or lazy one-liners. ask me something real',
    quote: 'That’s it. Right-click me › What’s new to see this again.',
    face: 'laugh',
    demo: ({ capri }) => capri.perform('victory', 0),
  },
];

const STEP_MS = 6500;

// The tour: each item said, shown off, and on to the next by itself (or with Next / Skip).
export async function tour(ctx) {
  const { panel } = ctx;
  for (let i = 0; i < NEWS.length; i++) {
    const item = NEWS[i];
    const last = i === NEWS.length - 1;
    const answer = await new Promise((done) => {
      const timer = setTimeout(() => done('next'), STEP_MS);
      const shown = panel.say({
        kind: 'info',
        badge: `NEW ${i + 1}/${NEWS.length}`,
        face: item.face || 'look',
        guide: true,
        line: item.line,
        quote: item.quote,
        actions: last ? [{ id: 'done', label: 'Done', primary: true }] : [{ id: 'next', label: 'Next', primary: true }, { id: 'skip', label: 'Skip' }],
        onAction: (id) => {
          clearTimeout(timer);
          done(id);
        },
        hold: null,
      });
      if (!shown) {
        clearTimeout(timer);
        done('skip');
        return;
      }
      try {
        item.demo?.(ctx);
      } catch (err) {
        console.error('[ty] whats new demo', err);
      }
    });
    if (answer === 'skip') break;
  }
  panel.setActs([]);
  panel.hide();
}
