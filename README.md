# Ty

Your own AI twin sister. She lives on your desktop, runs **100% on your PC** (nothing you say leaves it),
swears like a sailor, roasts you, and actually does stuff when you ask.

Ty is a fork of [capri-desktop](https://github.com/mochiiwuff/capri-desktop) by mochiiwuff: same animated
body, recoloured red and electric cyan, with a new personality and a pile of new powers.

## What she does

- **Talks to you** like a sibling texting you: slang, swearing, dark humour, real answers to real questions.
  No emojis, no lectures, no slurs (hard-blocked).
- **Opens apps** ("open discord", "play lofi on spotify"), closes them, controls music.
- **Moves windows between monitors**: "move spotify to my samsung", "put discord on monitor 2".
- **Types into apps** and presses keys for you, after you click her button.
- **Discord**: drafts messages and @tags people, sends them when you click Send. "mute me", "deafen me".
- **Reads and saves files** in your user folders, never anything that could break Windows.
- **Looks at your screen** when you ask ("what am I looking at"), and now and then on her own to roast what
  you're doing (on your CPU, so no GPU cost; turn it off in her Deck).
- **Reminders and timers**: "remind me in 20 min to take the pizza out", "set a timer for 5 minutes".
- **Weather**, **web search** (only when you ask), **lock / minimise / shut down** (power always asks first).
- **Game mode**: when a game is in front she moves out of your GPU and answers from a tiny model on the CPU.
- **Hangs out on your windows** when you're not using her, and says hi when you unlock the PC.
- **The Deck**: her settings window (right-click her › Deck). Custom app names, skins, all the switches.
- **Ctrl+Alt+T** opens her chat window from anywhere.
- **Ty Live**: her chat as it happens plus a little live video of her, on your phone or any PC on your Wi-Fi
  (Deck › PC & Chat › Ty Live). Secret links only; people watching can chat with her but can't touch your PC.

## Mac and Linux

She runs on macOS and Linux too (`npm start`, same setup as below with Ollama from ollama.com).
Works there: her chat, her body on your desktop, screen looks, opening apps (Mac `/Applications`, Linux
app-menu entries, Steam games), music and volume (Mac: Spotify or Apple Music; Linux: `playerctl` and
`pactl`), lock, shut down / restart / sleep, weather, web search, reminders, files (your home folder only),
Ty Live. **Windows only for now**: typing into apps, Discord mute/deafen and messages, moving windows
between monitors, minimise-all, game mode and sitting on your windows. Linux needs a compositor for her
see-through window. Not tested on a real Mac or Linux box yet, so tell me what breaks.
Builds: `npm run dist:mac` on a Mac (.dmg), `npm run dist:linux` on Linux (AppImage and .deb).

## Setup (Windows 10/11)

1. Install **[Node.js](https://nodejs.org)** (LTS) and **[Ollama](https://ollama.com/download)**.
2. Get her brains (about 8 GB) in a terminal:
   ```
   ollama pull huihui_ai/qwen3-abliterated:8b-v2
   ollama pull huihui_ai/qwen3-abliterated:1.7b
   ollama pull qwen3-vl:2b-instruct
   ```
   The 8B is her main brain (needs ~6 GB of VRAM, any decent GPU from the last few years).
   The 1.7B is game mode and her screen comments, the 2B is her eyes.
3. Download this repo (green **Code** button › Download ZIP, or `git clone`), open a terminal in it:
   ```
   npm install
   npm start
   ```
4. Tell her your name: **"call me &lt;name&gt;"**. Then say whatever.

Want her to start with Windows? Deck › PC & Chat › Start Ty with Windows (she switches it on the first time).

**AMD graphics card?** If Ollama eats your RAM or runs slow, set the user environment variable
`OLLAMA_VULKAN=1` and restart Ollama.

## Portable (USB stick, no install, no admin)

On a PC where Ty already works: `powershell -ExecutionPolicy Bypass -File tools\make-portable.ps1`.
It builds a `Ty-Portable` folder on your desktop (about 10 GB: the app, Ollama and her models). Copy it to a
USB stick and double-click **Start Ty.cmd** on any Windows PC. `-Fresh` leaves your chats and settings out.

## Make her yours

- Right-click her › **Make her yours…** to change how she acts, in your own words.
- **"remember that …"** saves something about you she keeps in mind.
- Deck › Character › **Skin**: swap her art for your own drawings (it makes a folder with every picture to
  draw over, plus a README of the sizes).

## Is this a real project?

Yes this is a real project. Ty is an independent, unofficial fan project with a cyberpunk aesthetic with the character design of Capri, inspired by Cyberpunk: Edgerunners. 
It is not affiliated with or endorsed by CD PROJEKT RED, Studio Trigger, Netflix or any other rights holder.
